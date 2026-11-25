import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent,BudgetedContextPolicy,rankContextSlices,CONTEXT_RETENTION_LIMITS,packModelContext,contextBytes,parseContextJson,resolveContextPointer,type ContextArtifact,type ContextArtifactStore } from '@earendil-works/pi-agent-core';
import { normalizeContext,type Message } from '@earendil-works/pi-ai';
import { obj } from '@earendil-works/pi-schema';
import { message,scriptedControlModel,configuredProvider,completedStream } from '../src/runtime.js';

function store():ContextArtifactStore&{values:Map<string,ContextArtifact>}{const values=new Map<string,ContextArtifact>();return {values,put:async a=>{values.set(a.id,a);},get:async id=>values.get(id)};}
function context(raw:string,name='lookup'):ReturnType<typeof normalizeContext>{return normalizeContext({messages:[{role:'user',content:'Compare transaction current baseline delta refund amount by country',timestamp:0},message(scriptedControlModel,[{type:'toolCall',id:'output',name,arguments:{}}],'toolUse'),{role:'toolResult',toolCallId:'output',toolName:name,content:[{type:'text',text:raw}],isError:false,timestamp:1}]});}
interface Manifest {context_artifact:{artifact_id:string};retained_source?:{slices:{json_pointer:string;source_json:string}[]};}
const manifests=(messages:Message[])=>messages.flatMap(m=>m.role==='toolResult'?m.content.flatMap(c=>c.type==='text'?[JSON.parse(c.text) as Manifest]:[]):[]);

test('ranked frontier preserves complete object relationships, escaped pointers and unsafe numeric source literals',()=>{
 const raw='{"a/b~c":{"country":"X","baseline":9007199254740993,"current":0.1000000000000000001,"delta":-0,"refund":1e999},"padding":'+JSON.stringify('x'.repeat(9000))+'}';
 const result=rankContextSlices(raw,'country baseline current delta refund');assert.equal(result.scan.truncated,false);assert.ok(result.ranked.length);
 const parsed=parseContextJson(raw);for(const {slice} of result.ranked){const value=resolveContextPointer(parsed,slice.json_pointer);assert.equal(slice.source_json,parsed.json(value.value,value.parent,value.key));assert.ok(Buffer.byteLength(slice.source_json)<=CONTEXT_RETENTION_LIMITS.unitBytes);}
 const selected=result.ranked.find(v=>v.slice.json_pointer==='/a~1b~0c');assert.ok(selected);assert.match(selected.slice.source_json,/9007199254740993/);assert.match(selected.slice.source_json,/0\.1000000000000000001/);assert.match(selected.slice.source_json,/1e999/);assert.match(selected.slice.source_json,/-0/);
});

test('retention leaves original history/artifact unchanged and fits exact normalized context including escaping',async()=>{
 const raw=JSON.stringify({id:'original-source',result:{country:'退款🧪',baseline:'100.00',current:'80.00',delta:'-20.00',text:'"\\'.repeat(50)},rows:'not-needed'.repeat(2000)}),original=context(raw),before=JSON.stringify(original),a=store(),options={maxContextBytes:5000,inlineToolResultBytes:512,store:a};
 const baseline=await packModelContext(original,[],'current baseline delta country',options),enhanced=await packModelContext(original,[],'current baseline delta country',{...options,exactResultRetention:true});assert.equal(JSON.stringify(original),before);assert.equal(baseline.trace.spilledResults.length,1);assert.ok(enhanced.trace.retainedResultSlices?.length);assert.ok(contextBytes(enhanced.context)<=5000);assert.ok(contextBytes(enhanced.context)-contextBytes(baseline.context)<=CONTEXT_RETENTION_LIMITS.totalBytes);
 const output=manifests(enhanced.context.messages)[0]!;assert.ok(output.retained_source);const artifact=a.values.get(output.context_artifact.artifact_id)!;assert.equal(artifact.text,raw);const parsed=parseContextJson(raw);for(const slice of output.retained_source.slices){const field=resolveContextPointer(parsed,slice.json_pointer);assert.equal(slice.source_json,parsed.json(field.value,field.parent,field.key));}assert.match(JSON.stringify(output.retained_source),/original-source|退款/);
 const disabled=await packModelContext(original,[],'current baseline delta country',{...options,exactResultRetention:false});assert.deepEqual(disabled,baseline);
});

test('scan limits, malformed text, no query, cancellation and error/current recall boundaries are explicit',async()=>{
 assert.equal(rankContextSlices('bad json','field').scan.status,'not-json');assert.equal(rankContextSlices('{}','').scan.status,'no-query');assert.equal(rankContextSlices(' '.repeat(CONTEXT_RETENTION_LIMITS.sourceBytes+1),'field').scan.status,'source-limit');
 let nested:unknown={field:'value'};for(let i=0;i<40;i++)nested={child:nested};const deep=rankContextSlices(JSON.stringify(nested),'field');assert.equal(deep.scan.truncated,true);assert.equal(deep.ranked.length,0);
 const wide=rankContextSlices(JSON.stringify(Array.from({length:21000},()=>1)),'field');assert.equal(wide.scan.truncated,true);assert.ok(wide.scan.visited<=CONTEXT_RETENTION_LIMITS.nodes);
 const abort=new AbortController();abort.abort(new Error('retention-cancel'));assert.throws(()=>rankContextSlices('{"field":"value"}','field',abort.signal),/retention-cancel/);
 const raw=JSON.stringify({baseline:'100',delta:'-20',padding:'x'.repeat(15000)}),error=context(raw);const last=error.messages.at(-1);assert.ok(last?.role==='toolResult');last.isError=true;const result=await packModelContext(error,[],'baseline delta',{maxContextBytes:4096,inlineToolResultBytes:512,store:store(),exactResultRetention:true});assert.equal(result.trace.retainedResultSlices?.length,0);
 const recall=context(raw,'read_context_artifact');await assert.rejects(packModelContext(recall,[],'baseline delta',{maxContextBytes:4096,inlineToolResultBytes:512,store:store(),exactResultRetention:true}),/Current turn/);
});

test('multiple retained results share byte cap and reused call IDs cannot attach the wrong source',async()=>{
 const messages:Message[]=[{role:'user',content:'baseline current delta',timestamp:0}];for(let i=0;i<6;i++)messages.push(message(scriptedControlModel,[{type:'toolCall',id:'reused',name:'lookup',arguments:{index:i}}],'toolUse'),{role:'toolResult',toolCallId:'reused',toolName:'lookup',content:[{type:'text',text:JSON.stringify({id:'source-'+i,result:{baseline:i,current:i+1,delta:1},padding:'x'.repeat(5000)})}],isError:false,timestamp:i});
 const original=normalizeContext({messages}),a=store(),base=await packModelContext(original,[],'baseline current delta',{maxContextBytes:12000,inlineToolResultBytes:512,store:store()}),enhanced=await packModelContext(original,[],'baseline current delta',{maxContextBytes:12000,inlineToolResultBytes:512,store:a,exactResultRetention:true});assert.ok(contextBytes(enhanced.context)<=12000);assert.ok(contextBytes(enhanced.context)-contextBytes(base.context)<=4096);assert.ok(enhanced.trace.retainedResultSlices?.every(v=>v.addedBytes<=1536));
 for(const m of manifests(enhanced.context.messages)){if(!m.retained_source)continue;const raw=a.values.get(m.context_artifact.artifact_id);assert.ok(raw);const parsed=parseContextJson(raw.text);for(const s of m.retained_source.slices){const value=resolveContextPointer(parsed,s.json_pointer);assert.equal(s.source_json,parsed.json(value.value,value.parent,value.key));}}
});

test('exact retention is an explicit valid opt-in and default entry stays full/off',()=>{
 const saved={...process.env};try{process.env.DEEPSEEK_API_KEY='test-only-not-real';delete process.env.METRICLAB_CONTEXT_POLICY;delete process.env.METRICLAB_ARTIFACT_SEARCH;delete process.env.METRICLAB_EXACT_RESULT_RETENTION;assert.equal(configuredProvider().exactResultRetention,false);process.env.METRICLAB_EXACT_RESULT_RETENTION='1';assert.throws(()=>configuredProvider(),/requires budgeted/);process.env.METRICLAB_CONTEXT_POLICY='budgeted';assert.equal(configuredProvider().exactResultRetention,true);process.env.METRICLAB_EXACT_RESULT_RETENTION='yes';assert.throws(()=>configuredProvider(),/must be0or1/);}finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});

test('native Agent forwards opt-in policy slices to the provider while preserving original tool history',async()=>{
 const a=store(),raw=JSON.stringify({id:'source',transaction:{baseline:'100.0000',current:'80.0000',delta:'-20.0000'},padding:'x'.repeat(16000)});let requests=0;
 const policy=new BudgetedContextPolicy({artifacts:a,maxContextBytes:6000,inlineToolResultBytes:512,maxTools:3,maxSchemaBytes:4096,alwaysInclude:['lookup'],exactResultRetention:true});
 const agent=new Agent({modelContextPolicy:policy,initialState:{model:scriptedControlModel,tools:[{name:'lookup',label:'Lookup',description:'Read transaction baseline current delta',parameters:obj({}),execute:async()=>({content:[{type:'text',text:raw}],details:{}})}]},streamFn:(m,view)=>{requests++;if(requests===1)return completedStream(message(m,[{type:'toolCall',id:'lookup',name:'lookup',arguments:{}}],'toolUse'));assert.ok(contextBytes(view)<=6000);const values=manifests(view.messages);assert.ok(values.some(v=>v.retained_source?.slices.some(s=>s.json_pointer==='/transaction'&&s.source_json.includes('-20.0000'))));return completedStream(message(m,[{type:'text',text:'Checked provider boundary'}]));}});
 await agent.prompt('Read transaction baseline current delta');assert.equal(requests,2);assert.equal(agent.state.errorMessage,undefined);assert.ok(agent.state.messages.some(m=>m.role==='toolResult'&&m.content.some(p=>p.type==='text'&&p.text===raw)));
});

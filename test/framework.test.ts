import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, BudgetedContextPolicy, assertToolTransactions, contextArtifact, contextBytes, createContextReadTool, packModelContext, routeTools, type ContextArtifact, type ContextArtifactStore, type ExecutableTools, type StreamFn } from '@earendil-works/pi-agent-core';
import { Agent as UpstreamAgent } from '@pi-context-lab/upstream-agent-core';
import { getCurrentSystemMessage, getCurrentTools, normalizeContext, type Message } from '@earendil-works/pi-ai';
import { obj } from '@earendil-works/pi-schema';
import { completedStream, scriptedControlModel, message } from '../src/runtime.js';

class Artifacts implements ContextArtifactStore {
 readonly values=new Map<string,ContextArtifact>();
 async put(a:ContextArtifact):Promise<void>{const old=this.values.get(a.id);if(old)assert.equal(old.text,a.text);this.values.set(a.id,a);}
 async get(id:string):Promise<ContextArtifact|undefined>{return this.values.get(id);}
}
const empty=obj({});
function registry():ExecutableTools{return [
 {name:'get_weather',label:'weather',description:'Weather forecast for a city. Temperature and precipitation.',parameters:empty,execute:async()=>({content:[{type:'text',text:'Controlled weather'}],details:{}})},
 {name:'resolve_city',label:'city',description:'Resolve a city name to coordinates.',parameters:empty,execute:async()=>({content:[{type:'text',text:'Controlled city'}],details:{}})},
 {name:'delete_records',label:'records',description:'Delete archive records.',parameters:empty,execute:async()=>({content:[{type:'text',text:'Controlled no-op'}],details:{}})},
 ...Array.from({length:20},(_,i)=>({name:`inventory_${i}`,label:'inventory',description:`Warehouse inventory location ${i} bin stock balance.`,parameters:empty,execute:async()=>({content:[{type:'text' as const,text:'Controlled inventory'}],details:{}})})),
 ];}

test('router admits dependency closure within schema/count budgets and refuses oversized required groups',()=>{
 const tools=registry();const r=routeTools('weather forecast for city',tools,{maxTools:2,maxSchemaBytes:2000,alwaysInclude:[],dependencies:{get_weather:['resolve_city']}});assert.deepEqual(r.tools.map(t=>t.name),['get_weather','resolve_city']);assert.equal(r.schemaBytes,r.tools.reduce((n,t)=>n+Buffer.byteLength(JSON.stringify({name:t.name,description:t.description,parameters:t.parameters})),0));
 assert.throws(()=>routeTools('weather',tools,{maxTools:1,maxSchemaBytes:2000,alwaysInclude:['get_weather'],dependencies:{get_weather:['resolve_city']}}),/required.*budget/i);
 assert.throws(()=>routeTools('weather',tools,{maxTools:4,maxSchemaBytes:2000,alwaysInclude:['missing']}),/unregistered/);
 const fullDoc=routeTools('special_documentation_token',tools,{maxTools:1,maxSchemaBytes:2000,alwaysInclude:[],routingDocuments:{resolve_city:'special_documentation_token'}});assert.equal(fullDoc.tools[0]?.name,'resolve_city');
});

test('native core enforces the routed execution allowlist; original Pi executes the same registered control call',async()=>{
 let executions=0;const tools=registry();tools[2]!.execute=async()=>{executions++;return {content:[{type:'text',text:'Controlled counter only'}],details:{}};};
 const stream:StreamFn=(model,context)=>completedStream(message(model,context.messages.some(m=>m.role==='toolResult')?[{type:'text',text:'Finished'}]:[{type:'toolCall',id:'unselected',name:'delete_records',arguments:{}}],context.messages.some(m=>m.role==='toolResult')?'stop':'toolUse'));
 const upstream=new UpstreamAgent({streamFn:stream,initialState:{model:scriptedControlModel,tools}});await upstream.prompt('What is the weather forecast?');assert.equal(executions,1);
 executions=0;const policy=new BudgetedContextPolicy({artifacts:new Artifacts(),maxContextBytes:12000,inlineToolResultBytes:2048,maxTools:3,maxSchemaBytes:10000,alwaysInclude:[]});
 const agent=new Agent({streamFn:stream,modelContextPolicy:policy,initialState:{model:scriptedControlModel,tools}});await agent.prompt('What is the weather forecast?');assert.equal(executions,0);assert.ok(agent.state.messages.some(m=>m.role==='toolResult'&&m.toolName==='delete_records'&&m.isError));
});

test('context spilling keeps exact source and tool pairs; bounded recall verifies checksum and JSON pointers',async()=>{
 const store=new Artifacts();const payload={id:'source-report-123',fact:{amount:'1070704.6700'},padding:'原始数据🧪'.repeat(1500)};
 const assistant=message(scriptedControlModel,[{type:'toolCall',id:'large',name:'get_weather',arguments:{}}],'toolUse');
 const original:Message[]=[{role:'system',content:'Keep all original safety instructions.',sections:{'pi-context-lab.archive':'Original section must stay'},timestamp:0},{role:'user',content:'Read exact amount',timestamp:1},assistant,{role:'toolResult',toolCallId:'large',toolName:'get_weather',content:[{type:'text',text:JSON.stringify(payload)}],details:payload,isError:false,timestamp:2}];
 const before=JSON.stringify(original);const packed=await packModelContext(normalizeContext({messages:original}),[], 'amount',{maxContextBytes:4096,inlineToolResultBytes:512,store});assert.ok(packed.trace.afterBytes<4096);assert.equal(JSON.stringify(original),before);assertToolTransactions(packed.context.messages);assert.equal(packed.trace.spilledResults.length,1);
 const ref=packed.context.messages.find(m=>m.role==='toolResult');assert.ok(ref?.role==='toolResult');const textRef=ref.content.find(c=>c.type==='text');assert.ok(textRef?.type==='text');const sketch=JSON.parse(textRef.text) as {source_identity:{id:string};context_artifact:{artifact_id:string}};assert.equal(sketch.source_identity.id,payload.id);assert.notEqual(sketch.context_artifact.artifact_id,payload.id);
 const id=packed.trace.spilledResults[0]!;const read=createContextReadTool(store);const result=await read.execute('recall',{artifact_id:id,json_pointers:['/fact/amount'],offset:0,limit:128});assert.ok(result.content.some(c=>c.type==='text'&&c.text.includes('1070704.6700')));
 const batch=await read.execute('batch',{artifact_id:id,json_pointers:['/id','/fact/amount'],offset:0,limit:32});const batchText=batch.content.find(c=>c.type==='text');assert.ok(batchText?.type==='text');const values=JSON.parse(batchText.text) as {values:{text:string}[];codepoints_used:number};assert.deepEqual(values.values.map(v=>v.text),['source-report-123','1070704.6700']);assert.ok(values.codepoints_used<=32);
 const partial=await read.execute('partial',{artifact_id:id,json_pointers:['/source_identity/id','/id','/fact/amount'],offset:0,limit:32});const partialText=partial.content.find(c=>c.type==='text');assert.ok(partialText?.type==='text');const partialValues=JSON.parse(partialText.text) as {values:{text?:string;error?:string}[];codepoints_used:number};assert.match(partialValues.values[0]?.error??'',/does not exist/);assert.deepEqual(partialValues.values.slice(1).map(v=>v.text),['source-report-123','1070704.6700']);assert.equal(partialValues.codepoints_used,values.codepoints_used);
 const artifact=store.values.get(id)!;store.values.set(id,{...artifact,text:artifact.text+'tamper'});await assert.rejects(read.execute('tampered',{artifact_id:id,json_pointers:[''],offset:0,limit:10}),/integrity/);
});

test('history packing evicts whole user turns, preserves system sections and archives exact turns',async()=>{
 const store=new Artifacts();const messages:Message[]=[{role:'system',content:'Root rules stay',sections:{'pi-context-lab.archive':'Do not overwrite'},timestamp:0}];
 for(let i=0;i<12;i++){messages.push({role:'user',content:`History ${i} ${'background '.repeat(60)}`,timestamp:i+1},message(scriptedControlModel,[{type:'text',text:'Completed older answer '.repeat(30)}]));}
 messages.push({role:'user',content:'Current important question',timestamp:20});const original=JSON.stringify(messages);
 const packed=await packModelContext(normalizeContext({messages}),[],'Current important question',{maxContextBytes:4096,inlineToolResultBytes:512,store});assert.ok(packed.trace.archivedTurns.length>0);assert.ok(contextBytes(packed.context)<=4096);assert.equal(JSON.stringify(messages),original);assert.equal(packed.context.messages.at(-1)?.role,'user');assertToolTransactions(packed.context.messages);
 const system=getCurrentSystemMessage(packed.context.messages);assert.equal(system?.sections?.['pi-context-lab.archive'],'Do not overwrite');assert.ok(system?.content.toString().includes('Root rules stay'));assert.ok(packed.trace.indexArtifact);const index=await store.get(packed.trace.indexArtifact!);assert.ok(index&&JSON.parse(index.text).references.length===12);
});

test('malformed tool history and mandatory oversized current turn fail before provider admission',async()=>{
 const orphan:Message={role:'toolResult',toolCallId:'missing',toolName:'x',content:[],isError:false,timestamp:0};assert.throws(()=>assertToolTransactions([orphan]),/Orphan/);
 const tools=registry();let requests=0;const p=new BudgetedContextPolicy({artifacts:new Artifacts(),maxContextBytes:1024,inlineToolResultBytes:512,maxTools:3,maxSchemaBytes:10000,alwaysInclude:[]});const agent=new Agent({modelContextPolicy:p,streamFn:model=>{requests++;return completedStream(message(model,[]));},initialState:{model:scriptedControlModel,tools}});await agent.prompt('Mandatory input '.repeat(500));assert.equal(requests,0);assert.ok(agent.state.errorMessage?.includes('budget'));
});

test('tool discovery promotes missing schemas on the next native request; provider declarations match allowed tools',async()=>{
 const tools=registry();const traces:string[][]=[];const p=new BudgetedContextPolicy({artifacts:new Artifacts(),maxContextBytes:12000,inlineToolResultBytes:2048,maxTools:3,maxSchemaBytes:10000,alwaysInclude:[],onPrepared:t=>{traces.push(t.selectedToolNames);}});
 const all=[...tools,...p.tools];const user:Message={role:'user',content:'weather forecast',timestamp:0};await p.prepare({context:normalizeContext({messages:[user]}),tools:all,model:scriptedControlModel});const discover=p.tools.find(t=>t.name==='discover_tools');assert.ok(discover);const output=await discover.execute('discover',{query:'delete_records archive records',limit:1});const messages:Message[]=[user,message(scriptedControlModel,[{type:'toolCall',id:'discover',name:'discover_tools',arguments:{query:'delete_records archive records',limit:1}}],'toolUse'),{role:'toolResult',toolCallId:'discover',toolName:'discover_tools',content:output.content,isError:false,timestamp:1}];const next=await p.prepare({context:normalizeContext({messages}),tools:all,model:scriptedControlModel});assert.ok(next.tools.some(t=>t.name==='delete_records'));assert.deepEqual(getCurrentTools(next.context.messages).map(t=>t.name),next.tools.map(t=>t.name));assert.ok(traces[1]?.includes('delete_records'));
 const restarted=new BudgetedContextPolicy({artifacts:new Artifacts(),maxContextBytes:12000,inlineToolResultBytes:2048,maxTools:3,maxSchemaBytes:10000,alwaysInclude:[]});const recoveredAgent=new Agent({streamFn:m=>completedStream(message(m,[])),modelContextPolicy:restarted,initialState:{model:scriptedControlModel,tools}});const recovered=await restarted.prepare({context:normalizeContext({messages}),tools:recoveredAgent.state.tools,model:scriptedControlModel});assert.ok(recovered.tools.some(t=>t.name==='delete_records'));
});

test('artifact identities distinguish kind and bounded Unicode recall never splits surrogate pairs',async()=>{
 const s=new Artifacts();const a=await contextArtifact('🧪中文ABC','tool-result');await s.put(a);assert.notEqual((await contextArtifact(a.text,'history-turn')).id,a.id);const reader=createContextReadTool(s);const result=await reader.execute('unicode',{artifact_id:a.id,json_pointers:[''],offset:0,limit:2});const text=result.content.find(c=>c.type==='text');assert.ok(text?.type==='text');assert.equal((JSON.parse(text.text) as {values:{text:string}[]}).values[0]?.text,'🧪中');
});
test('one policy instance cannot share mutable lookup state across two Agents',()=>{
 const policy=new BudgetedContextPolicy({artifacts:new Artifacts(),maxContextBytes:12000,inlineToolResultBytes:2048,maxTools:4,maxSchemaBytes:10000,alwaysInclude:[]});
 const options={streamFn:(m:typeof scriptedControlModel)=>completedStream(message(m,[])),modelContextPolicy:policy,initialState:{model:scriptedControlModel,tools:registry()}};
 new Agent({...options,streamFn:m=>completedStream(message(m,[]))});assert.throws(()=>new Agent({...options,streamFn:m=>completedStream(message(m,[]))}),/one Agent/);
});
test('utility schemas stay hidden when the complete business toolset and context already fit',async()=>{
 const p=new BudgetedContextPolicy({artifacts:new Artifacts(),maxContextBytes:12000,inlineToolResultBytes:2048,maxTools:4,maxSchemaBytes:10000,alwaysInclude:[]});const business=registry().slice(0,2);const result=await p.prepare({context:normalizeContext({messages:[{role:'user',content:'weather',timestamp:0}]}),tools:[...business,...p.tools],model:scriptedControlModel});assert.deepEqual(result.tools.map(t=>t.name),business.map(t=>t.name));
});

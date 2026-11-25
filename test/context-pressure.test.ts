import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetedContextPolicy,contextArtifact,contextBytes,createContextReadTool,packModelContext,type ContextArtifact,type ContextArtifactStore,type ContextReadContinuation,type ExecutableTools } from '@earendil-works/pi-agent-core';
import { normalizeContext,type Message } from '@earendil-works/pi-ai';
import { obj } from '@earendil-works/pi-schema';
import { message,scriptedControlModel } from '../src/runtime.js';
class Artifacts implements ContextArtifactStore {
 readonly values=new Map<string,ContextArtifact>();
 async put(a:ContextArtifact):Promise<void>{this.values.set(a.id,a);}
 async get(id:string):Promise<ContextArtifact|undefined>{return this.values.get(id);}
}
function batch(names:string[],texts:string[],user='Inspect saved data'):Message[]{
 return [{role:'user',content:user,timestamp:0},message(scriptedControlModel,names.map((name,i)=>({type:'toolCall' as const,id:'call-'+i,name,arguments:{}})),'toolUse'),...names.map((name,i)=>({role:'toolResult' as const,toolCallId:'call-'+i,toolName:name,content:[{type:'text' as const,text:texts[i]!}],isError:false,timestamp:1}))];
}
function wireText(result:{content:unknown[]}):string {const item=result.content.find(p=>p!==null&&typeof p==='object'&&'type' in p&&p.type==='text');assert.ok(item&&typeof item==='object'&&'text' in item&&typeof item.text==='string');return item.text;}

test('fitting provider context preserves large results and ignores display-only size without allocating artifacts or utility schemas',async()=>{
 const store=new Artifacts();const messages=batch(['saved_data'],['visible-source '+ 'x'.repeat(11000)]);const result=messages.at(-1);assert.ok(result?.role==='toolResult');result.details={display:'z'.repeat(60000)};const before=JSON.stringify(messages);
 const policy=new BudgetedContextPolicy({artifacts:store,artifactSearch:true,maxContextBytes:16384,inlineToolResultBytes:512,maxTools:2,maxSchemaBytes:4096,alwaysInclude:[]});
 const prepared=await policy.prepare({context:normalizeContext({messages}),tools:policy.tools,model:scriptedControlModel});assert.equal(store.values.size,0);assert.equal(prepared.tools.length,0);assert.ok(JSON.stringify(prepared.context).includes('visible-source'));assert.ok(!JSON.stringify(prepared.context).includes('"display"'));assert.equal(JSON.stringify(messages),before);
});

test('pressure spills the largest eligible result once and retains smaller source data when that fits',async()=>{
 const store=new Artifacts();const small='small-signal '+ 's'.repeat(3500),large='big-source '+ 'b'.repeat(12000);const messages=batch(['small_source','large_source'],[small,large]);
 const packed=await packModelContext(normalizeContext({messages}),[],'small-signal',{maxContextBytes:10000,inlineToolResultBytes:512,store});assert.equal(packed.trace.spilledResults.length,1);assert.equal(store.values.size,1);assert.equal([...store.values.values()][0]?.text,large);assert.ok(JSON.stringify(packed.context).includes(small));assert.ok(contextBytes(packed.context)<=10000);assert.equal(packed.trace.trigger,'pressure');
});

test('all recall results in the latest parallel batch are protected while an ordinary result can be spilled',async()=>{
 const store=new Artifacts();const ordinary=batch(['ordinary_source'],['o'.repeat(8000)]);
 const calls=message(scriptedControlModel,[{type:'toolCall',id:'recall-a',name:'read_context_artifact',arguments:{}},{type:'toolCall',id:'recall-b',name:'search_context_artifact',arguments:{}}],'toolUse');
 const first='first-recall '+ 'a'.repeat(9500),second='second-recall '+ 'b'.repeat(800);
 const messages:Message[]=[...ordinary,calls,{role:'toolResult',toolCallId:'recall-a',toolName:'read_context_artifact',content:[{type:'text',text:first}],isError:false,timestamp:2},{role:'toolResult',toolCallId:'recall-b',toolName:'search_context_artifact',content:[{type:'text',text:second}],isError:false,timestamp:2}];
 const packed=await packModelContext(normalizeContext({messages}),[],'read saved facts',{maxContextBytes:16384,inlineToolResultBytes:512,store});assert.deepEqual(packed.trace.protectedRecallCallIds,['recall-a','recall-b']);assert.equal(packed.trace.spilledResults.length,1);assert.equal([...store.values.values()][0]?.text,'o'.repeat(8000));assert.ok(JSON.stringify(packed.context).includes(first));assert.ok(JSON.stringify(packed.context).includes(second));
});

test('routing removes omitted schemas before deciding context pressure and retains an executable business tool',async()=>{
 const schema=obj({});const tools:ExecutableTools=Array.from({length:20},(_,i)=>({name:i===0?'weather_forecast':`inventory_${i}`,label:'control',description:(i===0?'Weather forecast for a city. ':'Inventory stock. ')+'documentation '.repeat(60),parameters:schema,execute:async()=>({content:[{type:'text' as const,text:'Control'}],details:{}})}));
 const store=new Artifacts();const policy=new BudgetedContextPolicy({artifacts:store,maxContextBytes:4096,inlineToolResultBytes:512,maxTools:2,maxSchemaBytes:4096,alwaysInclude:[]});const all=[...tools,...policy.tools];
 const context=normalizeContext({messages:[{role:'system',content:'Keep instructions.',toolsAdded:tools.map(t=>({name:t.name,description:t.description,parameters:t.parameters})),timestamp:0},{role:'user',content:'weather forecast',timestamp:1}]});assert.ok(contextBytes(context)>4096);
 const prepared=await policy.prepare({context,tools:all,model:scriptedControlModel});assert.ok(prepared.tools.some(t=>t.name==='weather_forecast'));assert.ok(prepared.tools.some(t=>t.name==='discover_tools'));assert.ok(!prepared.tools.some(t=>t.name==='read_context_artifact'));assert.equal(store.values.size,0);assert.ok(contextBytes(prepared.context)<=4096);
});

test('history-only pressure exposes recall and archives whole turns even without large tool outputs',async()=>{
 const store=new Artifacts();const messages:Message[]=[];for(let i=0;i<10;i++)messages.push({role:'user',content:`Old reference ${i} ${'text '.repeat(100)}`,timestamp:i},message(scriptedControlModel,[{type:'text',text:'Reference answer '.repeat(60)}]));messages.push({role:'user',content:'Locate a saved reference',timestamp:20});
 const policy=new BudgetedContextPolicy({artifacts:store,maxContextBytes:4096,inlineToolResultBytes:512,maxTools:2,maxSchemaBytes:4096,alwaysInclude:[]});const prepared=await policy.prepare({context:normalizeContext({messages}),tools:policy.tools,model:scriptedControlModel});assert.ok(prepared.tools.some(t=>t.name==='read_context_artifact'));assert.ok([...store.values.values()].some(a=>a.kind==='history-index'));assert.ok(contextBytes(prepared.context)<=4096);
});

test('per-value continuation follows a shared budget exactly across Unicode pages and empty remaining budgets',async()=>{
 const store=new Artifacts(),long='甲🧪B'.repeat(50);const artifact=await contextArtifact(JSON.stringify({short:'🧪'.repeat(3),long}),'tool-result');await store.put(artifact);const reader=createContextReadTool(store);
 interface Page {text:string;returned_codepoints:number;next_offset:number;next_read:ContextReadContinuation|null;has_more:boolean;}
 const first=JSON.parse(wireText(await reader.execute('first',{artifact_id:artifact.id,json_pointers:['/short','/long'],offset:0,limit:11}))) as {values:Page[];codepoints_used:number};assert.equal(first.codepoints_used,11);const field=first.values[1]!;assert.equal(field.returned_codepoints,8);assert.equal(field.next_offset,8);assert.equal(field.next_read?.offset,8);
 let joined=field.text;let cursor:ContextReadContinuation|null=field.next_read;while(cursor){const page:Page=(JSON.parse(wireText(await reader.execute('next',cursor))) as {values:Page[]}).values[0]!;assert.ok(page.returned_codepoints<=11);joined+=page.text;cursor=page.next_read;}assert.equal(joined,long);
 const empty=JSON.parse(wireText(await reader.execute('shared-exhausted',{artifact_id:artifact.id,json_pointers:['/short','/long'],offset:0,limit:3}))) as {values:Page[]};assert.equal(empty.values[1]?.returned_codepoints,0);assert.equal(empty.values[1]?.next_read?.offset,0);
 await assert.rejects(reader.execute('unsafe',{artifact_id:artifact.id,json_pointers:[''],offset:Number.MAX_SAFE_INTEGER+1,limit:3}),/safe integers/);
});

test('eager threshold spilling remains explicit while pressure mode leaves the same fitting result intact',async()=>{
 const context=normalizeContext({messages:batch(['saved_data'],['x'.repeat(9000)])});const normal=new Artifacts(),legacy=new Artifacts();
 const a=await packModelContext(context,[],'saved data',{maxContextBytes:16384,inlineToolResultBytes:512,store:normal});const b=await packModelContext(context,[],'saved data',{maxContextBytes:16384,inlineToolResultBytes:512,store:legacy,spillMode:'threshold'});
 assert.equal(a.trace.trigger,'none');assert.equal(a.trace.spilledResults.length,0);assert.equal(b.trace.trigger,'threshold');assert.equal(b.trace.spilledResults.length,1);
});

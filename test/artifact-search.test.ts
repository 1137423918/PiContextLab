import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetedContextPolicy, CONTEXT_FIELD_LIMITS, contextArtifact, createContextReadTool, createContextSearchTool, parseContextJson, resolveContextPointer, searchContextFields, type ContextArtifact, type ContextArtifactStore } from '@earendil-works/pi-agent-core';
import { normalizeContext } from '@earendil-works/pi-ai';
import { message, scriptedControlModel } from '../src/runtime.js';

class Artifacts implements ContextArtifactStore {
 readonly values=new Map<string,ContextArtifact>();
 async put(value:ContextArtifact):Promise<void>{this.values.set(value.id,value);}
 async get(id:string):Promise<ContextArtifact|undefined>{return this.values.get(id);}
}
function output(result:{content:({type:string;text?:string}|unknown)[]}):string {
 const value=result.content.find(c=>typeof c==='object'&&c!==null&&'type' in c&&c.type==='text');
 assert.ok(value&&typeof value==='object'&&'text' in value&&typeof value.text==='string');return value.text;
}

test('exact artifact reads preserve unsafe integers, fractional digits, exponent literals and nested numbers',async()=>{
 const raw='{"id":9007199254740993,"nested":{"amount":0.1000000000000000001,"overflow":1e999,"zero":-0},"a/b~c":[9223372036854775807]}';
 const store=new Artifacts();const artifact=await contextArtifact(raw,'tool-result');await store.put(artifact);
 const result=JSON.parse(output(await createContextReadTool(store).execute('numeric',{artifact_id:artifact.id,json_pointers:['/id','/nested','/a~1b~0c/0'],offset:0,limit:1024}))) as {values:{text:string}[]};
 assert.deepEqual(result.values.map(v=>v.text),['9007199254740993','{"amount":0.1000000000000000001,"overflow":1e999,"zero":-0}','9223372036854775807']);
 const parsed=parseContextJson(raw);assert.throws(()=>resolveContextPointer(parsed,'/a~1b~0c/01'),/array segment/);assert.throws(()=>resolveContextPointer(parsed,'/__proto__'),/does not exist/);
});

test('field search locates escaped source paths with exact numeric previews and bounded Unicode JSON output',async()=>{
 const store=new Artifacts();const raw='{"a/b~c":{"external_transaction_id":9007199254740993},"records":'+JSON.stringify(Array.from({length:30},(_,i)=>({kind:'comparison',checksum:'hash-'+i,note:'数值🧪'.repeat(300)})))+'}';
 const artifact=await contextArtifact(raw,'tool-result');await store.put(artifact);const search=createContextSearchTool(store);
 const numeric=JSON.parse(output(await search.execute('locate',{artifact_id:artifact.id,query:'external transaction id',limit:2}))) as {matches:{json_pointer:string;text:string}[]};assert.equal(numeric.matches[0]?.json_pointer,'/a~1b~0c/external_transaction_id');assert.equal(numeric.matches[0]?.text,'9007199254740993');
 const bounded=output(await search.execute('bounded',{artifact_id:artifact.id,query:'comparison note checksum',limit:20}));assert.ok(Buffer.byteLength(bounded)<=CONTEXT_FIELD_LIMITS.responseBytes);assert.ok(!/\\ud83e"/.test(bounded));
 const matches=(JSON.parse(bounded) as {matches:{json_pointer:string;text:string}[]}).matches;for(const m of matches){const parsed=parseContextJson(raw);const field=resolveContextPointer(parsed,m.json_pointer);assert.ok(parsed.text(field.value,field.parent,field.key).startsWith(m.text));}
});

test('field search reports scan truncation and rejects foreign, corrupt or oversized artifacts',async()=>{
 const wide=JSON.stringify(Object.fromEntries(Array.from({length:5000},(_,i)=>['field_'+i,'value_'+i])));const found=searchContextFields(wide,'field',20);assert.equal(found.scan.truncated,true);assert.equal(found.scan.complete,false);assert.ok(found.fields.length<=CONTEXT_FIELD_LIMITS.maxFields);
 assert.throws(()=>searchContextFields(' '.repeat(CONTEXT_FIELD_LIMITS.maxSourceBytes+1),'query',1),/source limit/);
 const store=new Artifacts();const artifact=await contextArtifact('{"field":"value"}','tool-result');await store.put(artifact);const search=createContextSearchTool(store);
 await assert.rejects(search.execute('foreign',{artifact_id:'ctx_unknown',query:'field',limit:1}),/conversation/);store.values.set(artifact.id,{...artifact,text:'{"field":"changed"}'});await assert.rejects(search.execute('corrupt',{artifact_id:artifact.id,query:'field',limit:1}),/integrity/);
});

test('optional field locator is exposed with the reader only under pressure and fits the same count/schema budgets',async()=>{
 const store=new Artifacts();const policy=new BudgetedContextPolicy({artifacts:store,artifactSearch:true,maxContextBytes:16384,inlineToolResultBytes:512,maxTools:2,maxSchemaBytes:4096,alwaysInclude:[]});
 const all=policy.tools;
 const short=await policy.prepare({context:normalizeContext({messages:[{role:'user',content:'Read a short fact',timestamp:0}]}),tools:all,model:scriptedControlModel});assert.equal(short.tools.length,0);
 const messages=[{role:'user' as const,content:'Find nested transaction identifier',timestamp:0},message(scriptedControlModel,[{type:'toolCall',id:'large',name:'saved_result',arguments:{}}],'toolUse'),{role:'toolResult' as const,toolCallId:'large',toolName:'saved_result',content:[{type:'text' as const,text:'{"id":9007199254740993,"padding":'+JSON.stringify('data'.repeat(3000))+'}'}],isError:false,timestamp:1}];
 const prepared=await policy.prepare({context:normalizeContext({messages}),tools:all,model:scriptedControlModel});assert.deepEqual(prepared.tools.map(t=>t.name).sort(),['read_context_artifact','search_context_artifact']);assert.ok(JSON.stringify(prepared.context).includes('If paths are unknown'));assert.ok(!JSON.stringify(prepared.context).includes('9007199254740992'));
});

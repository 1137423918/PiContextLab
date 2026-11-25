import { readFile,writeFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { contextBytes,modelContextView,packModelContext,type ContextArtifact,type ContextArtifactStore } from '@earendil-works/pi-agent-core';
import { normalizeContext,type Message } from '@earendil-works/pi-ai';
import { message,scriptedControlModel } from '../src/runtime.js';

const [oldCore,output]=process.argv.slice(2);if(!oldCore||!output)throw new Error('FROZEN_CORE4_JS NEW_OUTPUT_JSON');
const old=await import(pathToFileURL(oldCore).href) as {packModelContext:typeof packModelContext};
const oldPackage=JSON.parse(await readFile(join(dirname(oldCore),'../package.json'),'utf8')) as {version:string};assert.equal(oldPackage.version,'1.6.0-contextlab.4');
interface Case {id:string;messages:Message[];max:number;expected:number;retained:string[];}
function batch(names:string[],texts:string[]):Message[]{return [{role:'user',content:'Inspect the saved facts',timestamp:0},message(scriptedControlModel,names.map((name,i)=>({type:'toolCall' as const,id:'call-'+i,name,arguments:{}})),'toolUse'),...names.map((name,i)=>({role:'toolResult' as const,toolCallId:'call-'+i,toolName:name,content:[{type:'text' as const,text:texts[i]!}],isError:false,timestamp:1}))];}
const fit='fit-source '+ 'f'.repeat(11000),small='small-source '+ 's'.repeat(3500),large='large-source '+ 'l'.repeat(12000),first='first-recall '+ 'a'.repeat(9500),second='second-recall '+ 'b'.repeat(800);
const parallel:Message[]=[...batch(['ordinary_source'],['o'.repeat(8000)]),message(scriptedControlModel,[{type:'toolCall',id:'recall-a',name:'read_context_artifact',arguments:{}},{type:'toolCall',id:'recall-b',name:'search_context_artifact',arguments:{}}],'toolUse'),{role:'toolResult',toolCallId:'recall-a',toolName:'read_context_artifact',content:[{type:'text',text:first}],isError:false,timestamp:2},{role:'toolResult',toolCallId:'recall-b',toolName:'search_context_artifact',content:[{type:'text',text:second}],isError:false,timestamp:2}];
const cases:Case[]=[{id:'fits-large-output',messages:batch(['saved_data'],[fit]),max:16384,expected:0,retained:[fit]},{id:'one-large-spill-suffices',messages:batch(['small_source','large_source'],[small,large]),max:10000,expected:1,retained:[small]},{id:'parallel-recall-preservation',messages:parallel,max:16384,expected:1,retained:[first,second]}];
const rows=[];
for(const c of cases){
 const context=normalizeContext({messages:c.messages});const original=JSON.stringify(context);
 for(const variant of ['frozen-core4','core5-pressure'] as const){
  const values=new Map<string,ContextArtifact>();let writes=0;const store:ContextArtifactStore={put:async a=>{writes++;values.set(a.id,a);},get:async id=>values.get(id)};
  const pack=variant==='frozen-core4'?old.packModelContext:packModelContext;const result=await pack(context,[],'saved facts',{maxContextBytes:c.max,inlineToolResultBytes:512,store});
  assert.equal(JSON.stringify(context),original);assert.ok(contextBytes(result.context)<=c.max);
  const row={case:c.id,variant,input_provider_JSON_bytes:contextBytes(modelContextView(context,[])),output_provider_JSON_bytes:contextBytes(result.context),artifact_writes:writes,spilled_results:result.trace.spilledResults.length,retained_exact_fields:c.retained.map(text=>result.context.messages.some(m=>m.role==='toolResult'&&m.content.some(p=>p.type==='text'&&p.text===text))),trace:result.trace};
  rows.push(row);if(variant==='core5-pressure'){assert.equal(row.spilled_results,c.expected);assert.ok(row.retained_exact_fields.every(Boolean));}
  console.log(JSON.stringify({...row,trace:undefined}));
 }
}
const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
await writeFile(output,JSON.stringify({kind:'CPU-only synthetic mechanism comparison, not model performance',baseline:{version:oldPackage.version,context_budget_js_sha256:hash(await readFile(join(dirname(oldCore),'context-budget.js')))},protocol_sha256:hash(await readFile('examples/pressure-policy-cpu-protocol.json')),rows,model_calls:0,GPU_used:false},null,2)+'\n',{flag:'wx'});

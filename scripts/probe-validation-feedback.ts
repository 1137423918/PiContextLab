import { readFile,writeFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { runToolCall,type AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolCall } from '@earendil-works/pi-ai';
import { obj,str } from '@earendil-works/pi-schema';
import { scriptedControlModel,message } from '../src/runtime.js';

const [oldPath,output]=process.argv.slice(2);if(!oldPath||!output)throw new Error('FROZEN_CORE7_JS NEW_OUTPUT_JSON');
const old=await import(pathToFileURL(oldPath).href) as {runToolCall:typeof runToolCall};const oldPackage=JSON.parse(await readFile(join(dirname(oldPath),'../package.json'),'utf8')) as {version:string};assert.equal(oldPackage.version,'1.6.0-contextlab.7');
const cases:ToolCall[]=[{type:'toolCall',id:'long-string',name:'save',arguments:{note:'a'.repeat(12000)}},{type:'toolCall',id:'unknown-properties',name:'save',arguments:{note:'valid',...Object.fromEntries(Array.from({length:90},(_,i)=>['unknown_"\n/'+i,true]))}},{type:'toolCall',id:'malformed-json',name:'save',arguments:{},argumentsError:'Unexpected end of input\n\nReceived arguments:\n'+'z'.repeat(9000)},{type:'toolCall',id:'unicode',name:'save',arguments:{note:'甲🧪"\n'.repeat(800)}}];
let executions=0;const tool:AgentTool={name:'save',label:'Save',description:'Save small note',parameters:obj({note:str({maxLength:64})}),execute:async()=>{executions++;return {content:[],details:{}};}};
const sha=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex');const rows=[];
for(const call of cases){const original=JSON.stringify(call),options={tools:[tool],assistantMessage:message(scriptedControlModel,[call],'toolUse'),context:{messages:[]}};
 const before=await old.runToolCall(call,options),after=await runToolCall(call,{...options,toolValidationFeedback:'bounded'});assert.ok(before.isError&&after.isError);assert.equal(JSON.stringify(call),original);const content=after.result.content[0];assert.ok(content?.type==='text');const payload=JSON.parse(content.text) as {error:string;diagnostic_truncated:boolean;fields:unknown[];source:string};const bytes=Buffer.byteLength(JSON.stringify(after.result.content));assert.ok(bytes<=2048);assert.equal(payload.error,'INVALID_TOOL_ARGUMENTS');assert.equal(executions,0);if(call.argumentsError)assert.ok(payload.source.includes('argumentsError'));
 const row={case:call.id,input_arguments_sha256:sha(original),legacy_content_JSON_bytes:Buffer.byteLength(JSON.stringify(before.result.content)),bounded_content_JSON_bytes:bytes,bounded_details_JSON_bytes:Buffer.byteLength(JSON.stringify(after.result.details)),diagnostic_truncated:payload.diagnostic_truncated,fields_returned:payload.fields.length,bounded_payload:payload,old_rejected:true,new_rejected:true,executions};rows.push(row);console.log(JSON.stringify({...row,bounded_payload:undefined}));
}
await writeFile(output,JSON.stringify({kind:'CPU schema-feedback size and execution-boundary diagnostic, not model quality',baseline:{version:oldPackage.version,agent_loop_js_sha256:sha(await readFile(join(dirname(oldPath),'agent-loop.js')))},protocol_sha256:sha(await readFile('examples/validation-feedback-cpu-protocol.json')),rows,model_calls:0,GPU_used:false},null,2)+'\n',{flag:'wx'});

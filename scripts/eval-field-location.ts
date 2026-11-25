/** Frozen CPU diagnostics, not an LLM task-success benchmark. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ContextLexicalIndex, contextArtifact, createContextReadTool, createContextSearchTool, parseContextJson, resolveContextPointer, searchContextFields, type ContextArtifact, type ContextArtifactStore } from '@earendil-works/pi-agent-core';
import assert from 'node:assert/strict';

const [input, output, oldCore]=process.argv.slice(2);if(!input||!output||!oldCore)throw new Error('PINNED_INPUT_DIR NEW_OUTPUT_JSON FROZEN_OLD_CORE_JS');
interface Query{id:string;source:'lock'|'commit';query:string;targets:string[];}
interface DiagnosticRow {
 id:string;source:'lock'|'commit';query:string;targets:string[];
 path_only:{recall5:number;recall10:number;top10:string[]};
 path_labels_preview:{recall5:number;recall10:number;top10:string[]};
 bounded_tool:{recall:number;response_bytes:number;scan:{complete:boolean;truncated:boolean};matches:{json_pointer:string;text:string;has_more:boolean}[]};wall_ms:number;
}
const protocol=JSON.parse(await readFile('examples/field-location-cpu-protocol.json','utf8')) as {queries:Query[]};
const manifest=JSON.parse(await readFile(join(input,'manifest.json'),'utf8')) as Record<'lock'|'commit',{sha256:string;bytes:number}>;
const sources={} as Record<'lock'|'commit',string>;
for(const key of ['lock','commit'] as const){const data:Buffer=await readFile(join(input,key==='lock'?'package-lock.json':'commit.json'));assert.equal(createHash('sha256').update(data).digest('hex'),manifest[key].sha256);sources[key]=data.toString('utf8');}
const artifacts=new Map<string,ContextArtifact>();const store:ContextArtifactStore={put:async a=>{artifacts.set(a.id,a);},get:async id=>artifacts.get(id)};
const reader=createContextReadTool(store);const locator=createContextSearchTool(store);
const artifactBySource={} as Record<'lock'|'commit',ContextArtifact>;
for(const key of ['lock','commit'] as const){const a=await contextArtifact(sources[key],'tool-result');await store.put(a);artifactBySource[key]=a;}
const rows:DiagnosticRow[]=[];
for(const q of protocol.queries){
 for(const pointer of q.targets)resolveContextPointer(parseContextJson(sources[q.source]),pointer);
 const began=performance.now();const found=searchContextFields(sources[q.source],q.query,20);const lexical=new ContextLexicalIndex(found.fields.map(f=>f.json_pointer)).score(q.query);
 const pathOrder=lexical.map((score,i)=>({score,i})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.i-b.i).map(r=>found.fields[r.i]!.json_pointer);
 const fullOrder=found.ranked.map(r=>found.fields[r.i]!.json_pointer);
 const response=await locator.execute('diagnostic-'+q.id,{artifact_id:artifactBySource[q.source].id,query:q.query,limit:20});
 const text=response.content.find(p=>p.type==='text');assert.ok(text?.type==='text');
 const wire=JSON.parse(text.text) as {matches:{json_pointer:string;text:string;has_more:boolean}[];scan:{complete:boolean;truncated:boolean}};
 const recall=(paths:string[])=>q.targets.filter(target=>paths.includes(target)).length/q.targets.length;
 rows.push({id:q.id,source:q.source,query:q.query,targets:q.targets,path_only:{recall5:recall(pathOrder.slice(0,5)),recall10:recall(pathOrder.slice(0,10)),top10:pathOrder.slice(0,10)},path_labels_preview:{recall5:recall(fullOrder.slice(0,5)),recall10:recall(fullOrder.slice(0,10)),top10:fullOrder.slice(0,10)},bounded_tool:{recall:recall(wire.matches.map(m=>m.json_pointer)),response_bytes:Buffer.byteLength(text.text),scan:wire.scan,matches:wire.matches},wall_ms:performance.now()-began});
}
// Independent literal expectations are fixed here; the parser under test does not generate them.
const numericRaw='{"transaction_id":9007199254740993,"amount":0.1000000000000000001,"nested":{"overflow":1e999,"negative_zero":-0}}';
const exact=['9007199254740993','0.1000000000000000001','{"overflow":1e999,"negative_zero":-0}'];
const numeric=await contextArtifact(numericRaw,'tool-result');await store.put(numeric);
const args={artifact_id:numeric.id,json_pointers:['/transaction_id','/amount','/nested'],offset:0,limit:1024};
const beforeModule=await import(pathToFileURL(oldCore).href) as {createContextReadTool:typeof createContextReadTool};
const numericResults=[];
for(const [variant,tool] of [['frozen-contextlab3',beforeModule.createContextReadTool(store)],['contextlab4',reader]] as const){const result=await tool.execute('numeric-source-control',args);const text=result.content.find(p=>p.type==='text');assert.ok(text?.type==='text');const values=(JSON.parse(text.text) as {values:{text:string}[]}).values.map(v=>v.text);numericResults.push({variant,expected:exact,actual:values,exact_fields:values.filter((v,i)=>v===exact[i]).length});}
assert.deepEqual(numericResults[1]?.actual,exact);
const average=(f:(row:DiagnosticRow)=>number)=>rows.reduce((n,r)=>n+f(r),0)/rows.length;
const summary={queries:rows.length,path_only_recall10:average(r=>r.path_only.recall10),path_labels_preview_recall10:average(r=>r.path_labels_preview.recall10),bounded_tool_recall:average(r=>r.bounded_tool.recall),max_response_bytes:Math.max(...rows.map(r=>r.bounded_tool.response_bytes)),all_structural_scans_complete:rows.every(r=>r.bounded_tool.scan.complete)};
await writeFile(output,JSON.stringify({kind:'CPU field-location diagnostic on real software metadata + synthetic exact-numeric controls; not a model accuracy benchmark',protocol_sha256:createHash('sha256').update(await readFile('examples/field-location-cpu-protocol.json')).digest('hex'),sources:manifest,summary,numeric_control:{source:numericRaw,results:numericResults},rows,model_calls:0,GPU_used:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({summary,numeric_control:numericResults.map(r=>({variant:r.variant,exact_fields:r.exact_fields}))}));

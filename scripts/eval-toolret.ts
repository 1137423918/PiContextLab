import { readFile,writeFile } from 'node:fs/promises';
import { ContextLexicalIndex } from '@earendil-works/pi-agent-core';
import { hash } from '../src/domain.js';
const [path,out]=process.argv.slice(2);if(!path||!out)throw new Error('NORMALIZED_JSON OUTPUT');
interface ToolDoc{id:string;name:string;description:string;parameters:unknown;raw:string;}
interface Query{id:string;query:string;positive_ids:string[];}
interface RetrievalRow{id:string;positive_ids:string[];top10:string[];recall:Record<string,number>;all_positive_coverage:Record<string,number>;reciprocal_rank10:number;budgeted_selected:string[];budgeted_recall:number;budgeted_schema_bytes:number;wall_ms:number;}
const data=JSON.parse(await readFile(path,'utf8')) as {tools:ToolDoc[];queries:Query[];normalization_fallback_ids:string[]};
const variants=['name-only','raw-document','framework-fields'] as const;const results=[];
for(const variant of variants){
 const began=performance.now();const docs=data.tools.map(t=>variant==='name-only'?t.name:variant==='raw-document'?t.raw:`${t.name} ${t.name} ${t.description} ${JSON.stringify(t.parameters)}`);const index=new ContextLexicalIndex(docs);const indexSeconds=(performance.now()-began)/1000;const rows:RetrievalRow[]=[];
 const schemaBytes=data.tools.map(t=>Buffer.byteLength(JSON.stringify({name:t.name,description:t.description,parameters:t.parameters}),'utf8'));
 for(const q of data.queries){
  const start=performance.now(),scores=index.score(q.query);const order=scores.map((score,i)=>({score,i})).sort((a,b)=>b.score-a.score||a.i-b.i);const positives=new Set(q.positive_ids);const top=order.slice(0,10).map(r=>data.tools[r.i]!.id);const recalls:Record<string,number>={},coverage:Record<string,number>={};
  for(const k of [1,3,5,10]){const n=top.slice(0,k).filter(id=>positives.has(id)).length;recalls[String(k)]=n/positives.size;coverage[String(k)]=Number(n===positives.size);}
  const first=top.findIndex(id=>positives.has(id));let bytes=0;const selected:string[]=[];for(const item of order){if(selected.length===8)break;const size=schemaBytes[item.i]!;if(bytes+size<=8192){selected.push(data.tools[item.i]!.id);bytes+=size;}}
  rows.push({id:q.id,positive_ids:q.positive_ids,top10:top,recall:recalls,all_positive_coverage:coverage,reciprocal_rank10:first<0?0:1/(first+1),budgeted_selected:selected,budgeted_recall:selected.filter(id=>positives.has(id)).length/positives.size,budgeted_schema_bytes:bytes,wall_ms:performance.now()-start});
 }
 const average=(f:(r:typeof rows[number])=>number)=>rows.reduce((n,r)=>n+f(r),0)/rows.length;
 results.push({variant,index_seconds:indexSeconds,total_wall_seconds:(performance.now()-began)/1000,queries:rows.length,corpus:data.tools.length,mean_recall:Object.fromEntries([1,3,5,10].map(k=>[String(k),average(r=>r.recall[String(k)]!)])),all_positive_coverage:Object.fromEntries([1,3,5,10].map(k=>[String(k),average(r=>r.all_positive_coverage[String(k)]!)])),MRR10:average(r=>r.reciprocal_rank10),mean_budgeted_recall:average(r=>r.budgeted_recall),mean_schema_bytes:average(r=>r.budgeted_schema_bytes),rows});
 console.log(JSON.stringify({...results.at(-1),rows:undefined}));
}
await writeFile(out,JSON.stringify({dataset:'ToolRet API-Bank101 vs entire web37292 corpus; not full benchmark score',protocol_sha256:hash(JSON.parse(await readFile('examples/toolret-protocol.json','utf8'))),normalization_fallback_ids:data.normalization_fallback_ids,query_text:'query only; instruction and labels excluded from ranker inputs',model_calls:0,GPU_used:false,results},null,2));

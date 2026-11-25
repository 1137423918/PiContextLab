import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configuredProvider, Runner } from '../src/runtime.js';
import { Warehouse } from '../src/warehouse.js';
import { Store } from '../src/store.js';
import { exportReport } from '../src/report.js';
const [datasetRoot, output] = process.argv.slice(2); if (!datasetRoot || !output) throw new Error('DATASET_ROOT OUTPUT');
await mkdir(output,{recursive:true});
const protocol=JSON.parse(await readFile(process.env.METRICLAB_MODEL_PROTOCOL ?? 'examples/deepseek-protocol.json','utf8')) as { cases:{id:string;question:string;max_calls:number;max_output:number}[] };
const warehouse=new Warehouse(datasetRoot);const datasets=await warehouse.list();if(datasets.length!==1)throw new Error('Expected exactly one frozen dataset');const dataset=datasets[0]!;
const store=new Store(join(output,'jobs.sqlite'));const provider=configuredProvider();const runner=new Runner(store,warehouse,provider.stream,provider.model,provider.requestTimeoutMs,provider.maxContextBytes,provider.contextMode,provider.artifactSearch);
const results=[];
try{for(const c of protocol.cases){const job=store.create(dataset.id,c.question,c.max_calls,c.max_output);const began=performance.now();await runner.run(job.id);const report=store.report(job.id);const result={case:c.id,question:c.question,wall_seconds:(performance.now()-began)/1000,job:store.job(job.id),calls:store.calls(job.id),evidence:store.evidence(job.id),report,events:store.events(job.id)};results.push(result);await writeFile(join(output,`${c.id}.json`),JSON.stringify(result,null,2));if(report)await writeFile(join(output,`${c.id}.html`),exportReport(report,null));}
 await writeFile(join(output,'results.json'),JSON.stringify({kind:'real bounded provider integration, not an accuracy benchmark',model:provider.model,request_timeout_ms:provider.requestTimeoutMs,max_context_bytes:provider.maxContextBytes,cases:results,total_reserved:results.reduce((n,r)=>n+r.calls.length,0),GPU_used:false},null,2));console.log(JSON.stringify({real_model_finished:true,cases:results.map(r=>({id:r.case,status:r.job.status,requests:r.calls.length,report:!!r.report,error:r.job.error})),total_reserved:results.reduce((n,r)=>n+r.calls.length,0)}));
}finally{await runner.shutdown();store.close();}

import { readFile,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Warehouse } from '../src/warehouse.js';
import { Store } from '../src/store.js';
import { gradeBusinessReport,type BusinessOracle } from './business-evaluation.js';

const [datasets,oraclePath,output]=process.argv.slice(2);if(!datasets||!oraclePath||!output)throw new Error('DATASETS ORACLE NEW_OUTPUT');
const oracle=JSON.parse(await readFile(oraclePath,'utf8')) as {csv_sha256:string;cases:Record<string,BusinessOracle>};const warehouse=new Warehouse(datasets),store=new Store(':memory:');const id='ds_'+oracle.csv_sha256.slice(0,24);const results=[];
try{
 for(const [name,c] of Object.entries(oracle.cases)){
  const job=store.create(id,'CPU arithmetic reconciliation',6,1024,c.comparison),claim=store.claim(job.id);const comparison=await warehouse.compare(id,c.comparison),breakdown=await warehouse.breakdown(id,{comparison:c.comparison,dimension:c.dimension as 'country'|'stock_code',limit:c.limit});
  for(const e of [comparison,breakdown])store.commitTool(claim,e.id,{cpu:true},{},e);
  const report=store.submit(claim,{title:'CPU reconciliation',evidence_ids:[comparison.id,breakdown.id],interpretation:'CPU only, no model output',hypotheses:[]});const grade=gradeBusinessReport(report,c,oracle.csv_sha256);assert.ok(grade.passed,grade.error??'Mismatch');results.push({case:name,grade,totals:c.totals});
 }
 await writeFile(output,JSON.stringify({kind:'Independent CSV Decimal vs DuckDB arithmetic; no model calls',results,passed:true,model_calls:0,GPU_used:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:true,results}));
}finally{store.close();}

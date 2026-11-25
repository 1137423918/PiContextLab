import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { fixture,comparison } from './fixtures.js';
import { gradeBusinessReport,type BusinessOracle } from '../scripts/business-evaluation.js';

test('business grader checks independent amounts, all selected/remainder groups and source identity',async()=>{
 const f=await fixture();try{
  const job=f.store.create(f.dataset.id,'Independent grading fixture',6,1024,comparison),claim=f.store.claim(job.id);const c=await f.warehouse.compare(f.dataset.id,comparison),b=await f.warehouse.breakdown(f.dataset.id,{comparison,dimension:'country',limit:2});for(const e of [c,b])f.store.commitTool(claim,e.id,{fixture:true},{},e);
  const report=f.store.submit(claim,{title:'Grader fixture',evidence_ids:[c.id,b.id],interpretation:'Fixture',hypotheses:[]});
  const oracle:BusinessOracle={comparison,dimension:'country',limit:2,totals:{baseline:'5.2050',current:'13.0950',delta:'7.8900'},groups:[{dimension:'UK',baseline:'1.2050',current:'8.1000',delta:'6.8950'},{dimension:'FR',baseline:'4.0000',current:'0.0000',delta:'-4.0000'},{dimension:null,baseline:'0.0000',current:'4.9950',delta:'4.9950'}]};
  assert.equal(gradeBusinessReport(report,oracle,f.dataset.csv_sha256).passed,true);
  assert.equal(gradeBusinessReport(null,oracle,f.dataset.csv_sha256).passed,false);
  assert.equal(gradeBusinessReport(report,oracle,'0'.repeat(64)).passed,false);
  assert.equal(gradeBusinessReport(report,{...oracle,limit:1},f.dataset.csv_sha256).passed,false);
  assert.equal(gradeBusinessReport(report,{...oracle,totals:{...oracle.totals,current:'13.0951'}},f.dataset.csv_sha256).passed,false);
  assert.equal(gradeBusinessReport(report,{...oracle,groups:oracle.groups.map(g=>g.dimension==='FR'?{...g,delta:'-4.0001'}:g)},f.dataset.csv_sha256).passed,false);
 }finally{f.store.close();await rm(f.root,{recursive:true,force:true});}
});

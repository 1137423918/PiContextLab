import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRawGroups,gradePressureReport,type PressureOracle,type PressureProtocol } from '../scripts/pressure-business-evaluation.js';
import { comparison } from './fixtures.js';
import type { BusinessOracle } from '../scripts/business-evaluation.js';

test('full group verifier checks both periods and rejects corruption, omitted groups and repeated period rows',()=>{
 const expected:BusinessOracle={comparison,dimension:'country',limit:1,totals:{baseline:'1.1000',current:'2.2000',delta:'1.1000'},groups:[{dimension:null,baseline:'1.1000',current:'2.2000',delta:'1.1000'}]};const rows=[{dimension:null,period:'baseline',value:'1.1000'},{dimension:null,period:'current',value:'2.2000'}];assert.equal(verifyRawGroups(rows,expected),1);
 assert.throws(()=>verifyRawGroups([{...rows[0],value:'1.1001'},rows[1]!],expected));assert.throws(()=>verifyRawGroups([],expected));assert.throws(()=>verifyRawGroups([...rows,rows[0]!],expected));
});

test('multi-metric grader rejects absent and partial report evidence before accepting any task score',()=>{
 const protocol={intent:comparison,components:[]} as unknown as PressureProtocol;const oracle:PressureOracle={csv_sha256:'0'.repeat(64),rows:541909,components:{}};
 assert.equal(gradePressureReport(null,protocol,oracle).passed,false);
 assert.equal(gradePressureReport({id:'control',job:'control',dataset:'control',title:'partial',evidence:[],interpretation:'control',hypotheses:[],created:0},protocol,oracle).passed,false);
});

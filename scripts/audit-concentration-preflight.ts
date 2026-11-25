/** Reject deliberately corrupted outputs against the independent CSV oracle; original control grades remain unchanged. */
import { readFile,writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import type { Report } from '../src/store.js';
import { gradeConcentration,type ConcentrationProtocol,type ConcentrationOracle } from './concentration-evaluation.js';
const [input,oraclePath,output]=process.argv.slice(2);if(!input||!oraclePath||!output)throw new Error('INPUT_GZ ORACLE OUTPUT');
const data=JSON.parse(gunzipSync(await readFile(input)).toString()) as {rows:{summary:{case:string;variant:string;grade:{passed:boolean}};report:Report|null}[]},oracle=JSON.parse(await readFile(oraclePath,'utf8')) as ConcentrationOracle,protocol=JSON.parse(await readFile('examples/concentration-study-protocol.json','utf8')) as ConcentrationProtocol;
let successes=0,negativeChecks=0;
for(const row of data.rows){const c=protocol.cases.find(c=>c.id===row.summary.case);assert.ok(c);const original=gradeConcentration(row.report,c,oracle.cases[c.id]!,oracle.csv_sha256);assert.equal(original.passed,row.summary.grade.passed);if(!original.passed)continue;successes++;assert.ok(row.report);
 for(const field of ['comparison','sum','missing-source','wrong-delta','duplicate-group','missing-report'] as const){
  const report:Report=structuredClone(row.report);const body=JSON.parse(report.interpretation) as {comparison:{delta:string};dimensions:{evidence_id:string;top3_absolute_delta_sum:string;leading_groups:{group:string|null;delta:string}[]}[]};
  if(field==='comparison')body.comparison.delta='-999999999999.0000';
  if(field==='sum')body.dimensions[0]!.top3_absolute_delta_sum='0.0000';
  if(field==='missing-source')body.dimensions[0]!.evidence_id='ev_not_saved';
  if(field==='wrong-delta')body.dimensions[0]!.leading_groups[0]!.delta='-999999999999.0000';
  if(field==='duplicate-group')body.dimensions[0]!.leading_groups[1]=structuredClone(body.dimensions[0]!.leading_groups[0]!);
  report.interpretation=JSON.stringify(body);assert.equal(gradeConcentration(field==='missing-report'?null:report,c,oracle.cases[c.id]!,oracle.csv_sha256).passed,false,field);negativeChecks++;
 }
}
assert.ok(successes>0,'No successful source-view control, stop before paid study');await writeFile(output,JSON.stringify({positive_controls:successes,corrupt_or_missing_claims_rejected:negativeChecks,independent_CSV_oracle:true,real_model_calls:0,original_grades_unchanged:true},null,2)+'\n',{flag:'wx'});

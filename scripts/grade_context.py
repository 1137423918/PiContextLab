"""Grade already-recorded answers by exact decimal value; never reissue model requests."""
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import sys

source=Path(sys.argv[1]);out=Path(sys.argv[2]);data=json.loads(source.read_text());graded=[]
for row in data['results']:
 expected=row['expected'];answer=row.get('answer');passed=False
 try:
  passed=(isinstance(answer,dict) and answer.get('report_id')==expected['report_id'] and answer.get('leading_country')==expected['leading_country'] and Decimal(str(answer.get('net_delta_gbp')))==Decimal(expected['net_delta_gbp']) and Decimal(str(answer.get('leading_country_delta_gbp')))==Decimal(expected['leading_country_delta_gbp']) and row['error'] is None and bool(row['calls']) and row['calls'][-1]['stop']=='stop')
 except (InvalidOperation,ValueError,TypeError):pass
 graded.append({**row,'initial_string_only_grade':row['passed'],'passed':passed})
result={**data,'grading':'Exact semantic4-field match; decimal strings and JSON numbers both accepted. Original string-only grades preserved. No requests rerun. Rule clarified from the output contract before inspecting answers.','recorded_source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'results':graded};out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'total_requests':data['total_requests'],'results':[{'case':r['case'],'variant':r['variant'],'passed':r['passed'],'initial_grade':r['initial_string_only_grade'],'requests':r['requests'],'input_tokens':r['input_tokens'],'error':r['error']} for r in graded]}))

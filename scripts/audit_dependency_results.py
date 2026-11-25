"""Independent Python equality checker against the complete pinned public npm lock; no model input."""
from pathlib import Path
import gzip, hashlib, json, sys
source_results, output = map(Path, sys.argv[1:])
protocol=json.loads(Path('examples/dependency-audit-protocol.json').read_text())
raw=Path(protocol['input_file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==protocol['input_sha256']
document=json.loads(raw);results=json.loads(gzip.decompress(source_results.read_bytes()));rows=[]
for row in results['rows']:
 case=next(c for c in protocol['cases'] if c['id']==row['summary']['case']);answer=row.get('answer');passed=False;error=None
 try:
  assert isinstance(answer,dict) and isinstance(answer['records'],list)
  assert sorted(r['json_pointer'] for r in answer['records'])==sorted(case['pointers'])
  for r in answer['records']:
   expected=document
   for key in r['json_pointer'][1:].split('/'):expected=expected[key.replace('~1','/').replace('~0','~')]
   assert json.loads(r['source_json'])==expected
  passed=True
 except (AssertionError,KeyError,TypeError,ValueError) as exc:error=type(exc).__name__
 assert passed==row['summary']['grade']['passed'], 'Independent checker and original grade disagree'
 rows.append({'case':case['id'],'variant':row['summary']['variant'],'passed':passed,'error':error})
with output.open('x') as stream:json.dump({'input_sha256':protocol['input_sha256'],'rows':rows,'all_original_grades_match':True,'model_calls_added':0},stream,indent=2)
print(json.dumps({'checked':len(rows),'passed':sum(r['passed'] for r in rows),'all_original_grades_match':True}))

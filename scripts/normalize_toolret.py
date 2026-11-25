"""Normalize benchmark strings at the dataset boundary; labels never enter documents."""
import ast
import hashlib
import json
from pathlib import Path
import sys

root=Path(sys.argv[1]);queries=json.loads((root/'queries-raw.json').read_text());corpus=json.loads((root/'corpus-raw.json').read_text());fallback=[]
def parse(text):
 try:return json.loads(text)
 except (ValueError,TypeError):return ast.literal_eval(text)
tools=[]
for row in corpus:
 raw=row['documentation']
 try:
  doc=parse(raw)
  if not isinstance(doc,dict):raise ValueError('Expected object')
 except (ValueError,SyntaxError,TypeError):doc={'name':row['id'],'description':raw,'parameters':{}};fallback.append(row['id'])
 name=str(doc.get('name',row['id']));description=str(doc.get('description',''));parameters=doc.get('parameters',{})
 # Non-finite legacy schema annotations are represented explicitly as null; original bytes stay in source files.
 def clean(v):
  if isinstance(v,float) and (v!=v or abs(v)==float('inf')):return None
  if isinstance(v,dict):return {str(k):clean(x) for k,x in v.items()}
  if isinstance(v,(list,tuple)):return [clean(x) for x in v]
  return v
 parameters=clean(parameters)
 tools.append({'id':row['id'],'name':name,'description':description,'parameters':parameters,'raw':raw})
tasks=[];ids={t['id'] for t in tools}
for row in queries:
 labels=parse(row['labels']);positive=sorted({x['id'] for x in labels if x.get('relevance',1)>0})
 if not positive or not set(positive)<=ids:raise ValueError('Query has missing positive labels: '+row['id'])
 tasks.append({'id':row['id'],'query':row['query'],'positive_ids':positive})
assert len(tasks)==101 and len(tools)==37292,(len(tasks),len(tools))
output={'protocol':'ToolRet API-Bank all101queries against full37292web tools','queries':tasks,'tools':tools,'normalization_fallback_ids':fallback};dest=root/'normalized.json';dest.write_text(json.dumps(output,ensure_ascii=False,allow_nan=False));print(json.dumps({'queries':len(tasks),'tools':len(tools),'fallback_documents':len(fallback),'normalized_sha256':hashlib.sha256(dest.read_bytes()).hexdigest()}))

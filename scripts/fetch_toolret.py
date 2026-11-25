"""Fetch the two fixed public source files; no model or embedding call."""
import hashlib
import json
from pathlib import Path
import sys
import urllib.request
import shutil

protocol=json.loads(Path('examples/toolret-protocol.json').read_text());out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=False);records={}
for kind in ['queries','corpus']:
 row=protocol[kind];url='https://huggingface.co/datasets/'+row['repo']+'/resolve/'+row['revision']+'/'+row['file'];dest=out/(kind+'.parquet');size=0
 if len(sys.argv)>2:
  source=Path(sys.argv[2])/(kind+'.parquet');assert hashlib.sha256(source.read_bytes()).hexdigest()==row['sha256'];shutil.copyfile(source,dest);size=dest.stat().st_size
 else:
  with urllib.request.urlopen(url,timeout=45) as response,dest.open('xb') as stream:
   while True:
    chunk=response.read(1024*1024)
    if not chunk:break
    size+=len(chunk)
    if size>32*1024**2:raise ValueError('Frozen data download exceeds32MiB cap')
    stream.write(chunk)
 assert hashlib.sha256(dest.read_bytes()).hexdigest()==row['sha256']
 records[kind]={'url':url,'bytes':size,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()}
(out/'source-manifest.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(records))

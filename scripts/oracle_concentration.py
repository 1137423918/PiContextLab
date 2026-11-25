"""Independent Decimal CSV oracle for a fresh concentration/offset task family; never model input."""
from pathlib import Path
from decimal import Decimal
import csv, hashlib, json, sys
source, protocol_file, output = map(Path, sys.argv[1:])
protocol=json.loads(protocol_file.read_text());assert hashlib.sha256(source.read_bytes()).hexdigest()==protocol['dataset_csv_sha256']
cases={c['id']:{'comparison':{'baseline':Decimal(0),'current':Decimal(0)},'dimensions':{d:{} for d in ['country','stock_code']}} for c in protocol['cases']};rows=0
with source.open(newline='') as stream:
 for row in csv.DictReader(stream):
  rows+=1;price=Decimal(row['unit_price']);qty=int(row['quantity']);cancel=row['invoice_no'].upper().startswith('C')
  if price<=0 or cancel and qty>=0:continue
  for c in protocol['cases']:
   period=next((p for p in ['baseline','current'] if c['intent'][p]['start']<=row['invoice_time'][:10]<c['intent'][p]['end']),None)
   if period is None:continue
   value=price*qty if c['intent']['metric']=='net_sales' or qty>0 and not cancel else Decimal(0)
   state=cases[c['id']];state['comparison'][period]+=value
   for d in state['dimensions']:state['dimensions'][d].setdefault(row[d] or None,{'baseline':Decimal(0),'current':Decimal(0)})[period]+=value
assert rows==541909
fmt=lambda v:format(v,'.4f')
for c in protocol['cases']:
 state=cases[c['id']];pair=state['comparison'];pair['delta']=pair['current']-pair['baseline'];state['comparison']={k:fmt(v) for k,v in pair.items()}
 for d,data in state['dimensions'].items():
  state['dimensions'][d]={'comparison':c['intent'],'dimension':d,'limit':20,'totals':state['comparison'],'groups':[{'dimension':name,**{k:fmt(v) for k,v in pair.items()},'delta':fmt(pair['current']-pair['baseline'])} for name,pair in sorted(data.items(),key=lambda kv:str(kv[0]))]}
with output.open('x') as stream:json.dump({'rows':rows,'csv_sha256':protocol['dataset_csv_sha256'],'cases':cases},stream,indent=2)
print(json.dumps({'rows':rows,'cases':{name:{'groups':{d:len(v['groups']) for d,v in case['dimensions'].items()}} for name,case in cases.items()}}))

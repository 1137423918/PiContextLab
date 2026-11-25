"""Run bounded native-client and context-ablation studies through DeepSeek only."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess

p=argparse.ArgumentParser();p.add_argument('--node',type=Path,required=True);p.add_argument('--dataset-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
assert os.environ.get('DEEPSEEK_API_KEY') and os.environ.get('METRICLAB_MODEL_URL')=='https://api.deepseek.com'
child=None
def interrupt(_signum,_frame):raise KeyboardInterrupt('Study interrupted; charged/unknown attempts stay in ledgers')
signal.signal(signal.SIGTERM,interrupt)
try:
 for name,args in [('native-runtime',['dist/scripts/real-model.js',str(a.dataset_root),str(a.output/'native-runtime')]),('context-ablation',['dist/scripts/eval-context.js',str(a.output/'context-ablation')])]:
  child=subprocess.Popen([str(a.node),*args]);code=child.wait(timeout=650)
  if code!=0:raise RuntimeError(name+' driver exited '+str(code))
 native=json.loads((a.output/'native-runtime/results.json').read_text());study=json.loads((a.output/'context-ablation/results.json').read_text());assert native['total_reserved']<=9 and study['total_requests']<=21
 result={'finished':True,'provider':'official DeepSeek API','local_model_deployment':False,'GPU_used':False,'total_requests':native['total_reserved']+study['total_requests'],'native_cases':[{'case':x['case'],'status':x['job']['status'],'requests':len(x['calls']),'report':bool(x['report'])} for x in native['cases']],'ablation':[{'case':x['case'],'variant':x['variant'],'passed':x['passed'],'requests':x['requests'],'input_tokens':x['input_tokens'],'estimated_cost_usd':x['estimated_cost_usd'],'error':x['error']} for x in study['results']]}
 (a.output/'summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
finally:
 if child and child.poll() is None:
  child.terminate()
  try:child.wait(timeout=5)
  except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)

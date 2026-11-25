"""Once-only bounded official DeepSeek integration and prospectively frozen v4 ablation."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess

p=argparse.ArgumentParser();p.add_argument('--node',type=Path,required=True);p.add_argument('--dataset-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
assert os.environ.get('DEEPSEEK_API_KEY') and os.environ.get('METRICLAB_MODEL_URL')=='https://api.deepseek.com'
os.environ['METRICLAB_MODEL_PROTOCOL']='examples/native-v4-protocol.json'
child=None
def interrupt(_signum,_frame):raise KeyboardInterrupt('Interrupted; original charged attempts and partial checkpoints stay closed')
signal.signal(signal.SIGTERM,interrupt)
try:
 for name,args in [('native-runtime',['dist/scripts/real-model.js',str(a.dataset_root),str(a.output/'native-runtime')]),('context-ablation',['dist/scripts/eval-context-v4.js',str(a.output/'native-runtime/results.json'),str(a.output/'context-ablation')])]:
  child=subprocess.Popen([str(a.node),*args]);code=child.wait(timeout=650)
  if code!=0:raise RuntimeError(name+' exited '+str(code))
 native=json.loads((a.output/'native-runtime/results.json').read_text());audit=json.loads((a.output/'context-ablation/results.json').read_text())
 assert native['total_reserved']<=9 and audit['total_requests']<=24
 result={'finished':True,'complete':audit['complete'],'source_commit':os.environ.get('METRICLAB_AUDIT_SOURCE_COMMIT'),'provider':'official DeepSeek API','local_model_deployment':False,'GPU_used':False,'total_requests':native['total_reserved']+audit['total_requests'],'native_cases':[{'case':c['case'],'status':c['job']['status'],'requests':len(c['calls']),'report':bool(c['report'])} for c in native['cases']],'ablation':[{k:r[k] for k in ['case','variant','passed','requests','input_tokens','estimated_cost_usd','error']} for r in audit['results']]}
 (a.output/'summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
finally:
 if child and child.poll() is None:
  child.terminate()
  try:child.wait(timeout=5)
  except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)

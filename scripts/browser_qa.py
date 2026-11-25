"""Real browser workflow and narrow-screen QA; never fabricates human review."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('--node',type=Path,required=True);p.add_argument('--home',type=Path,required=True);p.add_argument('--browser',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
env=os.environ.copy();env['PORT']=str(port);env['METRICLAB_HOME']=str(a.home)
env.pop('METRICLAB_MODEL_URL',None);env.pop('METRICLAB_API_KEY',None)
env.pop('DEEPSEEK_API_KEY',None)
errors=[];network=[];checks=[];server=None
def check(name,condition):
 if not condition:raise AssertionError(name)
 checks.append(name)
try:
 with (a.output/'web-server.log').open('wb') as log:
  server=subprocess.Popen([str(a.node),'dist/src/cli.js','serve','--scripted-control'],env=env,stdout=log,stderr=subprocess.STDOUT)
  for _ in range(100):
   if server.poll() is not None:raise RuntimeError('Web server exited')
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/overview',timeout=1) as r:
     if r.status==200:break
   except OSError:time.sleep(.1)
  else:raise TimeoutError('Web readiness')
  with sync_playwright() as play:
   browser=play.chromium.launch(executable_path=str(a.browser),headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--renderer-process-limit=2'])
   context=browser.new_context(viewport={'width':1365,'height':1000},device_scale_factor=1,accept_downloads=True)
   def route(req):
    if req.request.url.startswith(f'http://127.0.0.1:{port}/'):req.continue_()
    else:network.append(req.request.url);req.abort()
   context.route('**/*',route)
   page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(f'http://127.0.0.1:{port}/',wait_until='networkidle');page.locator('#dataset option').first.wait_for(state='attached')
   check('full dataset visible','541,909' in page.locator('#coverage').inner_text());check('scripted control clearly labelled','scripted-control' in page.locator('#mode').inner_text())
   check('explicit comparison inputs available',page.locator('#intent-metric option').count()==7 and page.locator('input[type=date]').count()==4)
   page.screenshot(path=str(a.output/'overview-desktop.png'))
   page.locator('#question').fill('Compare October and November 2011 net sales by country, full calendar months.');page.locator('#start').click();page.locator('#status').filter(has_text='completed').wait_for(timeout=30000)
   check('actual Pi-backed job completes in browser',page.locator('#status').inner_text()=='completed');check('evidence rendered',page.locator('.evidence-item').count()==2)
   check('native policy trace visible',page.locator('#context-policy').is_visible() and 'JSON' in page.locator('#context-policy').inner_text() and 'submit_investigation' in page.locator('#context-policy').inner_text())
   check('model numbers are separate from sealed facts',page.locator('#report-card').is_visible());check('report is not human reviewed','尚未人工审核' in page.locator('#review-state').inner_text());check('review form available without agent approval',page.locator('#review-note').is_visible())
   page.screenshot(path=str(a.output/'investigation-desktop.png'))
   with page.expect_download() as pending:page.locator('#export').click()
   download=pending.value;download.save_as(str(a.output/'downloaded-report.html'));content=(a.output/'downloaded-report.html').read_text();check('offline export includes SQL and result checksums','Result SHA256' in content and 'SELECT' in content and 'Unreviewed' in content)
   active=page.evaluate("localStorage.getItem('metriclab-job')");page.reload(wait_until='domcontentloaded');page.locator('#status').filter(has_text='completed').wait_for();check('refresh restores selected job',page.evaluate("localStorage.getItem('metriclab-job')")==active)
   page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(a.output/'investigation-mobile.png'));check('narrow viewport has no horizontal overflow',page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
   page.locator('#detail').scroll_into_view_if_needed();page.screenshot(path=str(a.output/'report-mobile.png'))
   check('no JavaScript page errors',not errors);check('no external browser requests',not network)
   context.close();browser.close()
 result={'ready':True,'checks_passed':len(checks),'checks':checks,'page_errors':errors,'external_requests':network,'real_browser':True,'real_model_calls':0,'human_review_written':False,'GPU_used':False}
 (a.output/'browser-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
finally:
 if server and server.poll() is None:
  server.terminate()
  try:server.wait(timeout=8)
  except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)

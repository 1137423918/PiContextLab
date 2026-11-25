"""Inspect exported CPU regression reports. No model, approval, external network or GPU."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--browser',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
files=sorted(a.input.glob('*.html'));assert len(files)==5
checks=[];errors=[];network=[];verified=0;captured=False
with sync_playwright() as play:
    browser=play.chromium.launch(executable_path=str(a.browser),headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--renderer-process-limit=2'])
    context=browser.new_context(viewport={'width':1365,'height':1000},device_scale_factor=1)
    def route(request):
        if request.request.url.startswith('file://'):request.continue_()
        else:network.append(request.request.url);request.abort()
    context.route('**/*',route)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    for file in files:
        page.goto(file.resolve().as_uri(),wait_until='load')
        expected=file.name.endswith('-source-claims-v1.html')
        assert (page.locator('#claims-proof').count()==1)==expected
        assert 'Unreviewed' in page.locator('body').inner_text()
        if expected:
            verified+=1
            assert '未代替人工审核' in page.locator('#claims-proof').inner_text()
            if not captured:
                page.screenshot(path=str(a.output/'proof-desktop.png'))
                page.set_viewport_size({'width':390,'height':844})
                assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
                page.screenshot(path=str(a.output/'proof-mobile.png'));captured=True
                page.set_viewport_size({'width':1365,'height':1000})
        checks.append({'file':file.name,'source_proof_scope_visible':expected,'human_review':'Unreviewed'})
    assert verified==2 and not errors and not network
    context.close();browser.close()
result={'passed':True,'reports_checked':len(files),'proof_displays':verified,'checks':checks,'narrow_screen_no_overflow':True,'page_errors':errors,'external_requests':network,'real_browser':True,'real_model_calls':0,'GPU_used':False,'human_review_written':False}
(a.output/'browser-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

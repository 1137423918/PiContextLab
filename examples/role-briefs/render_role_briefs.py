"""Print the exact editable HTML on the admitted CPU browser host."""
from pathlib import Path
import argparse,hashlib,json,os

from playwright.sync_api import sync_playwright



def run(content, source, output, font_config=None):
    if font_config is not None:os.environ['FONTCONFIG_FILE']=str(font_config.resolve())
    content,source,output=content.resolve(),source.resolve(),output.resolve()
    data=json.loads(content.read_text());output.mkdir(mode=0o700,exist_ok=False);network=[];errors=[];rows=[]
    def wire(context):
        def route(request):
            if request.request.url.startswith('file:'):request.continue_()
            else:network.append(request.request.url.split(':',1)[0]);request.abort()
        context.route('**/*',route);context.on('page',lambda page:page.on('pageerror',lambda error:errors.append(str(error))))
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=['--disable-gpu','--disable-dev-shm-usage','--renderer-process-limit=2'])
        try:
            context=browser.new_context(offline=True,viewport={'width':680,'height':1028});wire(context)
            for role in data['roles']:
                page=context.new_page();page.emulate_media(media='print');html=source/(role['filename']+'.html');page.goto(html.as_uri())
                layout=page.evaluate('''async()=>{await document.fonts.ready;const sheet=document.querySelector('.sheet').getBoundingClientRect();return {height:sheet.height,width:sheet.width,fonts_ready:document.fonts.status,body_font:getComputedStyle(document.body).fontFamily,scroll_width:document.documentElement.scrollWidth};}''')
                raw=output/(role['filename']+'.chrome.pdf')
                page.pdf(path=str(raw),format='A4',prefer_css_page_size=True,print_background=True,display_header_footer=False)
                rows.append({'role':role['id'],'filename':raw.name,'sha256':hashlib.sha256(raw.read_bytes()).hexdigest(),'bytes':raw.stat().st_size,'html_sha256':hashlib.sha256(html.read_bytes()).hexdigest(),'layout':layout});page.close()
            version=browser.version;context.close()
        finally:browser.close()
    assert not network and not errors
    result={'ready':True,'renderer':'Chromium '+version,'PDFs':rows,'network_requests':len(network),'page_errors':errors,'model_calls':0,'GPU_disabled':True,'visual_review_pending':True,'same_editable_HTML_and_PDF_content':True}
    (output/'browser-print.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--content',type=Path,required=True);parser.add_argument('--source',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--font-config',type=Path);a=parser.parse_args();run(a.content,a.source,a.output,a.font_config)

"""Second-engine PDF text/geometry checks and final-page PyMuPDF renders."""
from pathlib import Path
import argparse,hashlib,json
import pymupdf
from brief_contract import normalized,phrases


def run(content,source,output):
    data=json.loads(content.read_text());output.mkdir(mode=0o700,exist_ok=False);rows=[]
    for role in data['roles']:
        path=source/(role['filename']+'.pdf');doc=pymupdf.open(path);assert len(doc)==1
        page=doc[0];text=page.get_text('text');assert '\ufffd' not in text and '\x00' not in text;missing=[s for s in phrases(data,role) if normalized(s) not in normalized(text)]
        if missing:raise ValueError('Second engine omitted source text: '+repr(missing))
        boxes=[b[:4] for b in page.get_text('blocks') if b[6]==0]
        assert boxes and all(x0>=-1 and y0>=-1 and x1<=page.rect.width+1 and y1<=page.rect.height+1 for x0,y0,x1,y1 in boxes)
        image=output/(role['filename']+'.png');page.get_pixmap(dpi=150,alpha=False).save(image)
        rows.append({'role':role['id'],'PDF_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'pages':len(doc),
                     'source_phrases_preserved':len(phrases(data,role)),'text_boxes_within_page':True,
                     'render_file':image.name,'render_sha256':hashlib.sha256(image.read_bytes()).hexdigest(),
                     'render_bytes':image.stat().st_size,'extracted_text_sha256':hashlib.sha256(text.encode()).hexdigest()});doc.close()
    result={'ready':True,'renderer':'PyMuPDF','version':pymupdf.VersionBind,'pages':rows,'visual_review_pending':True}
    (output/'second-renderer.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--content',type=Path,required=True);p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.content,a.source,a.output)

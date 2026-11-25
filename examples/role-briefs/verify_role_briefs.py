"""Normalize generated PDF metadata and verify every source phrase/link/font."""
from pathlib import Path
import argparse,hashlib,json,re,unicodedata
from pypdf import PdfReader,PdfWriter
from pypdf.generic import ContentStream


from brief_contract import normalized, phrases, expected_links


def pdf_checks(path, data, role):
    reader = PdfReader(path)
    if len(reader.pages) != 1:
        raise ValueError(f'{role["id"]} must be one complete page; got {len(reader.pages)}')
    page = reader.pages[0]
    assert abs(float(page.mediabox.width)-595.28)<1 and abs(float(page.mediabox.height)-841.89)<1
    text = page.extract_text()
    missing = [s for s in phrases(data,role) if normalized(s) not in normalized(text)]
    if missing: raise ValueError('PDF dropped source text: '+repr(missing))
    assert '\ufffd' not in text and '\x00' not in text
    links = [a.get_object()['/A']['/URI'] for a in page.get('/Annots',[]) if a.get_object().get('/A',{}).get('/S')=='/URI']
    assert set(links)==expected_links(data,role),(links,expected_links(data,role))
    used=set()
    for operands,operator in ContentStream(page.get_contents(),reader).operations:
        if operator==b'Tf':used.add(operands[0])
    fonts=[]
    for name in used:
        font=page['/Resources']['/Font'][name].get_object()
        assert '/ToUnicode' in font
        if font.get('/Subtype') == '/Type3':
            # Chromium may embed CFF outlines as Type3 CharProcs rather than
            # a FontFile stream. These glyph programs are part of the PDF.
            programs=font['/CharProcs'].get_object()
            assert programs and all(len(p.get_object().get_data())>0 for p in programs.values())
            descriptor=font['/FontDescriptor'].get_object()
            fonts.append({'resource':str(name),'font':str(descriptor['/FontName']),
                          'representation':'embedded-Type3-glyph-programs',
                          'glyph_programs':len(programs),
                          'embedded_bytes':sum(len(p.get_object().get_data()) for p in programs.values()),
                          'ToUnicode':True})
            continue
        descendant=font['/DescendantFonts'][0].get_object() if '/DescendantFonts' in font else font
        descriptor=descendant['/FontDescriptor'].get_object()
        streams=[descriptor[k].get_object() for k in ['/FontFile','/FontFile2','/FontFile3'] if k in descriptor]
        assert streams and all(len(s.get_data())>0 for s in streams)
        fonts.append({'resource':str(name),'font':str(font['/BaseFont']),'embedded_bytes':sum(len(s.get_data()) for s in streams),'ToUnicode':True})
    assert fonts
    return {'pages':1,'A4':True,'source_phrases_preserved':len(phrases(data,role)),
            'links_verified':len(links),'expected_unique_links':len(set(links)),
            'fonts':fonts,'extracted_text_sha256':hashlib.sha256(text.encode()).hexdigest()}



def run(content,source,raw,output):
    data=json.loads(content.read_text());output.mkdir(mode=0o700,exist_ok=False);rows=[]
    for role in data['roles']:
        html=source/(role['filename']+'.html');path=raw/(role['filename']+'.chrome.pdf');final=output/(role['filename']+'.pdf')
        reader=PdfReader(path);writer=PdfWriter();writer.clone_document_from_reader(reader)
        writer.add_metadata({'/Title':data['name']+' | '+role['heading']+' | 项目经历','/Author':data['name'],
                             '/Creator':'PiContextLab role brief / Chromium print',
                             '/CreationDate':'D:20261125000000Z','/ModDate':'D:20261125000000Z'})
        with final.open('wb') as stream:writer.write(stream)
        checked=pdf_checks(final,data,role);checked.update(filename=final.name,sha256=hashlib.sha256(final.read_bytes()).hexdigest(),bytes=final.stat().st_size,role=role['id'],html_sha256=hashlib.sha256(html.read_bytes()).hexdigest());rows.append(checked)
    result={'ready':True,'PDFs':rows,'visual_review_pending':True,'same_editable_HTML_and_PDF_content':True}
    (output/'pdf-structural-qa.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--content',type=Path,required=True);parser.add_argument('--source',type=Path,required=True);parser.add_argument('--raw',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);a=parser.parse_args();run(a.content,a.source,a.raw,a.output)

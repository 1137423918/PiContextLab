"""Prepare a private CJK document face with only the document Unicode mapping.

Retains glyph IDs for CFF/CID correctness; starts from the original face and
renames the derived font. Font files are private build inputs, not repo assets.
"""
from pathlib import Path
import argparse,hashlib,json
from html.parser import HTMLParser
from fontTools import subset
from fontTools.ttLib import TTFont
import fontTools


class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.parts=[];self.style=False
    def handle_starttag(self,tag,attrs):
        if tag=='style':self.style=True
    def handle_endtag(self,tag):
        if tag=='style':self.style=False
    def handle_data(self,text):
        if not self.style:self.parts.append(text)


def run(font_path,html_dir,output):
    source=font_path.read_bytes();parser=Text()
    for p in sorted(html_dir.glob('*.html')):parser.feed(p.read_text())
    text=''.join(parser.parts)+'-0123456789/()#.';needed={ord(c) for c in text if ord(c)>32}
    face=TTFont(font_path);before=face.getBestCmap();missing=sorted(needed-set(before))
    if missing:raise ValueError('Original font lacks characters: '+repr(missing))
    options=subset.Options(retain_gids=True);subsetter=subset.Subsetter(options=options);subsetter.populate(text=text);subsetter.subset(face)
    names={1:'Agent Lab Resume CJK',2:'Regular',3:'AgentLabResumeCJK-Regular-document',4:'Agent Lab Resume CJK Regular',6:'AgentLabResumeCJK-Regular',16:'Agent Lab Resume CJK',17:'Regular'}
    for record in list(face['name'].names):
        if record.nameID in names:face['name'].setName(names[record.nameID],record.nameID,record.platformID,record.platEncID,record.langID)
    if 'CFF ' in face:
        cff=face['CFF '].cff;cff.fontNames=['AgentLabResumeCJK-Regular'];top=cff.topDictIndex[0];top.FullName='Agent Lab Resume CJK Regular';top.FamilyName='Agent Lab Resume CJK'
        if hasattr(top,'FDArray'):
            for i,fd in enumerate(top.FDArray):
                if hasattr(fd,'FontName'):fd.FontName='AgentLabResumeCJK-Regular-'+str(i)
    output.mkdir(mode=0o700,exist_ok=False);font=output/'AgentLabResumeCJK-Regular.otf';face.save(font);face.close();check=TTFont(font);cmap=check.getBestCmap();assert needed<=set(cmap);duplicates={}
    for cp,glyph in cmap.items():duplicates.setdefault(glyph,[]).append(cp)
    ambiguities=[v for v in duplicates.values() if len(v)>1]
    check.close();(output/'fonts.conf').write_text('<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>'+str(output.resolve())+'</dir><cachedir>'+str(output.resolve()/'cache')+'</cachedir></fontconfig>\n')
    result={'ready':True,'source_font_sha256':hashlib.sha256(source).hexdigest(),'derived_font_sha256':hashlib.sha256(font.read_bytes()).hexdigest(),'fonttools':fontTools.__version__,'retain_gids':True,'renamed_private_face':'Agent Lab Resume CJK','Unicode_characters':len(cmap),'needed_characters_covered':len(needed),'remaining_glyph_Unicode_aliases':ambiguities,'original_font_unchanged':font_path.read_bytes()==source,'font_file_publicly_distributed':False};(output/'font-receipt.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--font',type=Path,required=True);p.add_argument('--html',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();run(a.font,a.html,a.output)

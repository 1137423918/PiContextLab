"""Render concise editable role briefs from pinned, evidence-linked source text.

This builder only writes new standalone documents; it does not touch the website,
run experiments or update PRs. Print the HTML on the admitted CPU render host.
"""
from __future__ import annotations
import argparse
import hashlib
import html
import json
from pathlib import Path
from urllib.parse import urlsplit


CSS = '''
@page{size:A4;margin:13mm 15mm 12mm}
*{box-sizing:border-box}body{margin:0;background:#eef2ef;color:#182f2c;font-family:"Agent Lab Resume CJK","Noto Sans CJK SC",sans-serif;font-size:10pt;line-height:1.47}
.sheet{width:210mm;min-height:297mm;margin:22px auto;background:#fff;padding:13mm 15mm 12mm}
header{border-bottom:1.5px solid #276859;padding-bottom:9px;margin-bottom:12px}.top{display:flex;justify-content:space-between;gap:12px;align-items:baseline}h1{font-size:25pt;line-height:1.15;margin:0 0 6px;font-weight:700;letter-spacing:-.3px}.role{font-size:13pt;font-weight:700;color:#276859;margin:0}.date{font-size:8pt;color:#58706a;white-space:nowrap}.tagline{font-size:9pt;margin:4px 0;color:#4f6660}.links{font-size:8.3pt;margin-top:7px}a{color:#276859;text-decoration:none}a:hover{text-decoration:underline}
h2{font-size:10pt;color:#276859;letter-spacing:.4px;margin:12px 0 5px;border-bottom:1px solid #dfe8e3;padding-bottom:4px}h3{font-size:11pt;margin:0 0 3px;line-height:1.35}p{margin:0}.paper-title{font-size:9pt;line-height:1.4;font-weight:600}.paper-detail{font-size:8.6pt;color:#50665f;margin-top:3px}.project{margin-top:10px;break-inside:avoid}.stack{font-size:8.2pt;color:#58706a;line-height:1.35;margin-bottom:4px}ul{list-style:none;padding-left:0;margin:4px 0 4px}li{position:relative;padding-left:12px;margin:0 0 4px;overflow-wrap:anywhere}li::before{content:"-";position:absolute;left:0}.result{font-size:9.1pt;line-height:1.45;color:#425e54;border-left:2px solid #b7d0c1;padding-left:8px;margin:5px 0}.project-links{font-size:8.3pt;margin-top:5px}.contribution{break-inside:avoid}.contribution p{margin-top:4px}.status{font-size:8.7pt;color:#52675f}footer{margin-top:12px;padding-top:7px;border-top:1px solid #dfe8e3;font-size:7.6pt;line-height:1.45;color:#62746c}footer .meta{display:flex;justify-content:space-between;margin-top:3px}.no-print{margin:12px auto;max-width:210mm;color:#50665f;font-size:13px}
@media print{body{background:white}.sheet{width:auto;min-height:0;margin:0;padding:0}.no-print{display:none}a{color:#276859}}
@media screen and (max-width:800px){.sheet{width:auto;min-height:0;margin:12px;padding:24px}.top{flex-wrap:wrap}body{font-size:15px}.no-print{margin:12px 24px}}
'''


def escaped(text):
    return html.escape(str(text), quote=True)


def link(label, url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Use public HTTPS evidence links')
    return f'<a href="{escaped(url)}">{escaped(label)}</a>'


def verify(data, evidence, root):
    if data['version'] != 2 or evidence['version'] != 2 or data['source_commits'] != evidence['source_commits']:
        raise ValueError('Brief/evidence source identity differs')
    for name, row in evidence['files'].items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Source evidence changed: ' + name)
    known = set(evidence['claims'])
    for role in data['roles']:
        for section in [data['paper'], role['contribution'], *[x for p in role['projects'] for x in [*p['bullets'], p['result']]]]:
            if not section['claims'] or not set(section['claims']) <= known:
                raise ValueError('Missing evidence binding')
    for name in ['algorithm', 'agent-app']:
        if len([r for r in data['roles'] if r['id'] == name]) != 1:
            raise ValueError('Need both requested role views')


def render(data, role):
    paper = data['paper']
    blocks = []
    for project in role['projects']:
        bullets = ''.join('<li>' + escaped(b['text']) + '</li>' for b in project['bullets'])
        links = ' / '.join(link(x['label'], x['url']) for x in project['links'])
        blocks.append(f'<section class="project"><h3>{escaped(project["title"])}</h3>'
                      f'<p class="stack">{escaped(project["stack"])}</p><ul>{bullets}</ul>'
                      f'<p class="result">{escaped(project["result"]["text"])}</p>'
                      f'<p class="project-links">{links}</p></section>')
    contribution = role['contribution']
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'">
<title>{escaped(data['name'])} | {escaped(role['heading'])} | 项目经历</title><style>{CSS}</style></head><body>
<p class="no-print">可编辑项目经历附件。浏览器打印使用 A4；正文与 PDF 来自同一份 content.json。</p>
<main class="sheet"><header><div class="top"><h1>{escaped(data['name'])}</h1><span class="date">更新 {escaped(data['date'])}</span></div>
<p class="role">{escaped(role['heading'])}</p><p class="tagline">{escaped(role['summary'])}</p>
<p class="links">{link('GitHub: 1137423918', data['github'])} / {link('项目源码与证据', data['project_url'])}</p></header>
<section class="paper"><h2>{escaped(paper['label'])}</h2><p class="paper-title">{escaped(paper['title'])}</p>
<p class="paper-detail">{escaped(paper['detail'])} / {link('DOI: '+paper['doi'], paper['url'])}</p></section>
<h2>项目经历</h2>{''.join(blocks)}
<section class="contribution"><h2>开源贡献（已提交）</h2><h3>{escaped(contribution['title'])}</h3>
<p>{escaped(contribution['text'])}</p><p class="status">{escaped(contribution['status'])}</p>
<p class="project-links">{link('正式 PR #2930', contribution['url'])} / {link('实现、测试与保留问题', contribution['evidence_url'])}</p></section>
<footer><p>{escaped(data['footer'])}</p><div class="meta"><span>PR 状态快照：{escaped(data['pr_snapshot'])}</span><span>项目经历附件 / 1</span></div></footer>
</main></body></html>
'''


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--content', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    data = json.loads(args.content.read_text()); evidence = json.loads(args.evidence.read_text())
    verify(data, evidence, args.root)
    output = args.output
    output.mkdir(mode=0o700, exist_ok=False)
    files = {}
    for role in data['roles']:
        name = role['filename'] + '.html'; raw = render(data, role).encode(); (output / name).write_bytes(raw)
        files[name] = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'role': role['id']}
    record = {'content_sha256': hashlib.sha256(args.content.read_bytes()).hexdigest(),
              'evidence_map_sha256': hashlib.sha256(args.evidence.read_bytes()).hexdigest(),
              'files': files, 'source_commits': data['source_commits'], 'document_only_no_experiments': True}
    (output / 'html-build.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record))


if __name__ == '__main__':
    main()

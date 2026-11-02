from pathlib import Path
import html
import re

root = Path(__file__).parent
lines = (root / 'agent-platform-roadmap.md').read_text(encoding='utf-8').splitlines()
out = []
toc = []
in_code = False
in_list = False
i = 0

def inline(value):
    value = html.escape(value)
    value = re.sub(r'\[([^]]+)\]\((https?://[^)]+)\)', r'<a href="\2">\1</a>', value)
    value = re.sub(r'`([^`]+)`', r'<code>\1</code>', value)
    return re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', value)

while i < len(lines):
    line = lines[i]
    if line.startswith('```'):
        if in_list:
            out.append('</ul>'); in_list = False
        out.append('</code></pre>' if in_code else '<pre><code>')
        in_code = not in_code; i += 1; continue
    if in_code:
        out.append(html.escape(line) + '\n'); i += 1; continue
    if line.startswith('#'):
        if in_list:
            out.append('</ul>'); in_list = False
        n = len(line) - len(line.lstrip('#'))
        title = line[n:].strip()
        ident = f'section-{len(toc)}' if n == 2 else f'heading-{i}'
        if n == 2: toc.append((ident, title))
        out.append(f'<h{n} id="{ident}">{inline(title)}</h{n}>'); i += 1; continue
    if line.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s:|\-]+\|$', lines[i + 1]):
        if in_list:
            out.append('</ul>'); in_list = False
        def cells(s): return [c.strip() for c in s.strip().strip('|').split('|')]
        out.append('<div class="table-wrap"><table><thead><tr>' + ''.join('<th>' + inline(c) + '</th>' for c in cells(line)) + '</tr></thead><tbody>')
        i += 2
        while i < len(lines) and lines[i].startswith('|'):
            out.append('<tr>' + ''.join('<td>' + inline(c) + '</td>' for c in cells(lines[i])) + '</tr>'); i += 1
        out.append('</tbody></table></div>'); continue
    is_item = line.startswith('- ') or bool(re.match(r'^\d+\. ', line))
    if is_item:
        if not in_list: out.append('<ul>'); in_list = True
        value = re.sub(r'^(?:- |\d+\. )', '', line)
        out.append('<li>' + inline(value) + '</li>'); i += 1; continue
    if in_list: out.append('</ul>'); in_list = False
    if line.startswith('> '): out.append('<p class="meta">' + inline(line[2:]) + '</p>')
    elif line.strip(): out.append('<p>' + inline(line) + '</p>')
    i += 1
if in_list: out.append('</ul>')

nav = ''.join(f'<a href="#{ident}">{inline(title)}</a>' for ident, title in toc)
page = '''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alpha Agent 平台 · 调研与路线图</title>
<style>
:root{color-scheme:light;--ink:#182a35;--muted:#607580;--accent:#087c72;--line:#dce8e6;--paper:#fff;--bg:#f3f7f5}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.8 "Segoe UI","Microsoft YaHei",sans-serif}a{color:#087c72;text-decoration:none}a:hover{text-decoration:underline}.layout{max-width:1500px;margin:auto;display:grid;grid-template-columns:255px minmax(0,1fr);gap:48px;padding:48px 52px}.side{position:sticky;top:35px;align-self:start;max-height:calc(100vh - 70px);overflow:auto}.brand{font-size:12px;letter-spacing:.18em;font-weight:800;color:var(--accent);margin-bottom:24px}.side a{display:block;padding:7px 0;color:#607580;font-size:13px;line-height:1.5}.side a:hover{color:var(--accent)}main{min-width:0;background:var(--paper);border:1px solid #e1ebe8;border-radius:20px;box-shadow:0 18px 60px #183b3010;padding:56px 68px 90px}h1{font-size:clamp(30px,4vw,48px);letter-spacing:-.04em;line-height:1.2;margin:0 0 18px;max-width:860px}h2{font-size:26px;line-height:1.3;margin:68px 0 22px;padding-top:20px;border-top:1px solid var(--line);scroll-margin-top:25px}h3{font-size:19px;margin:32px 0 12px}p{margin:12px 0 18px}p.meta{font-size:13px;color:var(--muted);background:#edf7f3;border-radius:8px;padding:10px 14px}.meta+h2{border:0;margin-top:38px;padding-top:0}strong{color:#135d57}ul{padding-left:22px}li{padding:3px 0}code{font-family:Consolas,monospace;font-size:.88em;background:#eef4f2;padding:2px 5px;border-radius:4px}pre{background:#172d35;color:#dcf2e9;border-radius:12px;padding:22px;overflow:auto;line-height:1.6;font-size:13px}pre code{background:none;color:inherit;padding:0}.table-wrap{overflow-x:auto;margin:24px 0;border:1px solid var(--line);border-radius:10px}table{width:100%;border-collapse:collapse;min-width:620px;font-size:14px;line-height:1.65}th{text-align:left;background:#edf6f3;color:#28574f;font-weight:700}td,th{padding:13px 15px;vertical-align:top;border-bottom:1px solid var(--line)}tr:last-child td{border-bottom:0}@media(max-width:850px){.layout{display:block;padding:16px}.side{position:static;max-height:none;margin:10px 8px 20px}.side nav{display:flex;gap:10px;overflow:auto}.side a{white-space:nowrap}.brand{margin-bottom:6px}main{padding:30px 22px 55px;border-radius:14px}h2{margin-top:48px}}@media print{body{background:white}.layout{display:block;padding:0}.side{display:none}main{border:0;box-shadow:none;padding:0}h2{break-after:avoid}tr,pre{break-inside:avoid}}
</style></head><body><div class="layout"><aside class="side"><div class="brand">ALPHA / ARCHITECTURE</div><nav>'''+nav+'''</nav></aside><main>'''+''.join(out)+'''</main></div></body></html>'''
(root / 'agent-platform-roadmap.html').write_text(page, encoding='utf-8')
from html.parser import HTMLParser
HTMLParser().feed(page)
ids = re.findall(r'id="([^"]+)', page)
anchors = re.findall(r'href="#([^"]+)', page)
assert len(ids) == len(set(ids)) and set(anchors) <= set(ids)
print(f'Generated HTML: {len(toc)} sections, {len(anchors)} valid navigation links')

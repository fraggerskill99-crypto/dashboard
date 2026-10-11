#!/usr/bin/env python3
"""Собирает приложение «Качество мойки» из base.html (дашборд мойки без данных) и addon.*.

dist/www/      — веб-приложение (PWA) и содержимое Android/Windows-приложений
dist/moika.html — один файл, открывается с диска
"""
import json, pathlib, re, shutil, sys, time
sys.stdout.reconfigure(encoding='utf-8')

ROOT = pathlib.Path(__file__).parent
OUT, WWW = ROOT / 'dist', ROOT / 'dist' / 'www'
VERSION = time.strftime('%Y%m%d%H%M')
html = (ROOT / 'base.html').read_text(encoding='utf-8')
parts = dict(re.findall(r'<!--MOIKA:(\w+)-->\n(.*?)(?=<!--MOIKA:|\Z)', (ROOT / 'addon.html').read_text(encoding='utf-8'), re.S))
css = (ROOT / 'addon.css').read_text(encoding='utf-8')
js = (ROOT / 'addon.js').read_text(encoding='utf-8')

def put(s, anchor, text, after=True, count=1):
    assert anchor in s, anchor
    return s.replace(anchor, anchor + text if after else text + anchor, count)

html = put(html, '</head>', f'<style>\n{css}</style>\n', after=False)
html = put(html, '<div class="upload-box">\n', parts['IMPORT'])
html = put(html, '<div class="kpi-row" id="kpiRow"></div>', parts['EMPTY'], after=False)
html = put(html, '<div class="panel active" id="panel-overview">\n', parts['MONTH'])
tail = "renderKPIs();\nshowTab('overview');"
assert html.count(tail) == 1
html = html.replace(tail, js + '\n' + tail)

if OUT.exists(): shutil.rmtree(OUT)
WWW.mkdir(parents=True)
head_app = ('<meta name="theme-color" content="#1F3864">\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon-192.png">\n'
            '<link rel="apple-touch-icon" href="icon-maskable-512.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n'
            '<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Мойка">\n'
            "<script>if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor)"
            " addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));</script>\n")
(WWW / 'index.html').write_text(html.replace('</head>', head_app + '</head>', 1), encoding='utf-8')
for f in ('icon-192.png', 'icon-512.png', 'icon-maskable-512.png'): shutil.copy(ROOT / 'icons' / f, WWW / f)
(WWW / 'sw.js').write_text((ROOT / 'sw.js').read_text(encoding='utf-8').replace('{{VERSION}}', VERSION), encoding='utf-8')
(WWW / 'manifest.webmanifest').write_text(json.dumps({
    'name': 'Качество мойки', 'short_name': 'Мойка',
    'description': 'Дашборд качества мойки УКПФ: средний балл по месяцам, зонам и турам, категории несоответствий.',
    'lang': 'ru', 'start_url': './', 'scope': './', 'display': 'standalone',
    'background_color': '#f4f6fa', 'theme_color': '#1F3864',
    'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
              {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
              {'src': 'icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}]
}, ensure_ascii=False, indent=1), encoding='utf-8')
(OUT / 'moika.html').write_text(html, encoding='utf-8')
for p in sorted(OUT.rglob('*')):
    if p.is_file(): print('%-32s %8.1f КБ' % (p.relative_to(OUT), p.stat().st_size / 1024))

#!/usr/bin/env python3
"""Собирает приложение «NOK-дашборд» из base.html (дашборд без данных) и addon.*.

dist/www/     — веб-приложение (PWA) и содержимое Android/Windows-приложений
dist/nok.html — один файл, открывается с диска
"""
import json, pathlib, shutil, sys, time
sys.stdout.reconfigure(encoding='utf-8')

ROOT = pathlib.Path(__file__).parent
OUT, WWW = ROOT / 'dist', ROOT / 'dist' / 'www'
VERSION = time.strftime('%Y%m%d%H%M')
html = (ROOT / 'base.html').read_text(encoding='utf-8')
bar = (ROOT / 'addon.html').read_text(encoding='utf-8')
css = (ROOT / 'addon.css').read_text(encoding='utf-8')
js = (ROOT / 'addon.js').read_text(encoding='utf-8')

def put(s, anchor, text, after=True):
    assert s.count(anchor) == 1, anchor
    return s.replace(anchor, anchor + text if after else text + anchor)

html = put(html, '</head>', f'<style>\n{css}</style>\n', after=False)
html = put(html, '  <div class="meta-line" id="metaLine"></div>', bar, after=False)
html = html.replace('⟳ Обновить данные (загрузить Свод .xlsx)', '⬆ Загрузить Свод .xlsx')
html = html.replace('кнопкой «Обновить данные»', 'кнопкой «Загрузить Свод»')
html = put(html, '</body>', f'<script>\n{js}</script>\n', after=False)

if OUT.exists(): shutil.rmtree(OUT)
WWW.mkdir(parents=True)
head_app = ('<meta name="theme-color" content="#1a1f2e">\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon-192.png">\n'
            '<link rel="apple-touch-icon" href="icon-maskable-512.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n'
            '<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="NOK">\n'
            "<script>if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor)"
            " addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));</script>\n")
(WWW / 'index.html').write_text(html.replace('</head>', head_app + '</head>', 1), encoding='utf-8')
for f in ('icon-192.png', 'icon-512.png', 'icon-maskable-512.png'): shutil.copy(ROOT / 'icons' / f, WWW / f)
(WWW / 'sw.js').write_text((ROOT / 'sw.js').read_text(encoding='utf-8').replace('{{VERSION}}', VERSION), encoding='utf-8')
(WWW / 'manifest.webmanifest').write_text(json.dumps({
    'name': 'NOK-дашборд', 'short_name': 'NOK',
    'description': 'NOK-дашборд микробиологии УКПФ и МПФ: недели OK/NOK по объектам исследования.',
    'lang': 'ru', 'start_url': './', 'scope': './', 'display': 'standalone',
    'background_color': '#f7f8fa', 'theme_color': '#1a1f2e',
    'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
              {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
              {'src': 'icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}]
}, ensure_ascii=False, indent=1), encoding='utf-8')
(OUT / 'nok.html').write_text(html, encoding='utf-8')
for p in sorted(OUT.rglob('*')):
    if p.is_file(): print('%-32s %8.1f КБ' % (p.relative_to(OUT), p.stat().st_size / 1024))

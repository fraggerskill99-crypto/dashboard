#!/usr/bin/env python3
"""Собирает приложение «Санитарный разрыв» из app.html.

dist/www/          — веб-приложение (PWA) и содержимое Android/Windows-приложений
dist/sanrazryv.html — один файл, открывается с диска без интернета
"""
import json, pathlib, re, shutil, sys, time
sys.stdout.reconfigure(encoding='utf-8')

ROOT = pathlib.Path(__file__).parent
OUT, WWW = ROOT / 'dist', ROOT / 'dist' / 'www'
VERSION = time.strftime('%Y%m%d%H%M')
page = (ROOT / 'app.html').read_text(encoding='utf-8')
xlsx = (ROOT / 'vendor/xlsx.full.min.js').read_text(encoding='utf-8')
title = re.search(r'<title>(.*?)</title>', page).group(1)
body = page.replace(f'<title>{title}</title>', '', 1)
svg = (ROOT / 'icons/logo.svg').read_text(encoding='utf-8')
svg = svg[svg.index('<svg'):]
body = body.replace('{{SPLASH_SVG}}', svg)
body = body.replace('{{LOGO}}', 'data:image/png;base64,' + (ROOT / 'icons/logo-ukpf.b64').read_text().strip())

def doc(head_extra, lib):
    return ('<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            f'<title>{title}</title>\n<meta name="theme-color" content="#e5dbc0">\n'
            '<style>:root{padding-top:env(safe-area-inset-top,0px)}body{margin:0}img{max-width:100%}</style>\n'
            f'{head_extra}</head>\n<body>\n' + body.replace('<!--{{XLSX}}-->', lib) + '\n</body>\n</html>\n')

if OUT.exists(): shutil.rmtree(OUT)
WWW.mkdir(parents=True)
sw = ("<script>if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor)"
      " addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));</script>\n")
(WWW / 'index.html').write_text(doc('<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon-192.png">\n'
    '<link rel="apple-touch-icon" href="icon-192.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n' + sw,
    '<script src="xlsx.full.min.js"></script>'), encoding='utf-8')
shutil.copy(ROOT / 'vendor/xlsx.full.min.js', WWW / 'xlsx.full.min.js')
for f in ('icon-192.png', 'icon-512.png', 'icon-maskable-512.png'): shutil.copy(ROOT / 'icons' / f, WWW / f)
(WWW / 'sw.js').write_text((ROOT / 'sw.js').read_text(encoding='utf-8').replace('{{VERSION}}', VERSION), encoding='utf-8')
(WWW / 'manifest.webmanifest').write_text(json.dumps({
    'name': 'Санитарный разрыв', 'short_name': 'Санразрыв',
    'description': 'Возраст птицы от заселения и процессы санитарного разрыва по цехам и корпусам — из графиков Excel.',
    'lang': 'ru', 'start_url': './', 'scope': './', 'display': 'standalone',
    'background_color': '#e5dbc0', 'theme_color': '#e5dbc0',
    'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
              {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
              {'src': 'icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}]
}, ensure_ascii=False, indent=1), encoding='utf-8')
(OUT / 'sanrazryv.html').write_text(doc('', '<script>' + xlsx.replace('</script', '<\\/script') + '</script>'), encoding='utf-8')
for p in sorted(OUT.rglob('*')):
    if p.is_file(): print('%-36s %7.1f КБ' % (p.relative_to(OUT), p.stat().st_size / 1024))

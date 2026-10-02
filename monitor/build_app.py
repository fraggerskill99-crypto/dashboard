#!/usr/bin/env python3
"""Собирает устанавливаемое приложение «Эпизоотический монитор птиц» из episoot_monitor.html.

dist_app/www/              — веб-приложение (PWA) и содержимое Android-приложения
dist_app/ptitsa_monitor.html — один файл: открывается с диска на любом компьютере, без интернета

Переменные окружения:
  MONITOR_DATA_URL — откуда приложение подтягивает свежий список событий
                     (по умолчанию seed.json этой ветки на raw.githubusercontent.com)
  GITHUB_REF_NAME  — ветка, из которой строится ссылка по умолчанию
"""
import json, os, pathlib, re, shutil, sys, time
sys.stdout.reconfigure(encoding="utf-8")

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / 'dist_app'
WWW = OUT / 'www'
REPO = os.environ.get('GITHUB_REPOSITORY', 'fraggerskill99-crypto/dashboard')
BRANCH = os.environ.get('GITHUB_REF_NAME', 'claude/happy-euler-0ic2lm')
DATA_URL = os.environ.get('MONITOR_DATA_URL', f'https://raw.githubusercontent.com/{REPO}/{BRANCH}/monitor/seed.json')
VERSION = time.strftime('%Y%m%d%H%M')

page = (ROOT / 'episoot_monitor.html').read_text(encoding='utf-8')
seed = json.loads((ROOT / 'seed.json').read_text(encoding='utf-8'))
GEO_FILES = {'ukpf': 'geo_ukpf.json', 'mpf': 'geo_mpf.json'}
geos = {k: (ROOT / f).read_text(encoding='utf-8') for k, f in GEO_FILES.items()}
adapter = (ROOT / 'app/app_data.js').read_text(encoding='utf-8')

a = page.index('/*{{DATA_INIT}}*/'); b = page.index('/*{{/DATA_INIT}}*/') + len('/*{{/DATA_INIT}}*/')
body = page[:a] + adapter + page[b:]
title = re.search(r'<title>(.*?)</title>', body).group(1)
body = body.replace(f'<title>{title}</title>', '', 1)
# в приложении нет общей базы: добавленные эпизоды хранятся на устройстве
body = body.replace('Записи с пометкой «вручную» добавлены пользователями страницы.',
                    'Записи с пометкой «вручную» добавлены на этом устройстве и видны только здесь.')

def doc(head_extra, pre_script):
    return ('<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            f'<title>{title}</title>\n<meta name="theme-color" content="#0f6b5c">\n'
            '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
            'body{margin:0}img{max-width:100%}</style>\n'
            f'{head_extra}</head>\n<body>\n<script>{pre_script}</script>\n{body}\n</body>\n</html>\n')

if OUT.exists(): shutil.rmtree(OUT)
(WWW / 'data').mkdir(parents=True)

pre = f'window.__DATA_URL__ = {json.dumps(DATA_URL)};'
sw_reg = ("<script>if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor)"
          " addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));</script>\n")
(WWW / 'index.html').write_text(doc(
    '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon-192.png">\n'
    '<link rel="apple-touch-icon" href="icon-192.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n' + sw_reg,
    pre), encoding='utf-8')
(WWW / 'data/seed.json').write_text(json.dumps(seed, ensure_ascii=False), encoding='utf-8')
for k, f in GEO_FILES.items(): (WWW / f).write_text(geos[k], encoding='utf-8')
for f in ('icon-192.png', 'icon-512.png', 'icon-maskable-512.png'):
    shutil.copy(ROOT / 'app' / f, WWW / f)
(WWW / 'sw.js').write_text((ROOT / 'app/sw.js').read_text(encoding='utf-8').replace('{{VERSION}}', VERSION), encoding='utf-8')
(WWW / 'manifest.webmanifest').write_text(json.dumps({
    'name': 'Эпизоотический монитор птиц', 'short_name': 'Монитор птиц',
    'description': 'Грипп птиц, болезнь Ньюкасла и падеж птицы: мир, Казахстан, зона 50 км вокруг УКПФ и водоёмы.',
    'lang': 'ru', 'start_url': './', 'scope': './', 'display': 'standalone',
    'background_color': '#eef2f1', 'theme_color': '#0f6b5c',
    'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
              {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
              {'src': 'icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}]
}, ensure_ascii=False, indent=1), encoding='utf-8')

# один файл: данные и карта вшиты внутрь
single_pre = pre + '\nwindow.__EPISODES__ = ' + json.dumps(seed, ensure_ascii=False) + ';\nwindow.__GEOS__ = {' + ','.join(f'{json.dumps(k)}:{v}' for k, v in geos.items()) + '};'
(OUT / 'ptitsa_monitor.html').write_text(doc('', single_pre.replace('</', '<\\/')), encoding='utf-8')

for p in sorted(OUT.rglob('*')):
    if p.is_file(): print('%-40s %7.1f КБ' % (p.relative_to(OUT), p.stat().st_size / 1024))
print('данные обновляются с', DATA_URL)

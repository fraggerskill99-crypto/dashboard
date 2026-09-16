#!/usr/bin/env python3
"""Собирает готовые файлы приложения из src/ в dist/."""
import pathlib, sys

ROOT = pathlib.Path(__file__).parent
SRC = (ROOT / 'src/app.html').read_text(encoding='utf-8')
VENDOR = (ROOT / 'vendor/mammoth-jszip.html').read_text(encoding='utf-8')
LOGO = (ROOT / 'assets/logo.b64').read_text(encoding='utf-8').strip()

TARGETS = {
    'sluzhebki_app.html': 'src/ai/standalone.js',
    'sluzhebki_artifact.html': 'src/ai/artifact.js',
}

def build(out_name, ai_path):
    ai_file = ROOT / ai_path
    if not ai_file.exists():
        print('пропуск %s — нет %s' % (out_name, ai_path))
        return
    html = SRC.replace('<!--{{VENDOR}}-->', VENDOR.strip())
    html = html.replace('{{LOGO}}', LOGO)
    html = html.replace('/*{{AI_ADAPTER}}*/', ai_file.read_text(encoding='utf-8'))
    for token in ('{{VENDOR}}', '{{LOGO}}', '{{AI_ADAPTER}}'):
        if token in html:
            sys.exit('в сборке остался незаменённый %s' % token)
    out = ROOT / 'dist' / out_name
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding='utf-8')
    print('%s — %.1f КБ' % (out, len(html.encode('utf-8'))/1024))

for name, path in TARGETS.items():
    build(name, path)

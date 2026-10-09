#!/usr/bin/env python3
"""Собирает trading/dist/trading_app.html: один файл, библиотека графиков внутри."""
import pathlib, sys

ROOT = pathlib.Path(__file__).parent
html = (ROOT / 'src/app.html').read_text(encoding='utf-8')
lwc = (ROOT / 'vendor/lightweight-charts-4.1.3.js').read_text(encoding='utf-8')
if '</script' in lwc:
    sys.exit('в библиотеке встретился </script>')
html = html.replace('/*{{LWC}}*/', lwc.strip())
if '{{LWC}}' in html:
    sys.exit('метка {{LWC}} не заменена')
out = ROOT / 'dist' / 'trading_app.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print('%s — %.1f КБ' % (out, len(html.encode('utf-8')) / 1024))

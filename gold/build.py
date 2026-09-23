#!/usr/bin/env python3
"""Собирает gold/dist/aurum_smc.html — один файл со встроенными engine.js, app.js и индикатором.
Удобно, если нет хостинга: файл можно открыть в браузере телефона."""
import json, pathlib, re

ROOT = pathlib.Path(__file__).parent
html = (ROOT / 'index.html').read_text(encoding='utf-8')
engine = (ROOT / 'engine.js').read_text(encoding='utf-8')
app = (ROOT / 'app.js').read_text(encoding='utf-8')
pine = (ROOT / 'smc_snr.pine').read_text(encoding='utf-8')

html = html.replace('<script src="engine.js"></script>', '<script>\n' + engine + '\n</script>')
html = html.replace('<script src="app.js"></script>',
                    '<script>window.PINE_SOURCE = ' + json.dumps(pine, ensure_ascii=False) + ';</script>\n<script>\n' + app + '\n</script>')
# манифест и иконки — только для версии с хостингом
html = re.sub(r'<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n', '', html)

out = ROOT / 'dist' / 'aurum_smc.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(out, len(html) // 1024, 'КБ')

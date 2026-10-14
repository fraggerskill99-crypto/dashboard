#!/usr/bin/env python3
"""Собирает счётчик дней как приложение для телефона (PWA) в docs/.

Исходник один — counter/schetchik.html (он же публикуется артефактом).
Здесь он оборачивается в полный документ с манифестом, значками и service worker,
чтобы его можно было установить на главный экран и открывать без интернета.
Запуск: python3 counter/build_app.py
"""
import pathlib
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).parent
OUT = ROOT.parent / 'docs'
VERSION = 'v1'

GREEN = (31, 138, 107)
WHITE = (255, 255, 255)

HEAD = '''<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#eef2f4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f171c" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Дни">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; padding-top: max(28px, env(safe-area-inset-top, 0px)) !important;
       padding-bottom: max(48px, env(safe-area-inset-bottom, 0px)) !important;
       -webkit-tap-highlight-color: transparent; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
'''

TAIL = '''
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js'); });
}
</script>
</body>
</html>
'''

MANIFEST = '''{
  "name": "Счётчик дней",
  "short_name": "Дни",
  "description": "Счётчик дней без срывов с календарём серии",
  "lang": "ru",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#eef2f4",
  "theme_color": "#1f8a6b",
  "icons": [
    {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
    {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
    {"src": "icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
  ]
}
'''

SW = '''// Кэш приложения: работает без интернета после первого открытия.
const CACHE = 'days-%s';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Сначала кэш, параллельно обновляем его из сети (шрифты Google — тоже).
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(cache =>
    cache.match(e.request, {ignoreSearch: true}).then(hit => {
      const net = fetch(e.request).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })));
});
''' % VERSION


def icon(size, maskable=False, k=None):
    """Зелёная плитка с белым листом календаря и галочкой."""
    s = size
    img = Image.new('RGB', (s, s), GREEN)
    d = ImageDraw.Draw(img)
    if k is None:
        k = 0.62 if maskable else 0.78  # у maskable значка безопасная зона — круг 80%
    w = s * k
    x0, y0 = (s - w) / 2, (s - w * 0.92) / 2 + s * 0.02
    x1, y1 = x0 + w, y0 + w * 0.92
    r = w * 0.12
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=WHITE)
    d.rounded_rectangle([x0, y0, x1, y0 + w * 0.24], radius=r, fill=(214, 238, 229))
    d.rectangle([x0, y0 + w * 0.14, x1, y0 + w * 0.24], fill=(214, 238, 229))
    for fx in (0.28, 0.72):  # кольца переплёта
        cx = x0 + w * fx
        d.rounded_rectangle([cx - w * 0.04, y0 - w * 0.07, cx + w * 0.04, y0 + w * 0.1],
                            radius=w * 0.04, fill=(20, 90, 70))
    lw = max(2, int(w * 0.09))
    pts = [(x0 + w * 0.27, y0 + w * 0.57), (x0 + w * 0.44, y0 + w * 0.73), (x0 + w * 0.75, y0 + w * 0.40)]
    d.line(pts, fill=GREEN, width=lw, joint='curve')
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - lw / 2, p[1] - lw / 2, p[0] + lw / 2, p[1] + lw / 2], fill=GREEN)
    return img


def main():
    OUT.mkdir(exist_ok=True)
    body = (ROOT / 'schetchik.html').read_text(encoding='utf-8')
    head_end = body.index('<div class="wrap">')
    html = HEAD + body[:head_end] + '</head>\n<body>\n' + body[head_end:] + TAIL
    (OUT / 'index.html').write_text(html, encoding='utf-8')
    (OUT / 'manifest.webmanifest').write_text(MANIFEST, encoding='utf-8')
    (OUT / 'sw.js').write_text(SW, encoding='utf-8')
    (OUT / '.nojekyll').write_text('', encoding='utf-8')
    icon(192).save(OUT / 'icon-192.png')
    icon(512).save(OUT / 'icon-512.png')
    icon(512, maskable=True).save(OUT / 'icon-maskable-512.png')
    icon(180).save(OUT / 'apple-touch-icon.png')
    print('готово:', OUT)


if __name__ == '__main__':
    main()

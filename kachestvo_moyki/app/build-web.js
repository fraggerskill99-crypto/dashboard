// Веб-дашборд одним файлом для Chrome/Edge: dist-web/ukpf_dashboard.html.
// Те же вкладки, что в приложении (Качество мойки, NOK, Мойка и МБ, Фотофиксация по неделям).
// Страницы вкладок лежат внутри файла (base64) и открываются как srcdoc — у всех вкладок один адрес,
// поэтому «Мойка и МБ» и «Фотофиксация» видят фото из «Качества мойки». Данные — из «⚙ Настроек»:
// выбранные файлы и папки хранит браузер (мост app-bridge.js в режиме веб).
// Запуск: APP_VERSION=1.2.N node build-web.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const TMP = path.join(ROOT, 'dist-web', 'pages');
const OUT = path.join(ROOT, 'dist-web', 'ukpf_dashboard.html');
execFileSync(process.execPath, [path.join(ROOT, 'build-www.js'), '--out', TMP], { stdio: 'inherit', env: process.env });

let html = fs.readFileSync(path.join(TMP, 'index.html'), 'utf8');
const PAGES = { moika: 'moika.html', nok: 'nok.html', mb: 'mb.html', week: 'week.html', nc: 'nc.html' };
// вкладки: вместо адреса — имя страницы (её текст — в <script id="pg-…"> ниже)
for (const [k, file] of Object.entries(PAGES)) {
  const re = new RegExp(`<iframe id="f-${k}" (?:src|data-src)="${file.replace('.', '\\.')}"`);
  if (!re.test(html)) throw new Error('нет рамки вкладки ' + k);
  html = html.replace(re, `<iframe id="f-${k}" data-page="${file}"`);
}
html = html.replace(/<head>/i, '<head>\n<script>window.__WEB_COMBINED = true;</script>');
html = html.replace('<title>Качество мойки — УКПФ</title>', '<title>Дашборды УКПФ — мойка, NOK, МБ</title>');
const blobs = Object.entries(PAGES).map(([k, file]) =>
  `<script type="application/octet-stream" id="pg-${k}">${fs.readFileSync(path.join(TMP, file)).toString('base64')}</script>`).join('\n');
// страницы — сразу после <body>: скрипт оболочки (в конце) должен их уже видеть
html = html.replace(/<body>/i, '<body>\n' + blobs);
fs.writeFileSync(OUT, html);
fs.rmSync(TMP, { recursive: true, force: true });
console.log('веб-дашборд:', path.relative(process.cwd(), OUT), (fs.statSync(OUT).size / 1048576).toFixed(1) + ' МБ');

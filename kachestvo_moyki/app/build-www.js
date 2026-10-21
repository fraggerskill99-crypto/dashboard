// Собирает www/ — содержимое приложения (ПК и Android):
//   index.html — оболочка с вкладками,
//   moika.html — ../dashboard_kachestvo_moyki.html,
//   nok.html   — ../nok_dashboard.html,
//   mb.html    — ../mb_dashboard.html (библиотеки из интернета встроены — работает без сети).
// В каждый дашборд встраивается мост приложения (app-bridge.js), а с флагом --android —
// ещё и перехват «скачать» → окно «Поделиться» (android/download-shim.js).
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'www-src');
const OUT = process.argv.includes('--out') ? path.resolve(process.argv[process.argv.indexOf('--out') + 1]) : path.join(ROOT, 'www');
const android = process.argv.includes('--android');

const read = (p) => fs.readFileSync(p, 'utf8');
const script = (code) => '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>\n';
const head = script(read(path.join(SRC, 'app-bridge.js'))) + (android ? script(read(path.join(ROOT, 'android', 'download-shim.js'))) : '');

function inject(html, name) {
  const i = html.search(/<head[^>]*>/i);
  if (i < 0) throw new Error(name + ': нет <head>');
  const at = html.indexOf('>', i) + 1;
  return html.slice(0, at) + '\n' + head + html.slice(at);
}
const VENDOR = {
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js': 'xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js': 'papaparse.min.js',
};
function inlineVendor(html) {
  return html.replace(/<script src="([^"]+)"><\/script>/g, (m, url) => (VENDOR[url] ? script(read(path.join(SRC, 'vendor', VENDOR[url]))) : m));
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const pages = {
  'moika.html': '../dashboard_kachestvo_moyki.html',
  'nok.html': '../nok_dashboard.html',
  'mb.html': '../mb_dashboard.html',
};
// копия SheetJS, встроенная прямо в страницу, — заменяется на версию из vendor (в сборке — 0.20.3 с официального сайта)
const XLSX_VENDOR = read(path.join(SRC, 'vendor', 'xlsx.full.min.js'));
const XLSX_VER = (XLSX_VENDOR.match(/version="(\d+\.\d+\.\d+)"/) || [])[1];
// старые SheetJS (< 0.20.2) — известные уязвимости при чтении чужих Excel: такая сборка не делается
if (!XLSX_VER || XLSX_VER.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0) < 20002) { console.error('SheetJS ' + XLSX_VER + ' — нужна 0.20.3 (www-src/vendor/xlsx.full.min.js)'); process.exit(1); }
function swapInlineXlsx(html) {
  const i = html.indexOf('/*! xlsx.js (C) 2013-present SheetJS');
  if (i < 0) return html;
  const a = html.lastIndexOf('<script>', i), b = html.indexOf('</script>', i);
  if (a < 0 || b < 0 || i - a > 20) return html;
  return html.slice(0, a) + script(XLSX_VENDOR) + html.slice(b + '</script>'.length);
}
for (const [out, src] of Object.entries(pages)) {
  let html = read(path.join(ROOT, src));
  html = swapInlineXlsx(inlineVendor(html));
  if (/version="0\.1[0-9]\.\d+"[^]{0,400}?SheetJS|xlsx\.js \(C\)[^]{0,300}version="0\.1/.test(html) || (html.includes('2013-present SheetJS') && !html.includes('version="' + XLSX_VER + '"'))) { console.error(out + ': осталась старая копия SheetJS'); process.exit(1); }
  if (/<script src="https?:/i.test(html)) console.warn('Внимание:', out, 'всё ещё грузит скрипты из интернета');
  fs.writeFileSync(path.join(OUT, out), inject(html, out));
}
fs.copyFileSync(path.join(SRC, 'week.html'), path.join(OUT, 'week.html'));
fs.copyFileSync(path.join(SRC, 'nc.html'), path.join(OUT, 'nc.html'));
// номер версии в строке вкладок: APP_VERSION (сборка Android) или версия из package.json
const version = process.env.APP_VERSION || JSON.parse(read(path.join(ROOT, 'package.json'))).version;
// оформление оболочки (орнамент слева, логотипы) — те же картинки, что в шапке/подвале «Качества мойки»
const moikaSrc = read(path.join(ROOT, '../dashboard_kachestvo_moyki.html'));
const pick = (re, what) => { const m = moikaSrc.match(re); if (!m) throw new Error('нет картинки оформления: ' + what); return m[1]; };
const BRAND = {
  '{{STRIP}}': pick(/body::before \{[^}]*?url\("(data:image\/[^"]+)"\)/, 'орнамент'),
  '{{LOGO}}': pick(/<img class="brand-logo"[^>]*?src="(data:image\/[^"]+)"/, 'логотип'),
  '{{LOGO_SMALL}}': pick(/<footer class="foot">[\s\S]*?<img[^>]*?src="(data:image\/[^"]+)"/, 'малый логотип'),
};
let shell = read(path.join(SRC, 'index.html')).replace('{{VERSION}}', version);
for (const [k, v] of Object.entries(BRAND)) shell = shell.split(k).join(v);
fs.writeFileSync(path.join(OUT, 'index.html'), shell);
console.log('www собран' + (android ? ' (Android)' : '') + ':', path.relative(process.cwd(), OUT) || '.');

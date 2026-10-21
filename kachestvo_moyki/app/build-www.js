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
for (const [out, src] of Object.entries(pages)) {
  let html = read(path.join(ROOT, src));
  html = inlineVendor(html);
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

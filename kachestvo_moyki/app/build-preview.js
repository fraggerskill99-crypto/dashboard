// Предварительный просмотр перед выдачей APK/EXE: те же вкладки и файлы, что в приложении,
// страницей в браузере (публикуется как Artifact). Собирается в preview/:
//   index.html — оболочка с вкладками без <html>/<head>/<body> (их добавляет публикация) + полоса «просмотр»,
//   moika.html, nok.html, mb.html, week.html — как в приложении.
// Запуск: APP_VERSION=1.2.N node build-preview.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'preview');
execFileSync(process.execPath, [path.join(ROOT, 'build-www.js'), '--out', OUT], { stdio: 'inherit', env: process.env });

// управляющие символы (внутри строк встроенных библиотек) публикация не принимает — пишем их как \xHH
for (const f of ['moika.html', 'nok.html', 'mb.html', 'week.html']) {
  const p = path.join(OUT, f);
  const src = fs.readFileSync(p, 'utf8');
  // и символ замены U+FFFD (таблицы кодировок): в скриптах — \ufffd, в тексте страницы — &#xFFFD;
  const out = src.split(/(<script\b[^>]*>[\s\S]*?<\/script>)/i).map((part, i) => (i % 2
    ? part.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).replace(/\ufffd/g, '\\ufffd')
    : part.replace(/\ufffd/g, '&#xFFFD;'))).join('');
  if (out !== src) fs.writeFileSync(p, out);
}
const version = process.env.APP_VERSION || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/i)[1].replace(/<meta charset[^>]*>\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/i)[1];
const banner = `<div class="pv" role="note"><b>Предварительный просмотр · версия ${version}</b>
  <span>Так выглядят вкладки в приложении. На ПК кнопок загрузки нет — акты, своды и фото приходят сами из папок OneDrive и SharePoint; здесь, в браузере, файлы можно загрузить кнопками. Фото/видео по неделям и в «Мойке и МБ» появляются, когда подключены папки с фото.</span></div>`;
const style = `<style>
  /* полоса просмотра — над вкладками; страница светлая, как сами дашборды */
  :root { --pv-bg: #fff7e6; --pv-line: #f5d28a; --pv-fg: #6b4a00; color-scheme: light; }
  .pv { flex: 0 0 auto; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; padding: 7px max(16px, env(safe-area-inset-left, 0px)) 7px max(16px, env(safe-area-inset-right, 0px));
        background: var(--pv-bg); border-bottom: 1px solid var(--pv-line); color: var(--pv-fg); font: 12.5px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .pv b { white-space: nowrap; }
  .pv span { min-width: 0; }
  html, body { height: 100%; }
</style>`;
fs.writeFileSync(path.join(OUT, 'index.html'), head.trim() + '\n' + style + '\n' + banner + '\n' + body.trim() + '\n');
console.log('просмотр собран:', path.relative(process.cwd(), OUT), '· версия', version);

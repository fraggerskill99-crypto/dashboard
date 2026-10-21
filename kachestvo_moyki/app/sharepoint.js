// Папка SharePoint/Teams по ссылке → копия на диске.
// Вход — обычным окном Microsoft (рабочая учётная запись), дальше запросы идут
// с куками этого входа: список файлов — REST API SharePoint, файлы — потоком на диск.
// Повторная синхронизация докачивает только новые и изменённые файлы.
const { BrowserWindow, net } = require('electron');
const fs = require('fs');
const path = require('path');

class AuthError extends Error {}
// вход есть, но владелец папки запретил скачивание (доступ «только просмотр»)
class BlockedError extends Error {}
const BLOCKED_TEXT = 'у вашей учётной записи доступ к файлам только на просмотр — владелец папки запретил скачивание. Попросите у него право на скачивание или редактирование';
const LOGIN_HOST_RE = /(^|\.)(login\.microsoftonline\.com|login\.live\.com|login\.windows\.net|microsoftonline\.com|adfs\.)/i;

// ---------- HTTP с куками сессии приложения ----------
function request(url, { accept, toFile, onBytes, file, probe } = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET', useSessionCookies: true, redirect: 'manual' });
    if (accept) req.setHeader('Accept', accept);
    if (probe) req.setHeader('Range', 'bytes=0-0');   // проверка доступа: первый байт файла
    req.on('redirect', (status, method, redirectUrl) => {
      let host = '';
      try { host = new URL(redirectUrl).hostname; } catch (e) { /* относительный адрес */ }
      if (LOGIN_HOST_RE.test(host) || /\/_forms\/|authenticate|accessdenied/i.test(redirectUrl)) {
        req.abort();
        reject(new AuthError('нужен вход в SharePoint'));
      } else req.followRedirect();
    });
    req.on('response', (res) => {
      // 403 на сам файл — запрет скачивания (вход при этом есть); остальное — нужен вход
      if (file && res.statusCode === 403) { res.resume && res.resume(); reject(new BlockedError(BLOCKED_TEXT)); return; }
      if (res.statusCode === 401 || res.statusCode === 403) { res.resume && res.resume(); reject(new AuthError('нет доступа (' + res.statusCode + ')')); return; }
      if (probe) { res.on('data', () => {}); res.on('end', () => resolve({ status: res.statusCode })); return; }
      if (res.statusCode >= 400) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => reject(new Error('SharePoint ответил ' + res.statusCode + ': ' + Buffer.concat(chunks).toString('utf8').slice(0, 300))));
        return;
      }
      if (toFile) {
        const part = toFile + '.part';
        const out = fs.createWriteStream(part);
        res.on('data', (c) => { out.write(c); onBytes && onBytes(c.length); });
        res.on('end', () => out.end(() => { fs.renameSync(part, toFile); resolve({ status: res.statusCode }); }));
        res.on('error', (e) => { out.destroy(); reject(e); });
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
async function getJSON(url) {
  const r = await request(url, { accept: 'application/json;odata=nometadata' });
  const text = r.body.toString('utf8');
  try { return JSON.parse(text); } catch (e) {
    if (/<html/i.test(text)) throw new AuthError('SharePoint вернул страницу входа');
    throw new Error('непонятный ответ SharePoint: ' + text.slice(0, 200));
  }
}

// ---------- ссылка → сайт и путь к папке ----------
// «/sites/msteams_6c8e7e/Shared Documents/Фото» → сайт «https://…/sites/msteams_6c8e7e»
function splitFolderPath(origin, folderPath) {
  const segs = folderPath.split('/').filter(Boolean);
  const site = /^(sites|teams|personal)$/i.test(segs[0]) ? '/' + segs.slice(0, 2).join('/') : '';
  return { site: origin + site, folderPath: '/' + segs.join('/') };
}
function shareToken(link) {
  return 'u!' + Buffer.from(link, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

// Открывает ссылку в окне приложения. Если нужен вход — окно показывается,
// пользователь входит; как только SharePoint открыл папку — окно закрывается.
function resolveLink(link, parent) {
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({
      parent, width: 900, height: 720, show: false, title: 'Вход в SharePoint — Качество мойки',
      autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true },
    });
    let done = false, tried = false;
    const finish = (err, val) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (!w.isDestroyed()) w.destroy();
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new Error('не дождался входа в SharePoint (10 минут)')), 10 * 60 * 1000);
    w.on('closed', () => finish(new Error('окно входа закрыто')));
    const check = async () => {
      if (done || w.isDestroyed()) return;
      let u;
      try { u = new URL(w.webContents.getURL()); } catch (e) { return; }
      if (LOGIN_HOST_RE.test(u.hostname) || !/sharepoint\.com$/i.test(u.hostname)) { if (!w.isVisible()) w.show(); return; }
      const id = u.searchParams.get('id') || u.searchParams.get('RootFolder');
      if (id) { finish(null, splitFolderPath(u.origin, id)); return; }
      if (tried) return;
      tried = true;
      // новый интерфейс SharePoint может не показывать путь в адресе — спрашиваем API ссылок
      try {
        const webUrl = await w.webContents.executeJavaScript(
          `fetch('/_api/v2.0/shares/${shareToken(link)}/driveItem?$select=webUrl', { headers: { Accept: 'application/json' } })` +
          `.then((r) => r.ok ? r.json() : null).then((j) => j && j.webUrl).catch(() => null)`);
        if (webUrl) { const p = new URL(webUrl); finish(null, splitFolderPath(p.origin, decodeURIComponent(p.pathname))); return; }
      } catch (e) { /* ниже — окно с подсказкой */ }
      if (!w.isVisible()) w.show();
    };
    w.webContents.on('did-navigate', check);
    w.webContents.on('did-navigate-in-page', check);
    w.webContents.on('did-finish-load', check);
    w.loadURL(link).catch(() => { /* ошибки навигации видны в окне */ });
  });
}

// ---------- список и скачивание ----------
const q = (s) => encodeURIComponent(s.replace(/'/g, "''"));
async function listFolder(site, folderPath) {
  const j = await getJSON(`${site}/_api/web/GetFolderByServerRelativePath(decodedurl='${q(folderPath)}')?$expand=Files,Folders`);
  const files = (j.Files || []).map((f) => ({ name: f.Name, url: f.ServerRelativeUrl, size: Number(f.Length) || 0, modified: Date.parse(f.TimeLastModified) || 0 }));
  const folders = (j.Folders || []).filter((f) => f.Name !== 'Forms').map((f) => ({ name: f.Name, url: f.ServerRelativeUrl }));
  return { files, folders };
}
const safeName = (n) => n.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/[. ]+$/, '') || '_';

// Скачивает папку целиком в localDir. onProgress({ phase, done, total, file, bytes })
async function syncFolder({ site, folderPath, localDir, onProgress }) {
  const todo = [];
  const report = (o) => onProgress && onProgress(o);
  async function walk(remote, local, depth) {
    report({ phase: 'list', file: remote });
    const { files, folders } = await listFolder(site, remote);
    fs.mkdirSync(local, { recursive: true });
    files.forEach((f) => {
      if (/^~\$/.test(f.name)) return;   // временные файлы Office
      const dest = path.join(local, safeName(f.name));
      let st = null;
      try { st = fs.statSync(dest); } catch (e) { /* ещё нет */ }
      if (st && st.size === f.size && Math.abs(st.mtimeMs - f.modified) < 2000) return;
      todo.push({ ...f, dest });
    });
    if (depth < 10) for (const d of folders) await walk(d.url, path.join(local, safeName(d.name)), depth + 1);
  }
  await walk(folderPath, localDir, 0);
  const total = todo.length, totalBytes = todo.reduce((a, f) => a + f.size, 0);
  let done = 0, bytes = 0;
  for (const f of todo) {
    report({ phase: 'download', done, total, file: f.name, bytes, totalBytes });
    await request(`${site}/_api/web/GetFileByServerRelativePath(decodedurl='${q(f.url)}')/$value`, {
      toFile: f.dest, file: true,
      onBytes: (n) => { bytes += n; },
    });
    if (f.modified) { const t = new Date(f.modified); try { fs.utimesSync(f.dest, t, t); } catch (e) { /* не критично */ } }
    done++;
  }
  report({ phase: 'done', done, total, bytes, totalBytes });
  return { downloaded: total, bytes };
}

// под кем выполнен вход (рабочая учётная запись Microsoft)
async function currentUser(site) {
  const j = await getJSON(`${site}/_api/web/currentuser?$select=Email,Title,LoginName`);
  return { email: j.Email || j.LoginName || '', name: j.Title || '' };
}
// можно ли скачивать: первый попавшийся файл в папке (и подпапках) — запросом первого байта
async function checkAccess(site, folderPath) {
  const queue = [folderPath];
  for (let n = 0; queue.length && n < 15; n++) {
    const { files, folders } = await listFolder(site, queue.shift());
    const f = files.find((x) => !/^~\$/.test(x.name));
    if (f) {
      try {
        await request(`${site}/_api/web/GetFileByServerRelativePath(decodedurl='${q(f.url)}')/$value`, { file: true, probe: true });
        return { download: true, sample: f.name };
      } catch (e) {
        if (e instanceof BlockedError) return { download: false, sample: f.name };
        throw e;
      }
    }
    folders.forEach((d) => queue.push(d.url));
  }
  return { download: null };   // файлов пока нет
}

module.exports = { AuthError, BlockedError, resolveLink, syncFolder, splitFolderPath, listFolder, currentUser, checkAccess };

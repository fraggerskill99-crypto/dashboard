// Мост вкладок к данным. Встраивается в каждый дашборд и работает в двух режимах:
//  • приложение для ПК (адрес app://) — папки OneDrive/SharePoint и выбранные в «Настройках» файлы
//    отдаёт само приложение;
//  • веб-дашборд одним файлом (вкладка внутри ukpf_dashboard.html) — файлы и папки, выбранные
//    в «⚙ Настройках», браузер хранит в IndexedDB (доступ к ним — по разрешению Chrome/Edge).
// В обоих режимах у вкладки одинаковый window.APP_FS, а NOK-дашборд получает window.desktop.
// В отдельном .html дашборда и на телефоне мост ничего не делает.
(function () {
  const APP = location.protocol === 'app:';
  let WEB = false;
  try { WEB = !APP && window.parent !== window && !!window.parent.__WEB_COMBINED; } catch (e) { /* чужая страница */ }
  if (!APP && !WEB) return;

  // ---------- ручные кнопки загрузки/привязки прячем: всё берётся из «Настроек» ----------
  // в веб-дашборде одним файлом вкладка открыта как about:srcdoc — имя страницы в data-page у её рамки
  let page = location.pathname.split('/').pop();
  try { if (WEB && window.frameElement && window.frameElement.dataset.page) page = window.frameElement.dataset.page; } catch (e) { /* без рамки */ }
  const HIDE = {
    'moika.html': ['.upload-box label.upload-btn:has(#fileInput)', '#pinAktBtn', '#unpinAktBtn', '#pinAllBtn', '#autoAllowBtn', '#autoSync',
      '#aktSourcesList button', '#incubHeaderBtn', '#zppHeaderBtn', '.tab-btn[data-tab="sources"]', '#cpPinBtn',
      '#pinMediaBtn', '#unpinMediaBtn', '#incubMediaPinBtn', '#incubMediaUnpinBtn',
      'label.upload-btn:has(#incubFileInput)', '#pinIncubBtn', '#unpinIncubBtn',
      'label.upload-btn:has(#zppFileInput)', '#pinZppBtn', '#unpinZppBtn',
      'label:has(#scheduleFileInput)', '#scheduleFileInput', '#pinSchedBtn', '#unpinSchedBtn',
      // служебные строки ручной привязки папки Инкубатория — всё прочитанное видно в «⚙ Настройках»
      'div:has(> #incubMediaPinBtn)', 'div:has(> #incubMediaPinBtn) + p.note', '#incubPptxReport'],
    'mb.html': ['#dirLinkBtn', '#dirAllowBtn', '#dirCheckBtn', '#dirUnlinkBtn', '#dirBox + div'],
    'nok.html': ['#uploadBtn', '#fileInput', '#nokPinBtn', '#nokAllowBtn', '#nokChooseBtn', '#nokCheckBtn', '#nokImportBtn'],
  }[page];
  if (HIDE) {
    const st = document.createElement('style');
    st.textContent = HIDE.join(',\n') + ' { display: none !important; }\n' +
      '.app-auto { margin: 0 0 8px; padding: 7px 12px; border-radius: 8px; background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; font: 600 12.5px/1.45 -apple-system, "Segoe UI", Arial, sans-serif; }';
    document.documentElement.appendChild(st);
    const note = APP
      ? '🔄 Данные обновляются автоматически — из папок OneDrive и SharePoint и файлов, выбранных в «⚙ Настройках» (внизу слева).'
      : '🔄 Данные — из файлов и папок, выбранных в «⚙ Настройках» (внизу слева). Обновляются сами; «Обновить сейчас» — там же.';
    document.addEventListener('DOMContentLoaded', () => {
      const at = page === 'moika.html' ? document.querySelector('.upload-box') : page === 'mb.html' ? document.getElementById('dirBox') : document.getElementById('nokBar');
      if (!at) return;
      const d = document.createElement('div'); d.className = 'app-auto'; d.textContent = note;
      at.insertBefore(d, at.firstChild);
    });
  }

  const granted = async () => 'granted';
  const changed = [];
  window.__appDataChanged = () => changed.forEach((cb) => { try { cb(); } catch (e) { console.warn(e); } });

  // папка-«сборник» из нескольких папок (например, только папки с фото): для вкладки — одна привязанная папка
  function groupOf(names, title, kidsAsync) {
    const h = {
      kind: 'directory', name: title, _rel: '#' + names.join('|'),
      queryPermission: granted, requestPermission: granted,
      isSameEntry: async (o) => !!o && o._rel === h._rel,
      async *entries() { for (const [n, k] of await kidsAsync()) yield [n, k]; },
      async *values() { for (const [, k] of await kidsAsync()) yield k; },
      async *keys() { for (const [n] of await kidsAsync()) yield n; },
      async getDirectoryHandle(n) { const k = (await kidsAsync()).find((x) => x[0] === n); if (!k) throw new DOMException(n, 'NotFoundError'); return k[1]; },
      async getFileHandle(n) { throw new DOMException(n, 'NotFoundError'); },
    };
    h[Symbol.asyncIterator] = h.entries;
    return h;
  }

  if (APP) {
    // ================= ПРИЛОЖЕНИЕ ДЛЯ ПК: всё отдаёт само приложение =================
    const enc = (p) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const join = (a, b) => (a ? a + '/' + b : b);
    const notFound = (n) => new DOMException('Нет в папке «Данные»: ' + n, 'NotFoundError');
    async function list(rel) {
      const r = await fetch('/data-list/' + enc(rel));
      if (!r.ok) throw notFound(rel || 'Данные');
      return r.json();
    }
    function fileHandle(rel, e) {
      return {
        kind: 'file', name: e.name, _rel: rel,
        queryPermission: granted, requestPermission: granted,
        isSameEntry: async (o) => !!o && o._rel === rel,
        async getFile() {
          const r = await fetch('/data/' + enc(rel));
          if (!r.ok) throw notFound(rel);
          const b = await r.blob();
          return new File([b], e.name, { type: b.type, lastModified: e.mtime });
        },
      };
    }
    function dirHandle(rel, name) {
      const make = (e) => (e.kind === 'directory' ? dirHandle(join(rel, e.name), e.name) : fileHandle(join(rel, e.name), e));
      const h = {
        kind: 'directory', name, _rel: rel,
        queryPermission: granted, requestPermission: granted,
        isSameEntry: async (o) => !!o && o._rel === rel,
        async *entries() { for (const e of await list(rel)) yield [e.name, make(e)]; },
        async *values() { for (const e of await list(rel)) yield make(e); },
        async *keys() { for (const e of await list(rel)) yield e.name; },
        async getDirectoryHandle(n) { const e = (await list(rel)).find((x) => x.name === n && x.kind === 'directory'); if (!e) throw notFound(join(rel, n)); return make(e); },
        async getFileHandle(n) { const e = (await list(rel)).find((x) => x.name === n && x.kind === 'file'); if (!e) throw notFound(join(rel, n)); return make(e); },
      };
      h[Symbol.asyncIterator] = h.entries;
      return h;
    }
    window.APP_FS = {
      mode: 'app',
      root: () => dirHandle('', 'Данные'),
      group: (names, title) => groupOf(names, title, async () => names.map((n) => [n, dirHandle(n, n)])),
      // какие папки на что: { acts: [...], media: [...], svod: [...] }
      roles: () => fetch('/data-roles').then((r) => r.json()),
      // файлы, выбранные в «Настройках»: { akt: {kind, name, path, mtime, size}, ... }
      async chosen() {
        const st = await (await fetch('/cfg/state')).json();
        const out = {};
        Object.entries(st.files).forEach(([k, v]) => { if (v.chosen) out[k] = Object.assign({ kind: k }, v.chosen); });
        return out;
      },
      async readChosen(f) {
        const r = await fetch('/data/__src/' + f.kind + '/' + encodeURIComponent(f.name));
        if (!r.ok) throw new Error('файл недоступен: ' + (f.path || f.name));
        return new File([await r.arrayBuffer()], f.name, { lastModified: f.mtime });
      },
      async hasData() { try { return (await list('')).length > 0; } catch (e) { return false; } },
    };
    // NOK-дашборд: «Свод» — его выбирает приложение (выбранный файл или папка Свода)
    window.desktop = {
      info: () => fetch('/data-info').then((r) => r.json()),
      read: (rel) => fetch('/data/' + enc(rel)).then((r) => { if (!r.ok) throw notFound(rel); return r.arrayBuffer(); }).then((b) => new Uint8Array(b)),
      open: () => fetch('/cmd/open-data'),
      choose: async () => { await fetch('/cmd/open-data'); return null; },
      onChanged: (cb) => { changed.push(cb); },
    };
    return;
  }

  // ================= ВЕБ-ДАШБОРД: файлы и папки из «⚙ Настроек» (IndexedDB браузера) =================
  // Дескрипторы читаем в этой вкладке сами — тогда файлы «свои» для её библиотек (JSZip, XLSX).
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('ukpf-web-sources', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kvGet(k) {
    const db = await idb();
    return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  }
  const can = async (h) => { try { return (await h.queryPermission({ mode: 'read' })) === 'granted'; } catch (e) { return false; } };
  async function folders() { const all = (await kvGet('folders')) || []; const ok = []; for (const f of all) if (await can(f.handle)) ok.push(f); return ok; }
  async function files() { return (await kvGet('files')) || {}; }
  window.APP_FS = {
    mode: 'web',
    group: (names, title) => groupOf(names, title, async () => (await folders()).filter((f) => names.includes(f.name)).map((f) => [f.name, f.handle])),
    async roles() { const r = { acts: [], media: [], svod: [], nc: [] }; (await folders()).forEach((f) => { if (r[f.role]) r[f.role].push(f.name); }); return r; },
    async chosen() {
      const out = {}, fs = await files();
      for (const [k, h] of Object.entries(fs)) {
        if (!h || !(await can(h))) continue;
        try { const f = await h.getFile(); out[k] = { kind: k, name: f.name, path: f.name, mtime: f.lastModified, size: f.size }; } catch (e) { /* файл удалили/переместили */ }
      }
      return out;
    },
    async readChosen(f) { const h = (await files())[f.kind]; if (!h) throw new Error('файл не выбран'); return h.getFile(); },
    async hasData() { return (await folders()).length > 0 || Object.keys(await this.chosen()).length > 0; },
  };
  // NOK-дашборд: «Свод» — выбранный файл, иначе самый свежий .xlsx в самой папке Свода
  const openSettings = () => { try { window.parent.APP && window.parent.APP.openSettings && window.parent.APP.openSettings(); } catch (e) { /* без оболочки */ } };
  window.desktop = {
    async info() {
      const ch = await window.APP_FS.chosen();
      if (ch.svod) return { dir: 'выбранный файл Свода', latest: { name: ch.svod.name, path: '#svod', mtime: ch.svod.mtime, size: ch.svod.size } };
      let best = null;
      for (const f of (await folders()).filter((x) => x.role === 'svod')) {
        for await (const h of f.handle.values()) {
          if (h.kind !== 'file' || h.name.startsWith('~$') || !/\.xlsx$/i.test(h.name)) continue;
          const file = await h.getFile();
          if (!best || file.lastModified > best.mtime) best = { name: file.name, path: f.name + '/' + file.name, mtime: file.lastModified, size: file.size };
        }
      }
      return { dir: 'папка Свода из «⚙ Настроек»', latest: best };
    },
    async read(p) {
      if (p === '#svod') return new Uint8Array(await (await window.APP_FS.readChosen({ kind: 'svod' })).arrayBuffer());
      const i = p.indexOf('/'), name = p.slice(0, i), file = p.slice(i + 1);
      const f = (await folders()).find((x) => x.name === name);
      if (!f) throw new DOMException(p, 'NotFoundError');
      return new Uint8Array(await (await (await f.handle.getFileHandle(file)).getFile()).arrayBuffer());
    },
    open: async () => openSettings(),
    choose: async () => { openSettings(); return null; },
    onChanged: (cb) => { changed.push(cb); },
  };
})();

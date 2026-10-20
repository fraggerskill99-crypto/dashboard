// Мост приложения для ПК: работает только внутри приложения (адрес app://).
// Папка «Документы\Качество мойки\Данные» (туда скачивается SharePoint) отдаётся
// дашбордам как обычная привязанная папка — без окна выбора папки.
// NOK-дашборду — интерфейс window.desktop (как в его прежней программе для Windows).
(function () {
  if (location.protocol !== 'app:') return;
  const enc = (p) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const join = (a, b) => (a ? a + '/' + b : b);
  const notFound = (n) => new DOMException('Нет в папке «Данные»: ' + n, 'NotFoundError');
  async function list(rel) {
    const r = await fetch('/data-list/' + enc(rel));
    if (!r.ok) throw notFound(rel || 'Данные');
    return r.json();
  }
  const granted = async () => 'granted';
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
  // В приложении данные приходят сами (папки OneDrive/SharePoint) — ручные кнопки загрузки и привязки
  // файлов/папок прячем, вместо них — строка «обновляется автоматически». Ввод баллов вручную остаётся.
  const page = location.pathname.split('/').pop();
  const HIDE = {
    'moika.html': ['.upload-box label.upload-btn:has(#fileInput)', '#pinAktBtn', '#unpinAktBtn', '#pinAllBtn', '#autoAllowBtn', '#autoSync',
      '#aktSourcesList button', '#incubHeaderBtn', '#zppHeaderBtn', '.tab-btn[data-tab="sources"]', '#cpPinBtn',
      '#pinMediaBtn', '#unpinMediaBtn', '#incubMediaPinBtn', '#incubMediaUnpinBtn',
      'label.upload-btn:has(#incubFileInput)', '#pinIncubBtn', '#unpinIncubBtn',
      'label.upload-btn:has(#zppFileInput)', '#pinZppBtn', '#unpinZppBtn',
      'label:has(#scheduleFileInput)', '#scheduleFileInput', '#pinSchedBtn', '#unpinSchedBtn'],
    'mb.html': ['#dirLinkBtn', '#dirAllowBtn', '#dirCheckBtn', '#dirUnlinkBtn', '#dirBox + div'],
    'nok.html': ['#uploadBtn', '#fileInput', '#nokPinBtn', '#nokAllowBtn', '#nokChooseBtn', '#nokCheckBtn', '#nokImportBtn'],
  }[page];
  if (HIDE) {
    const st = document.createElement('style');
    st.textContent = HIDE.join(',\n') + ' { display: none !important; }\n' +
      '.app-auto { margin: 0 0 8px; padding: 7px 12px; border-radius: 8px; background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; font: 600 12.5px/1.45 -apple-system, "Segoe UI", Arial, sans-serif; }';
    document.documentElement.appendChild(st);
    const note = '🔄 Данные обновляются автоматически — из папок OneDrive и SharePoint (меню «Файл → Папки на компьютере», «SharePoint»). Вручную загружать ничего не нужно.';
    document.addEventListener('DOMContentLoaded', () => {
      const at = page === 'moika.html' ? document.querySelector('.upload-box') : page === 'mb.html' ? document.getElementById('dirBox') : document.getElementById('nokBar');
      if (!at) return;
      const d = document.createElement('div'); d.className = 'app-auto'; d.textContent = note;
      at.insertBefore(d, at.firstChild);
    });
  }

  window.APP_FS = {
    root: () => dirHandle('', 'Данные'),
    async hasData() { try { return (await list('')).length > 0; } catch (e) { return false; } },
  };

  // NOK-дашборд: «Свод» — самый свежий .xlsx со словом «свод» (иначе «МБ/NOK») в папке «Данные»
  const changed = [];
  window.__appDataChanged = () => changed.forEach((cb) => { try { cb(); } catch (e) { console.warn(e); } });
  window.desktop = {
    info: () => fetch('/data-info').then((r) => r.json()),
    read: (rel) => fetch('/data/' + enc(rel)).then((r) => { if (!r.ok) throw notFound(rel); return r.arrayBuffer(); }).then((b) => new Uint8Array(b)),
    open: () => fetch('/cmd/open-data'),
    choose: async () => { await fetch('/cmd/open-data'); return null; },
    onChanged: (cb) => { changed.push(cb); },
  };
})();

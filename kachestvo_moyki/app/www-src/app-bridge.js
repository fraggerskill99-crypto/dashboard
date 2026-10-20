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

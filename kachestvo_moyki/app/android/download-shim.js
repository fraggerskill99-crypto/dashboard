// Только для приложения Android (Capacitor): там ссылки «скачать» из дашборда
// (PNG, PowerPoint, Excel, отчёты) ничего не делают. Перехватываем их и отдаём
// файл в окно «Поделиться» — оттуда «Сохранить», WhatsApp, Telegram, почта.
(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var P = C.Plugins || {};
  if (!P.Filesystem || !P.Share) return;

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1] || ''); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  async function shareFile(href, name) {
    try {
      var blob = await (await fetch(href)).blob();
      name = (name || 'file').replace(/[\\/:*?"<>|]+/g, '_');
      var res = await P.Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: 'CACHE' });
      await P.Share.share({ title: name, files: [res.uri], dialogTitle: 'Сохранить или отправить' });
    } catch (e) {
      if (!/cancel/i.test(String(e && e.message))) alert('Не удалось сохранить файл: ' + (e && e.message ? e.message : e));
    }
  }
  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && /^(blob:|data:)/.test(this.href)) { shareFile(this.href, this.getAttribute('download')); return; }
    return origClick.apply(this, arguments);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[download]');
    if (a && /^(blob:|data:)/.test(a.href)) { e.preventDefault(); shareFile(a.href, a.getAttribute('download')); }
  }, true);
})();

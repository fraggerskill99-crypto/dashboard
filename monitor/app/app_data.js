/* Источник записей для устанавливаемого приложения (вместо базы claude.ai).
   1) записи, вшитые при сборке; 2) свежий список из репозитория, если есть интернет;
   3) эпизоды, добавленные на этом устройстве (хранятся только здесь). */
(async () => {
  const LOCAL_KEY = 'epi:local', CACHE_KEY = 'epi:remote';
  const readLS = (k, d) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } };
  const writeLS = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  const norm = d => Array.isArray(d) ? {updatedAt: null, episodes: d} : d;
  let base = norm(window.__EPISODES__ || await fetch('data/seed.json').then(r => r.json()).catch(() => ({episodes: []})));
  const cached = readLS(CACHE_KEY, null);
  if (cached && (cached.updatedAt || '') >= (base.updatedAt || '')) base = cached;
  let local = readLS(LOCAL_KEY, []);
  const publish = () => {
    items = [...base.episodes, ...local];
    meta = {updatedAt: base.updatedAt};
    loaded = true; render();
  };
  db = {
    collection: () => ({
      add: async doc => {
        local.push({...doc, id: 'local-' + Date.now()});
        writeLS(LOCAL_KEY, local); publish();
      }
    })
  };
  $('addBtn').hidden = false; $('addBtn').dataset.allowed = '1';
  publish();
  if (window.__DATA_URL__ && navigator.onLine !== false){
    try{
      const r = await fetch(window.__DATA_URL__ + '?t=' + Date.now(), {cache: 'no-store'});
      if (r.ok){
        const fresh = norm(await r.json());
        if (fresh && Array.isArray(fresh.episodes) && (fresh.updatedAt || '') >= (base.updatedAt || '')){
          base = fresh; writeLS(CACHE_KEY, fresh); publish();
        }
      }
    }catch(e){ /* нет сети — работаем на сохранённых данных */ }
  }
})();

/* ===== доступ к ИИ: среда выполнения артефакта, ключ не нужен ===== */
const AI = (function(){
  let box = null;                       // куда рисовать состояние
  let ready = false;                    // среда ответила
  let absent = false;                   // среда ответила, что ИИ здесь нет
  const resolved = (async () => {
    try{
      if (typeof claude === 'undefined' || !claude.use) return null;
      return await claude.use('sample');
    }catch(e){ return null; }
  })().then(s=>{ ready = true; absent = !s; if (box) draw(); return s; });

  function draw(){
    if (!box) return;
    resolved.then(s=>{
      box.innerHTML = s
        ? `<p class="hint">Ключ не нужен: приложение обращается к Claude через среду, в которой открыта эта страница. Первый запрос спросит у вас разрешение, дальше работает без вопросов. Запросы расходуют ваш лимит Claude.</p>
           <p><span class="badge on">ИИ доступен</span></p>`
        : `<p class="hint">Эта копия страницы открыта вне Claude, поэтому обработка текста ИИ недоступна. Приложение продолжает работать: текст собирается из ваших полей, документ Word выгружается как обычно. Чтобы вернуть ИИ, откройте страницу по ссылке на claude.ai — или возьмите версию приложения с ключом Anthropic API.</p>
           <p><span class="badge off">ИИ недоступен</span></p>`;
    });
  }

  const COPY = {
    not_granted:'вы не разрешили этой странице обращаться к Claude',
    sampling_disabled:'в этой учётной записи Claude недоступен',
    not_declared:'страница больше не объявляет доступ к ИИ',
    capability_disabled:'доступ к ИИ отключён в этом окне',
    capability_removed:'окно просмотра слишком старое для этого вызова',
    rate_limited:'слишком много запросов подряд либо исчерпан лимит — попробуйте позже',
    session_expired:'нужно заново войти в Claude',
    refused:'Claude отказался обрабатывать этот запрос — измените формулировку',
    empty_completion:'ответ пришёл пустым — упростите запрос',
    prompt_too_large:'слишком много текста в запросе — снимите часть отмеченных фрагментов',
    invalid_request:'запрос составлен неверно',
    cancelled:'запрос отменён',
    upstream_error:'служба временно недоступна'
  };

  return {
    hint: 'Обработка текста ИИ работает, когда страница открыта по ссылке через claude.ai.',
    available: () => !absent,            // пока среда не ответила — считаем доступным
    renderAccess(el){ box = el; el.innerHTML = '<p class="hint">Проверяю доступ к ИИ…</p>'; draw(); },
    async ask(system, prompt, maxTokens){
      const sample = await resolved;
      if (!sample) throw new Error('ИИ доступен только при открытии страницы через Claude');
      try{
        /* в этой среде нет системной роли — правила идут первым сообщением пользователя */
        const res = await sample(
          [{role:'user', content: system}, {role:'user', content: prompt}],
          { modelTier: 'default', cache: false }
        );
        const text = (res && res.text || '').trim();
        if (!text) throw new Error('пустой ответ');
        if (res.truncated) msg('Ответ оказался длинным и оборван — проверьте конец текста.', 'warn');
        return text;
      }catch(e){
        if (e && e.code) throw new Error(COPY[e.code] || e.message || 'ошибка обращения к ИИ');
        throw e;
      }
    }
  };
})();

/* сохранение файла через среду выполнения артефакта, иначе обычной ссылкой */
async function saveFile(name, blob){
  try{
    if (typeof claude !== 'undefined' && claude.use){
      const downloads = await claude.use('downloads');
      if (downloads){
        await downloads.save({ filename: name, data: blob });
        return true;
      }
    }
  }catch(e){
    if (e && e.code === 'declined') return false;
    if (e && e.code) msg('Скачивание через Claude не удалось (' + esc(e.code) + '), пробую обычной ссылкой.', 'warn');
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  return true;
}

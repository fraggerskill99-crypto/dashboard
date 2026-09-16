/* ===== доступ к ИИ: прямые запросы к Anthropic API с ключом пользователя ===== */
const AI = (function(){
  const getKey   = () => LS.get('sz2:key', '');
  const getModel = () => LS.get('sz2:model', 'claude-sonnet-5');

  function state(el){
    const k = getKey();
    el.querySelector('#keyState').innerHTML = k
      ? '<span class="badge on">ключ сохранён</span>'
      : '<span class="badge off">ключа нет</span>';
  }

  return {
    hint: 'Чтобы текст писал ИИ, укажите ключ Anthropic API на вкладке «ИИ».',
    available: () => !!getKey(),
    renderAccess(el){
      el.innerHTML = `
        <p class="hint">Приложение обращается к ИИ напрямую из браузера. Нужен ключ Anthropic API — он хранится только в этом браузере и не уходит никуда, кроме api.anthropic.com. Без ключа приложение работает, но текст собирается только из ваших полей.</p>
        <div class="grid two">
          <label class="f">Ключ Anthropic API
            <input type="text" id="apiKey" placeholder="sk-ant-…" autocomplete="off">
          </label>
          <label class="f">Модель
            <input type="text" id="apiModel" placeholder="claude-sonnet-5">
          </label>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn" id="keySave">Сохранить ключ</button>
          <button class="btn del" id="keyClear">Удалить ключ</button>
          <span id="keyState"></span>
        </div>
        <p class="hint" style="margin-top:12px">Ключ получают в консоли Anthropic. Не вводите его на чужом компьютере: любой, кто сядет за этот браузер, сможет им пользоваться.</p>`;
      el.querySelector('#apiKey').value = getKey();
      el.querySelector('#apiModel').value = getModel();
      el.querySelector('#keySave').onclick = () => {
        LS.set('sz2:key', el.querySelector('#apiKey').value.trim());
        LS.set('sz2:model', el.querySelector('#apiModel').value.trim() || 'claude-sonnet-5');
        state(el); msg('Ключ сохранён в этом браузере.', 'ok');
      };
      el.querySelector('#keyClear').onclick = () => {
        LS.del('sz2:key'); el.querySelector('#apiKey').value = '';
        state(el); msg('Ключ удалён.', 'ok');
      };
      state(el);
    },
    async ask(system, prompt, maxTokens){
      const key = getKey();
      if (!key) throw new Error('не указан ключ Anthropic API');
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{
          'content-type':'application/json',
          'x-api-key': key,
          'anthropic-version':'2023-06-01',
          'anthropic-dangerous-direct-browser-access':'true'
        },
        body: JSON.stringify({
          model: getModel(),
          max_tokens: maxTokens || 1500,
          system: system,
          messages: [{role:'user', content: prompt}]
        })
      });
      if (!r.ok){
        const t = await r.text();
        throw new Error('ответ сервера ' + r.status + ': ' + t.slice(0,200));
      }
      const data = await r.json();
      const text = (data.content||[]).map(i=>i.type==='text'?i.text:'').join('\n').trim();
      if (!text) throw new Error('пустой ответ');
      return text;
    }
  };
})();

/* сохранение файла обычной ссылкой */
async function saveFile(name, blob){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  return true;
}

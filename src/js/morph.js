/* ============ склонение фамилий, должностей и подразделений ============
   Без словаря, по окончаниям. Нужно там, где текст собирается без ИИ:
   в образцах нарушитель стоит в творительном падеже, а в просьбе — в родительном. */
const MORPH = (function(){
  const VOW = 'аеёиоуыэюя';
  const HUSH = 'жчшщ';
  const last = (w) => w.slice(-1);
  const isFemSurname = (w) => /(ова|ева|ёва|ина|ына|ская|цкая|ая)$/i.test(w);
  const indeclinable = (w) => /(ко|ых|их|аго|ово|ю|у|е|э|и|о)$/i.test(w) && !/(ая|яя)$/i.test(w);

  /* Фамилия. Инициалы остаются как есть. */
  function surname(full, form){
    const parts = String(full||'').trim().split(/\s+/);
    if (!parts.length || !parts[0]) return '';
    let w = parts[0];
    const rest = parts.slice(1).join(' ');
    const out = (x) => (rest ? x + ' ' + rest : x);
    if (isFemSurname(w)){
      const stem = w.replace(/(ая)$/i,'').replace(/(а)$/i,'');
      return out(/(ская|цкая|ая)$/i.test(w) ? stem + 'ой' : stem + 'ой');
    }
    if (indeclinable(w)) return out(w);
    if (/(ский|цкий|ый|ий)$/i.test(w)){
      const stem = w.slice(0,-2);
      return out(form === 'gen' ? stem + 'ого' : stem + 'им');
    }
    if (/(ов|ёв|ев|ин|ын)$/i.test(w))
      return out(form === 'gen' ? w + 'а' : w + 'ым');
    if (/(ь|й)$/i.test(w)){
      const stem = w.slice(0,-1);
      return out(form === 'gen' ? stem + 'я' : stem + 'ем');
    }
    if (VOW.includes(last(w).toLowerCase())) return out(w);   // Кенже, Дюма — не склоняем
    return out(form === 'gen' ? w + 'а' : w + (HUSH.includes(last(w).toLowerCase()) ? 'ем' : 'ом'));
  }

  /* «инкубаторий» и «комментарий» — существительные, поэтому одного -ий мало */
  const isAdj = (w) => w.length > 4 &&
    (/(ый|ой|ая|яя|ое|ее)$/i.test(w) || /(ский|цкий|ний|чий|жий|ший|щий|рний|льный)$/i.test(w));
  function adj(w, form){
    const stem = w.slice(0,-2), end = w.slice(-2).toLowerCase();
    const fem = end === 'ая' || end === 'яя';
    if (fem) return stem + (end === 'яя' ? 'ей' : 'ой');       // и родительный, и творительный
    const soft = (end === 'ий' || end === 'ее') && !'кгхжчшщ'.includes(stem.slice(-1).toLowerCase());
    if (form === 'gen') return stem + (soft ? 'его' : 'ого');
    return stem + (end === 'ий' ? 'им' : 'ым');
  }
  function noun(w, form){
    const l = last(w).toLowerCase(), stem = w.slice(0,-1);
    if (form === 'gen'){
      if (l === 'а') return stem + ('кгхжчшщ'.includes(stem.slice(-1).toLowerCase()) ? 'и' : 'ы');
      if (l === 'я') return stem + 'и';
      if (l === 'ь' || l === 'й') return stem + 'я';           // слесаря, инкубатория
      if (l === 'о' || l === 'е') return stem + 'а';
      return w + 'а';
    }
    if (l === 'а') return stem + 'ой';
    if (l === 'я') return stem + 'ей';
    if (l === 'ь' || l === 'й') return stem + 'ем';
    if (l === 'о' || l === 'е') return w + 'м';
    if (l === 'ч' || l === 'щ') return w + 'ом';              // врачом, но сторожем
    return w + (HUSH.includes(l) ? 'ем' : 'ом');
  }

  /* Словосочетание: склоняем прилагательные и первое существительное,
     хвост вроде «по вакцинации» или «аварийно-восстановительных работ» не трогаем. */
  function phrase(text, form){
    const words = String(text||'').trim().split(/\s+/);
    if (!words[0]) return '';
    const out = []; let headDone = false;
    for (const w of words){
      if (headDone || /^(по|при|для|на|в|с|о|от)$/i.test(w)){ headDone = true; out.push(w); continue; }
      if (isAdj(w)){ out.push(adj(w, form)); continue; }
      out.push(noun(w, form)); headDone = true;
    }
    return out.join(' ');
  }

  return {
    surnameInstr: (s) => surname(s, 'instr'),
    surnameGen:   (s) => surname(s, 'gen'),
    phraseInstr:  (s) => phrase(s, 'instr'),
    phraseGen:    (s) => phrase(s, 'gen')
  };
})();

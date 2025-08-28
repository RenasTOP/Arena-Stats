// js/augments-patch.js
(function(){
  function escapeHtml(s){return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

  async function run(){
    let strings = {};
    try { strings = await window.ArenaStrings.get('en_us'); } catch(e){ console.error(e); }

    // upgrade elements that mark augment ids
    const nodes = [
      ...document.querySelectorAll('[data-augment-id]'),
      ...document.querySelectorAll('.augment-id')
    ];

    for (const el of nodes){
      const raw = el.getAttribute('data-augment-id') || el.textContent.trim();
      const id = isNaN(Number(raw)) ? raw : Number(raw);
      const a = strings[id];
      if (!a) continue;

      const name = escapeHtml(a.name);
      const desc = a.desc || '';
      el.classList.add('augment');
      el.setAttribute('title', a.name);
      el.innerHTML = name + '<span class="augment-tooltip">' + desc + '</span>';
    }
  }

  // run after your match DOM exists, and also when the page changes
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

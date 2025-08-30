window.ArenaStrings = window.ArenaStrings || {};

window.ArenaStrings.get = async function(locale = 'en_us'){
  const key = 'cdragon-arena-' + locale;
  try {
    const cached = localStorage.getItem(key);
    if (cached) return JSON.parse(cached);
  } catch {}

  const url = 'https://raw.communitydragon.org/latest/cdragon/arena/' + locale + '.json';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('CDragon fetch failed ' + res.status);
  const json = await res.json();

  const map = {};
  for (const aug of json.augments || []) {
    map[aug.id] = {
      name: aug.name,
      tier: aug.rarity,
      desc: aug.tooltip || ''
    };
  }
  try { localStorage.setItem(key, JSON.stringify(map)); } catch {}
  return map;
};

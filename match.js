// Match page (details + augments)
const API_BASE = "https://arenaproxy.irenasthat.workers.dev";
function api(pathAndQuery){
  const base = API_BASE.replace(/\/+$/, "");
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  return `${base}${path}`;
}

let DD_VERSION = "15.16.1";
const NAME_FIX = { FiddleSticks:"Fiddlesticks", Wukong:"MonkeyKing", KhaZix:"Khazix", VelKoz:"Velkoz", ChoGath:"Chogath", KaiSa:"Kaisa", LeBlanc:"Leblanc", DrMundo:"DrMundo", Nunu:"Nunu", Renata:"Renata", RekSai:"RekSai", KogMaw:"KogMaw", BelVeth:"Belveth", TahmKench:"TahmKench" };
const ITEM_DB = { byId:{} };
const AUG_DB = { byId:{} };

function champIcon(name){ const fixed = NAME_FIX[name] || name; return `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/champion/${encodeURIComponent(fixed)}.png`; }
function itemIcon(id){ return !id||id===0 ? "" : `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/item/${id}.png`; }
function splashUrl(name){ const fixed = NAME_FIX[name] || name; return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${encodeURIComponent(fixed)}_0.jpg`; }
function ordinal(n){ if(n===1) return "1st"; if(n===2) return "2nd"; if(n===3) return "3rd"; if(!Number.isFinite(n)) return "?"; return `${n}th`; }
function timeAgo(ts){ if(!ts) return "unknown"; const s=Math.max(1,Math.floor((Date.now()-Number(ts))/1000)); const m=Math.floor(s/60); if(m<60) return `${m}m ago`; const h=Math.floor(m/60); if(h<48) return `${h}h ago`; const d=Math.floor(h/24); return `${d}d ago`; }
const esc = (s)=> String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
const stripTags = (html)=> String(html||"").replace(/<[^>]*>/g,"");

async function fetchJSON(url){ const r = await fetch(url); if (!r.ok) throw new Error(`${r.status}`); return r.json(); }

// Tooltip
const tipEl = document.getElementById("tooltip");
function showTip(html, x, y){
  tipEl.innerHTML = String(html).replace(/\n/g,"<br>");
  tipEl.style.left = Math.min(window.innerWidth - tipEl.offsetWidth - 8, x + 14) + "px";
  tipEl.style.top  = Math.min(window.innerHeight - tipEl.offsetHeight - 8, y + 14) + "px";
  tipEl.classList.add('show');
}
function hideTip(){ tipEl.classList.remove('show'); }
document.addEventListener('mouseover', (e)=>{
  const t = e.target.closest('[data-tip]');
  if (!t) return;
  const content = t.getAttribute('data-tip'); if (!content) return;
  const move = (ev)=> showTip(content, ev.clientX, ev.clientY);
  move(e);
  document.addEventListener('mousemove', move);
  const off = ()=>{ hideTip(); document.removeEventListener('mousemove', move); t.removeEventListener('mouseleave', off); };
  t.addEventListener('mouseleave', off, { once:true });
}, true);

async function initDDragon(){
  try {
    const r = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
    if (r.ok){ const arr = await r.json(); if (arr?.[0]) DD_VERSION = arr[0]; }
  } catch {}
  try {
    const r = await fetch(`https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/data/en_US/item.json`);
    if (r.ok){ const data = await r.json(); ITEM_DB.byId = data.data || {}; }
  } catch {}
}
function isArcaneSweeper(id){
  const rec = ITEM_DB.byId?.[String(id)];
  if (!rec) return false;
  return /arcane\s*sweeper/i.test(rec.name || "");
}
function itemTip(id){
  const rec = ITEM_DB.byId?.[String(id)];
  if(!rec) return `Item ${id}`;
  const name = rec.name || `Item ${id}`;
  const cost = rec.gold?.total ? ` • ${rec.gold.total}g` : "";
  const desc = rec.plaintext || stripTags(rec.description||"");
  return `<strong>${name}${cost}</strong>\n${desc}`;
}

/* Augments — use the official cherry-augments list (has icons) */
async function initAugments(){
  const KEY = "arena_aug_db_v2";
  try {
    const cached = localStorage.getItem(KEY);
    if (cached) { Object.assign(AUG_DB, JSON.parse(cached)); return; }
  } catch {}

  let raw = null;

  // 1) preferred – client game-data list with iconPath
  try{
    const r = await fetch("https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json", { cache: "force-cache" });
    if (r.ok) raw = await r.json();
  }catch{}

  // 2) fallback – older cdragon export
  if (!raw){
    const r = await fetch("https://raw.communitydragon.org/latest/cdragon/arena/en_us.json", { cache: "force-cache" });
    raw = await r.json();
  }

  const byId = {};
  const list = Array.isArray(raw) ? raw : (raw.augments || raw || []);
  for (const a of list){
    const id = String(a.id ?? a.augmentId ?? a.AugmentId ?? a.apiName ?? a.name);
    const name = a.name || a.displayName || a.apiName || `Augment ${id}`;

    // icons: iconPath usually lives on both files
    const iconPath = (a.iconPath || a.icon || a.imagePath || "").replace(/^\/+/, "");
    const icon = iconPath ? `https://raw.communitydragon.org/latest/${iconPath}` : "";

    // description: clean placeholders like @Value@
    let desc = a.longDesc || a.description || a.tooltip || a.tooltipSimple || "";
    desc = String(desc)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/@[^@]+@/g, "")   // strip unresolved tokens (better than showing garbage)
      .replace(/\s+/g," ")
      .trim();

    byId[id] = { id, name, icon, desc };
  }

  AUG_DB.byId = byId;
  try { localStorage.setItem(KEY, JSON.stringify({ byId })); } catch {}
}

function getAugmentIds(p){
  const out = [];
  if (Array.isArray(p.playerAugmentIds)) out.push(...p.playerAugmentIds);
  if (Array.isArray(p.augments)) out.push(...p.augments);
  for (let i=0;i<6;i++){
    const v = p[`playerAugment${i}`] ?? p[`arenaAugment${i}`];
    if (Number.isFinite(v)) out.push(v);
  }
  return [...new Set(out.map(x => String(x)).filter(Boolean))];
}
function renderAugments(p){
  const ids = getAugmentIds(p);
  if (!ids.length) return "";
  return `<div class="augments">` + ids.map(id=>{
    const a = AUG_DB.byId[String(id)];
    if (!a) return `<span class="tag muted">Augment #${id}</span>`;
    const tip = `<strong>${esc(a.name)}</strong>${a.desc?`<br>${esc(a.desc)}`:""}`;
    const onerr = "this.onerror=null;this.remove();";
    return `<img class="aug-ico tip" src="${a.icon}" alt="${a.name}" data-tip="${tip}" onerror="${onerr}">`;
  }).join("") + `</div>`;
}

/* ---- Page ---- */
const summary = document.getElementById("summary");
const teamsBox = document.getElementById("teams");

(async function main(){
  const u = new URL(location.href);
  const matchId = u.searchParams.get("id");
  const region = u.searchParams.get("region") || "europe";
  const focus = u.searchParams.get("puuid") || "";

  if (!matchId) { summary.innerHTML = `<div class="pill">Missing match id</div>`; return; }

  await initDDragon();
  await initAugments();

  const data = await fetchJSON(api(`/match?id=${encodeURIComponent(matchId)}&region=${encodeURIComponent(region)}`));
  const info = data?.info || {};
  const parts = info.participants || [];

  // group into teams by placement (Arena = duo per place)
  const byPlace = new Map();
  for (const p of parts){
    const place = Number(p.placement ?? p.challenges?.arenaPlacement ?? 0);
    const arr = byPlace.get(place) || [];
    arr.push(p);
    byPlace.set(place, arr);
  }

  const when = new Date(info.gameStartTimestamp || info.gameStart || 0);
  summary.innerHTML = `
    <div class="pill">Queue ${info.queueId ?? "?"}</div>
    <div class="pill">Played <span class="tip" data-tip="${esc(when.toLocaleString())}">${timeAgo(when.getTime())}</span></div>
    <div class="pill">Duration ${Math.round((info.gameDuration||0)/60)}m</div>
    <a class="link" href="./">Search another</a>
  `;

  const places = [...byPlace.keys()].sort((a,b)=>a-b);
  teamsBox.innerHTML = places.map(place=>{
    const pair = (byPlace.get(place)||[]).slice(0,2);
    return teamCard(place, pair, focus, region);
  }).join("");

  // Single, non-repeating splash
  const champSplash = pairChampForSplash(parts, focus);
  if (champSplash){
    document.body.style.backgroundImage =
      `radial-gradient(60% 40% at 50% 15%, rgba(255,138,31,.10), transparent 70%), url('${splashUrl(champSplash)}')`;
  }
})().catch(err=>{
  summary.innerHTML = `<div class="pill">Error loading match</div>`;
  console.error(err);
});

function pairChampForSplash(parts, focus){
  const me = parts.find(p=>p.puuid===focus);
  return me?.championName || parts[0]?.championName || null;
}

function teamCard(place, pair, focus, region){
  const cls = place===1?"p1":place===2?"p2":place===3?"p3":"px";
  const head = `
    <div class="team-head">
      <div class="team-rank">Team — ${ordinal(place)}</div>
      <span class="badge ${cls}">${ordinal(place)}</span>
    </div>`;

  const body = pair.map(p=> playerRow(p, focus, region)).join("");
  return `<article class="team-card">${head}<div class="team-body">${body}</div></article>`;
}

function playerRow(p, focus, region){
  const me = p.puuid === focus;
  const url = profileLink(p, region);
  const ids = [p.item0,p.item1,p.item2,p.item3,p.item4,p.item5,p.item6].filter(x=>Number.isFinite(x)&&x>0).filter(id=>!isArcaneSweeper(id));
  const items = ids.map(id => `<img class="tip" data-tip="${esc(itemTip(id))}" src="${itemIcon(id)}" alt="${id}">`).join("");
  const kda = `${p.kills}/${p.deaths}/${p.assists}`;

  return `<a class="player ${me?'me':''}" href="${url}">
    <div class="row">
      <img class="champ-ico" src="${champIcon(p.championName)}" alt="${p.championName}">
      <div class="col">
        <div class="pname">${p.riotIdGameName ? `${p.riotIdGameName}#${p.riotIdTagline}` : (p.summonerName||'Unknown')}</div>
        <div class="tiny">KDA <strong>${kda}</strong> · ${p.championName}</div>
        <div class="items">${items}</div>
        ${renderAugments(p)}
      </div>
      <div class="place badge ${placeClass(p)}" title="Final placement">${ordinal(Number(p.placement ?? p.challenges?.arenaPlacement ?? 0))}</div>
    </div>
  </a>`;
}

function placeClass(p){
  const n = Number(p.placement ?? p.challenges?.arenaPlacement ?? 0);
  return n===1?"p1":n===2?"p2":n===3?"p3":"px";
}

function profileLink(p, region){
  const base = new URL(location.href.replace(/[^/]*$/, ""));
  const target = new URL("./", base);
  const id = p.riotIdGameName && p.riotIdTagline ? `${p.riotIdGameName}#${p.riotIdTagline}` : (p.summonerName || "");
  if (!id.includes("#")) return target.toString();
  target.searchParams.set("id", id);
  target.searchParams.set("region", region);
  return target.toString();
}

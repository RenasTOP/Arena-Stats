// Arena.gg frontend — safe 10-id chunks to avoid Cloudflare subrequest limits
const API_BASE = "https://arenaproxy.irenasthat.workers.dev"; // no trailing slash
const ARENA_QUEUE = 1700;

const PAGE_SIZE = 100;      // Riot max for /match-ids
const CHUNK_SIZE = 10;      // <= worker MAX_IDS_PER_REQ (12)
const IDS_PAGE_DELAY = 200;

// Keep version stable so we don't blow away cache accidentally
const CACHE_VERSION = "v7";

function api(pathAndQuery){
  const base = API_BASE.replace(/\/+$/, "");
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  return `${base}${path}`;
}

// ---- DOM ----
const form = document.getElementById("search-form");
const riotIdInput = document.getElementById("riotid");
const regionSelect = document.getElementById("region-select");
const btnUpdate = document.getElementById("btn-update");
const matchesBox = document.getElementById("matches");
const kpisBox = document.getElementById("kpis");

const champInput = document.getElementById("champ-input");
const champClear = document.getElementById("champ-clear");
const champDatalist = document.getElementById("champ-datalist");

const winsChecklist = document.getElementById("wins-checklist");
const hardestList = document.getElementById("hardest-list");
const placementsCanvas = document.getElementById("placements-canvas");
const placementsRange = document.getElementById("placements-range");
const lastUpdatedEl = document.getElementById("last-updated");

const filters = document.querySelector("#tab-matches .filters");
const synergyTableBody = document.querySelector("#synergy-table tbody");
const duoTableBody = document.querySelector("#duo-table tbody");

const bestDuoEl = document.getElementById("best-duo")?.querySelector(".duo-value");
const commonDuoEl = document.getElementById("common-duo")?.querySelector(".duo-value");

// Progress UI
const progressWrap = document.getElementById("progress-wrap");
const progressBar  = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");

// Status line
const statusBox = createStatus();

// ---- State ----
let DD_VERSION = "15.16.1";
const NAME_FIX = { FiddleSticks:"Fiddlesticks", Wukong:"MonkeyKing", KhaZix:"Khazix", VelKoz:"Velkoz", ChoGath:"Chogath", KaiSa:"Kaisa", LeBlanc:"Leblanc", DrMundo:"DrMundo", Nunu:"Nunu", Renata:"Renata", RekSai:"RekSai", KogMaw:"KogMaw", BelVeth:"Belveth", TahmKench:"TahmKench" };
const ITEM_DB = { byId:{} };

let CURRENT = {
  gameName: "", tagLine: "",
  puuid: null, region: "europe",
  matches: [],
  ids: [],
  filter: "all",
  champQuery: "",
  lastUpdated: null,
};

const cacheKey = (puuid)=>`arena_cache_${CACHE_VERSION}:${puuid}`;

// ---- Tabs (simple) ----
document.addEventListener("click", (e)=>{
  const t = e.target.closest("[data-tab]");
  if (!t) return;
  const key = t.dataset.tab;
  document.querySelectorAll("[data-tab]").forEach(b=> b.classList.toggle("active", b===t));
  document.querySelectorAll(".tab").forEach(el=> el.classList.remove("active"));
  document.getElementById(`tab-${key}`)?.classList.add("active");
});

// ---- Filters ----
filters.addEventListener("click", (e)=>{
  const btn = e.target.closest("button"); if (!btn) return;
  [...filters.children].forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  CURRENT.filter = btn.dataset.filter;
  renderHistory();
});
champInput.addEventListener("input", ()=>{ CURRENT.champQuery = (champInput.value || "").trim(); renderHistory(); });
champClear.addEventListener("click", ()=>{ champInput.value=""; CURRENT.champQuery=""; renderHistory(); });

// ---- Actions ----
form.addEventListener("submit", onSearch);
btnUpdate.addEventListener("click", () => refresh(true));
matchesBox.addEventListener("click", (e)=>{
  const card = e.target.closest(".item");
  if (!card) return;
  const id = card.dataset.id;
  const base = new URL(location.href.replace(/[^/]*$/, ""));
  const url = new URL("match.html", base);
  url.searchParams.set("id", id);
  url.searchParams.set("puuid", CURRENT.puuid || "");
  url.searchParams.set("region", CURRENT.region || "");
  location.href = url.toString();
});

// ---- Helpers ----
function champIcon(name){ const fixed = NAME_FIX[name] || name; return `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/champion/${encodeURIComponent(fixed)}.png`; }
function splashUrl(name){ const fixed = NAME_FIX[name] || name; return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${encodeURIComponent(fixed)}_0.jpg`; }
function itemIcon(id){ return !id||id===0 ? "" : `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/item/${id}.png`; }
function itemName(id){ const rec = ITEM_DB.byId?.[String(id)]; return rec ? rec.name : `Item ${id}`; }
function ordinal(n){ if(n===1) return "1st"; if(n===2) return "2nd"; if(n===3) return "3rd"; if(!Number.isFinite(n)) return "?"; return `${n}th`; }
function timeAgo(ts){ if(!ts) return "unknown"; const s=Math.max(1,Math.floor((Date.now()-Number(ts))/1000)); const m=Math.floor(s/60); if(m<60) return `${m}m ago`; const h=Math.floor(m/60); if(h<48) return `${h}h ago`; const d=Math.floor(h/24); return `${d}d ago`; }
function status(t){ statusBox.textContent = t||""; }
function setLastUpdated(ts){ lastUpdatedEl.textContent = ts ? `Last updated, ${new Date(ts).toLocaleString()}` : ""; }
const esc = (s)=> String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");
const stripTags = (html)=> String(html||"").replace(/<[^>]*>/g,"");

/* ------- Tooltips (items & date) ------- */
const tipEl = (()=>{ const d=document.createElement('div'); d.id='tooltip'; document.body.appendChild(d); return d; })();
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

function itemTip(id){
  const rec = ITEM_DB.byId?.[String(id)];
  if(!rec) return `Item ${id}`;
  const name = rec.name || `Item ${id}`;
  const cost = rec.gold?.total ? ` • ${rec.gold.total}g` : "";
  const desc = rec.plaintext || stripTags(rec.description||"");
  return `<strong>${name}${cost}</strong>\n${desc}`;
}

/* Hide only the Arena trinket Arcane Sweeper */
function isArcaneSweeper(id){
  const rec = ITEM_DB.byId?.[String(id)];
  if (!rec) return false;
  return /arcane\s*sweeper/i.test(rec.name || "");
}

// ---- Data loads ----
async function fetchJSON(url, tries=3, delay=600){
  const r = await fetch(url);
  if (r.ok) return r.json();
  const txt = await r.text().catch(()=> "");
  const is429 = r.status===429 || /Riot 429/i.test(txt);
  if (is429 && tries>0){ await new Promise(r=>setTimeout(r, delay)); return fetchJSON(url, tries-1, delay*2); }
  throw new Error(`Request failed, ${r.status}${txt?`, ${txt}`:""}`);
}
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
function loadCache(puuid){
  try { const v = localStorage.getItem(cacheKey(puuid)); if (v) return JSON.parse(v); } catch {}
  const fallbacks = [`arena_cache_v7.2:${puuid}`, `arena_cache_v7:${puuid}`];
  for (const k of fallbacks){ try { const v = localStorage.getItem(k); if (v) return JSON.parse(v); } catch {} }
  return null;
}
function saveCache(puuid, payload){ try { localStorage.setItem(cacheKey(puuid), JSON.stringify(payload)); } catch {} }
function createStatus(){ const el=document.createElement("div"); el.id="status"; el.className="container muted"; document.body.prepend(el); return el; }
function mapRegionUItoRouting(ui){ if ((ui||"").toLowerCase()==="na") return "americas"; return "europe"; }

// Progress helpers
function showIndeterminate(msg){ progressWrap.hidden=false; progressBar.classList.add('indeterminate'); progressBar.style.width='100%'; progressText.textContent=msg||'Working…'; }
function showDeterminate(msg,pct){ progressWrap.hidden=false; progressBar.classList.remove('indeterminate'); progressBar.style.width=`${Math.max(0,Math.min(100,pct))}%`; progressText.textContent=msg||''; }
function hideProgress(){ progressWrap.hidden=true; progressBar.classList.remove('indeterminate'); progressBar.style.width='0%'; progressText.textContent=''; }

// URL prefill & autorun
function prefillFromURL(){
  const u = new URL(location.href);
  const id = u.searchParams.get('id');
  const region = u.searchParams.get('region');
  if (region) regionSelect.value = region.toUpperCase();
  if (id && id.includes('#')) {
    riotIdInput.value = id;
    setTimeout(()=> form.dispatchEvent(new Event('submit', {cancelable:true})), 0);
  }
}

// ---- Search / Refresh ----
async function onSearch(e){
  e.preventDefault();
  const raw = riotIdInput.value.trim();
  if (!raw.includes("#")) { alert("Use Name#TAG"); return; }
  const [gameName, tagLine] = raw.split("#");
  await initDDragon();

  try{
    status("Looking up account…");
    const acc = await fetchJSON(api(`/account?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`));
    CURRENT.gameName = acc.gameName; CURRENT.tagLine = acc.tagLine; CURRENT.puuid = acc.puuid;
    CURRENT.region = mapRegionUItoRouting(regionSelect.value);

    const cached = loadCache(acc.puuid);
    if (cached?.matches?.length){
      Object.assign(CURRENT, { matches: cached.matches, ids: cached.ids||[], region: cached.region||CURRENT.region, lastUpdated: cached.updatedAt||null });
      populateChampionDatalist();
      renderAll();
      setLastUpdated(cached.updatedAt);
      status(""); hideProgress();
      return; // no auto-refresh: user clicks Update if quiser
    }

    // First time
    Object.assign(CURRENT, { matches: [], ids: [], lastUpdated: null });
    await refresh(true);
  } catch(err){ console.error(err); status(err.message || "Error"); hideProgress(); }
}

async function refresh(full){
  if (!CURRENT.puuid) return;
  try{
    // 1) IDs
    showIndeterminate("Fetching match IDs…");
    let allIds = [];
    let start = 0;
    for (;;) {
      progressText.textContent = `Fetching match IDs… ${start}–${start + PAGE_SIZE - 1}`;
      const ids = await fetchJSON(api(`/match-ids?puuid=${CURRENT.puuid}&region=${CURRENT.region}&queue=${ARENA_QUEUE}&start=${start}&count=${PAGE_SIZE}`));
      if (!ids.length) break;
      allIds.push(...ids);
      start += ids.length;
      if (ids.length < PAGE_SIZE) break;
      await new Promise(r=>setTimeout(r, IDS_PAGE_DELAY));
    }
    CURRENT.ids = allIds.slice();

    // 2) Details (new only)
    const known = new Set(CURRENT.matches.map(m=>m.matchId));
    const toFetch = allIds.filter(id=>!known.has(id));
    const total = toFetch.length;
    let fetched = 0;
    showDeterminate(`Fetching match details… 0 / ${total}`, 0);

    let collected = [];
    for (let i=0;i<toFetch.length;i+=CHUNK_SIZE){
      const slice = toFetch.slice(i, i+CHUNK_SIZE);
      const part = await fetchJSON(api(`/matches?ids=${slice.join(",")}&puuid=${CURRENT.puuid}&region=${CURRENT.region}`));
      collected = collected.concat(part);
      fetched += slice.length;
      const pct = total ? Math.round((100*fetched)/total) : 100;
      showDeterminate(`Fetching match details… ${Math.min(fetched,total)} / ${total}`, pct);
      renderHistory(dedupeById(CURRENT.matches.concat(collected)).sort((a,b)=>b.gameStart-a.gameStart));
    }

    // 3) Merge + cache + render
    CURRENT.matches = dedupeById(collected.concat(CURRENT.matches)).sort((a,b)=>b.gameStart-a.gameStart);

    const payload = { matches: CURRENT.matches, ids: CURRENT.ids, region: CURRENT.region, updatedAt: Date.now() };
    saveCache(CURRENT.puuid, payload);
    setLastUpdated(payload.updatedAt);

    populateChampionDatalist();
    renderAll();
    hideProgress();
    status("");
  } catch(err){
    console.error(err);
    status(err.message || "Refresh failed");
    hideProgress();
  }
}

function dedupeById(list){ const seen=new Set(); const out=[]; for (const m of list){ if(!m?.matchId||seen.has(m.matchId)) continue; seen.add(m.matchId); out.push(m);} return out; }

// ---- Renderers
function renderAll(){ renderKPIs(); renderSidebar(); renderHistory(); renderSynergy(); renderDuos(); }

function renderKPIs(){
  const list = CURRENT.matches;
  const places = list.map(m=>Number(m.placement)).filter(Number.isFinite);
  const avg = places.length ? (places.reduce((a,b)=>a+b,0)/places.length).toFixed(2) : "0.00";
  const wins = list.filter(m=>m.placement===1).length;
  const total = list.length;
  const champs = new Set(list.map(m=>m.championName)).size;
  kpisBox.innerHTML = [
    tile(`${CURRENT.gameName ? `${CURRENT.gameName}#${CURRENT.tagLine}` : "—"}`,"Player"),
    tile(`${total}`,"Games loaded"),
    tile(`${avg}`,"Average place"),
    tile(`${wins}`,"1st places"),
    tile(`${champs}`,"Champions played"),
  ].join("");
}

function renderSidebar(){
  const byChamp = groupBy(CURRENT.matches, m=>m.championName);
  const rows = Object.keys(byChamp)
    .filter(name => byChamp[name].some(m=>m.placement===1))
    .sort((a,b)=>a.localeCompare(b))
    .map(name=>`
      <div class="check" title="${name}">
        <img src="${champIcon(name)}" alt="${name}"><div class="tick">✓</div>
      </div>`).join("");
  winsChecklist.innerHTML = rows || `<div class="muted small">Get a 1st to start filling this up.</div>`;

  const progress = buildProgress(CURRENT.matches);
  const hardest = Object.values(progress)
    .filter(p=>p.completed)
    .sort((a,b)=>b.attemptsUntilFirst-a.attemptsUntilFirst)
    .slice(0,5);
  hardestList.innerHTML = hardest.length ? hardest.map(p=>
    `<span class="tag"><img src="${champIcon(p.name)}" width="16" height="16" style="border-radius:4px;border:1px solid var(--border)"> ${p.name} · ${p.attemptsUntilFirst}</span>`
  ).join("") : `<div class="muted small">No wins yet.</div>`;

  const counts = Array(8).fill(0);
  for (const m of CURRENT.matches){ const p=Number(m.placement); if (p>=1 && p<=8) counts[p-1]++; }
  if (placementsRange) placementsRange.textContent = `last ${CURRENT.matches.length} games`;
  if (placementsCanvas) drawPlacementBars(placementsCanvas, counts);
}

function renderHistory(forcedList){
  const listAll = (forcedList || CURRENT.matches).slice();
  let list = listAll;
  if (CURRENT.filter === "wins") list = listAll.filter(m=>m.placement===1);
  else if (CURRENT.filter === "neverwon") {
    const prog = buildProgress(CURRENT.matches);
    const lostSet = new Set(Object.values(prog).filter(p=>!p.completed).map(p=>p.name));
    list = listAll.filter(m=>lostSet.has(m.championName));
  }
  if (CURRENT.champQuery){
    const q = CURRENT.champQuery.toLowerCase();
    list = list.filter(m => (m.championName||"").toLowerCase().includes(q));
  }

  matchesBox.innerHTML = list.map(m=>{
    const p=Number(m.placement); const cls=p===1?"p1":p===2?"p2":p===3?"p3":"px";

    const allyIcon = m.allyChampionName ? `
      <div class="ally-chip" title="${m.allyChampionName}">
        <img src="${champIcon(m.allyChampionName)}" alt="${m.allyChampionName}">
      </div>` : "";

    // items (hide Arcane Sweeper if present)
    const ids = [m.item0,m.item1,m.item2,m.item3,m.item4,m.item5,m.item6]
      .filter(v => Number.isFinite(v) && v>0)
      .filter(id => !isArcaneSweeper(id));

    const items = ids.map(id =>
      `<img class="tip" data-tip="${esc(itemTip(id))}" src="${itemIcon(id)}" alt="${id}">`
    ).join("");

    const when = new Date(m.gameStart);
    const whenTip = when.toLocaleString();

    return `<article class="item" data-id="${m.matchId}" style="--splash:url('${splashUrl(m.championName)}')">
      <div class="icon">
        <img src="${champIcon(m.championName)}" alt="${m.championName}">
        ${allyIcon}
      </div>
      <div>
        <div class="head">
          <strong>${m.championName}</strong>
          <span class="badge ${cls}" title="Final placement">${ordinal(p)}</span>
        </div>
        <div class="small"><span class="kda">KDA ${m.kills}/${m.deaths}/${m.assists}</span> · <span class="tip" data-tip="${esc(whenTip)}">Played ${timeAgo(m.gameStart)}</span></div>
        <div class="items">${items || `<span class="muted small">No items</span>`}</div>
      </div>
    </article>`;
  }).join("");
}

function renderSynergy(){
  const agg = {};
  for (const m of CURRENT.matches){
    const ally = m.allyChampionName || "Unknown";
    const a = (agg[ally] ||= { ally, games:0, wins:0, sumPlace:0 });
    a.games++; a.wins += (m.placement===1 ? 1 : 0); a.sumPlace += Number(m.placement)||0;
  }
  const rows = Object.values(agg)
    .filter(x=>x.ally!=="Unknown")
    .map(x=>({ ...x, wr: x.games ? Math.round((100*x.wins)/x.games) : 0, avg: x.games ? (x.sumPlace/x.games).toFixed(2) : "—" }));

  if (bestDuoEl && commonDuoEl) {
    const enough = rows.filter(x => x.games >= 5);
    const best = enough.slice().sort((a,b)=> b.wr - a.wr || b.games - a.games)[0];
    const common = rows.slice().sort((a,b)=> b.games - a.games)[0];

    bestDuoEl.innerHTML = best
      ? `<img src="${champIcon(best.ally)}" alt="${best.ally}">${best.ally} • ${best.wr}% WR (${best.games} games)`
      : `<span class="muted">Not enough games yet</span>`;

    commonDuoEl.innerHTML = common
      ? `<img src="${champIcon(common.ally)}" alt="${common.ally}">${common.ally} • ${common.games} games`
      : `<span class="muted">No duo games yet</span>`;
  }

  synergyTableBody.innerHTML = rows.length
    ? rows.sort((a,b)=> b.wr - a.wr).map(x=>`
        <tr>
          <td class="row"><img src="${champIcon(x.ally)}" width="22" height="22" style="border-radius:6px;border:1px solid var(--border)"> ${x.ally}</td>
          <td>${x.games}</td><td>${x.wins}</td><td>${x.wr}%</td><td>${x.avg}</td>
        </tr>`).join("")
    : `<tr><td colspan="5" class="muted">Play with a duo to see stats.</td></tr>`;
}

// Best Duo Partners (by player; group by allyPuuid)
function renderDuos(){
  const agg = new Map();
  const nameMap = new Map();

  for (const m of CURRENT.matches){
    const pid = m.allyPuuid || null;
    const display = m.allyName || "Unknown";
    if (pid) nameMap.set(pid, display);

    const key = pid || `name:${display}`;
    const a = agg.get(key) || { games:0, wins:0, sumPlace:0, puuid: pid, display };
    a.games++; a.wins += (m.placement===1 ? 1 : 0); a.sumPlace += Number(m.placement)||0;
    agg.set(key, a);
  }

  const rows = [...agg.values()].map(s => {
    const name = s.puuid ? (nameMap.get(s.puuid) || s.display || "Unknown") : s.display;
    const wr = s.games ? Math.round((100*s.wins)/s.games) : 0;
    const avg = s.games ? (s.sumPlace/s.games).toFixed(2) : "—";
    return { name, games: s.games, wins: s.wins, wr, avg };
  }).sort((a,b)=> b.games - a.games);

  duoTableBody.innerHTML = rows.length
    ? rows.map(x => `
        <tr>
          <td>${x.name}</td>
          <td>${x.games}</td>
          <td>${x.wins}</td>
          <td>${x.wr}%</td>
          <td>${x.avg}</td>
        </tr>`).join("")
    : `<tr><td colspan="5" class="muted">No duo partners found.</td></tr>`;
}

// ---- Utils
function buildProgress(matches){
  const byChamp = groupBy(matches, m=>m.championName);
  const out = {};
  for (const [name, list] of Object.entries(byChamp)){
    const asc = list.slice().sort((a,b)=>a.gameStart-b.gameStart);
    const firstIndex = asc.findIndex(x=>x.placement===1);
    const completed = firstIndex !== -1;
    const attemptsUntilFirst = completed ? firstIndex+1 : asc.length;
    const when = completed ? asc[firstIndex].gameStart : null;
    out[name] = { name, completed, attemptsUntilFirst, attemptsSoFar: asc.length, when };
  }
  return out;
}

function populateChampionDatalist(){
  const set = new Set(CURRENT.matches.map(m=>m.championName).filter(Boolean));
  const opts = [...set].sort((a,b)=>a.localeCompare(b)).map(c=>`<option value="${c}">`).join("");
  champDatalist.innerHTML = opts;
}

function groupBy(list, fn){ const map={}; for(const x of list){ const k=fn(x); (map[k] ||= []).push(x); } return map; }
function tile(big,label){ return `<div class="tile"><div class="big">${big}</div><div class="label muted">${label}</div></div>`; }

/* Placement chart */
function drawPlacementBars(canvas, counts){
  const ctx = canvas.getContext("2d"); if(!ctx) return;
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);

  ctx.strokeStyle = "#2a3340"; ctx.lineWidth = 1;
  const max = Math.max(1, ...counts);
  const top = Math.ceil(max / 2) * 2;
  const step = Math.max(1, Math.floor(top/5));
  for (let y=0; y<=top; y+=step){
    const yy = H - 20 - (H-40) * (y/top);
    ctx.beginPath(); ctx.moveTo(40, yy); ctx.lineTo(W-10, yy); ctx.stroke();
    ctx.fillStyle = "#7f8c8d"; ctx.font="12px system-ui"; ctx.fillText(String(y), 10, yy+4);
  }

  const colors = ["#ffd95e","#6eb4ff","#ffb26b","#b9c2cc","#b9c2cc","#b9c2cc","#b9c2cc","#b9c2cc"];
  const n = counts.length;
  const slotW = (W-60)/n;
  const bw = slotW * 0.7;

  for (let i=0;i<n;i++){
    const x = 40 + i*slotW + (slotW-bw)/2;
    const h = (H-40) * (counts[i]/top);
    const y = H - 20 - h;

    ctx.fillStyle = colors[i];
    ctx.fillRect(x, y, bw, h);

    ctx.fillStyle = "#cfd9df";
    ctx.font = "bold 14px system-ui";
    const label = String(counts[i]);
    const tw = ctx.measureText(label).width;
    ctx.fillText(label, x + bw/2 - tw/2, y - 4);
    ctx.fillText(`${i+1}${["st","nd","rd"][i]||"th"}`, x + bw/2 - 12, H - 4);
  }
}

// kick off
prefillFromURL();

// Arena.gg — cache-first search, só faz fetch no "Update" ou se não houver cache
console.log("app.js boot OK (v17 cache-first)");

// ===== Config =====
const API_BASE = "https://arenaproxy.irenasthat.workers.dev";
const ARENA_QUEUE = 1700;
const PAGE_SIZE = 100;
const CHUNK_SIZE = 10;
const IDS_PAGE_DELAY = 200;
const CACHE_VERSION = "v17";

// ===== DOM =====
const form = document.getElementById("search-form");
const btnSearch = document.getElementById("btn-search");
const riotIdInput = document.getElementById("riotid");
const regionSelect = document.getElementById("region-select");
const btnUpdate = document.getElementById("btn-update");
const btnPin = document.getElementById("btn-pin");

// TABS
const tabsNav = document.getElementById("tabs");
const tabViews = {
  matches: document.getElementById("tab-matches"),
  synergy: document.getElementById("tab-synergy"),
  duos: document.getElementById("tab-duos"),
};

const mainLayout = document.getElementById("main-layout");
const kpisBox = document.getElementById("kpis");
const matchesBox = document.getElementById("matches");
const champInput = document.getElementById("champ-input");
const champClear = document.getElementById("champ-clear");
const champDatalist = document.getElementById("champ-datalist");
const winsChecklist = document.getElementById("wins-checklist");
const hardestList = document.getElementById("hardest-list");
const placementsCanvas = document.getElementById("placements-canvas");
const placementsRange = document.getElementById("placements-range");
const lastUpdatedEl = document.getElementById("last-updated");

const filtersEl = document.querySelector("#tab-matches .filters");
const synergyTableBody = document.querySelector("#synergy-table tbody");
const duoTableBody = document.querySelector("#duo-table tbody");
const bestDuoEl = document.getElementById("best-duo")?.querySelector(".duo-value");
const commonDuoEl = document.getElementById("common-duo")?.querySelector(".duo-value");

// Quicklists
const pinsList = document.getElementById("pins-list");
const recentsList = document.getElementById("recents-list");

// Progress + status
const progressWrap = document.getElementById("progress-wrap");
const progressBar  = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const statusBox = createStatus("Ready.");

// ===== State =====
let DD_VERSION = "15.16.1";
const NAME_FIX = { FiddleSticks:"Fiddlesticks", Wukong:"MonkeyKing", KhaZix:"Khazix", VelKoz:"Velkoz", ChoGath:"Chogath", KaiSa:"Kaisa", LeBlanc:"LeBlanc", DrMundo:"DrMundo", Nunu:"Nunu", Renata:"Renata", RekSai:"RekSai", KogMaw:"KogMaw", BelVeth:"BelVeth", TahmKench:"TahmKench" };

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

// ===== Utils =====
function api(pathAndQuery){
  const base = API_BASE.replace(/\/+$/, "");
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  return `${base}${path}`;
}
function parseRiotId(raw){
  const s = String(raw||"").trim();
  const m = s.match(/^\s*(.+?)\s*(?:#|\s+)\s*([A-Za-z0-9]{2,5})\s*$/);
  if (!m) return null;
  return { gameName: m[1], tagLine: m[2] };
}
function safeRegionUI(){ const v = regionSelect?.value || "EUW"; return String(v).toUpperCase(); }
function mapRegionUItoRouting(ui){ if ((ui||"").toLowerCase()==="na") return "americas"; return "europe"; }
function champIcon(name){ const fixed = NAME_FIX[name] || name; return `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/champion/${encodeURIComponent(fixed)}.png`; }
function ordinal(n){ if(n===1) return "1st"; if(n===2) return "2nd"; if(n===3) return "3rd"; if(!Number.isFinite(n)) return "?"; return `${n}th`; }
function timeAgo(ts){ if(!ts) return "unknown"; const s=Math.max(1,Math.floor((Date.now()-Number(ts))/1000)); const m=Math.floor(s/60); if(m<60) return `${m}m ago`; const h=Math.floor(m/60); if(h<48) return `${h}h ago`; const d=Math.floor(h/24); return `${d}d ago`; }
function createStatus(txt){ const el=document.createElement("div"); el.id="status"; el.className="container muted"; el.textContent = txt||""; document.body.prepend(el); return el; }
function status(t){ if(statusBox) statusBox.textContent = t||""; }
function setLastUpdated(ts){ if(lastUpdatedEl) lastUpdatedEl.textContent = ts ? `Last updated, ${new Date(ts).toLocaleString()}` : ""; }
function setMainVisible(v){ if (mainLayout) mainLayout.hidden = !v; }

async function fetchJSON(url, tries=3, delay=600){
  const r = await fetch(url);
  if (r.ok) return r.json();
  const txt = await r.text().catch(()=> "");
  const is429 = r.status===429 || /Riot 429/i.test(txt);
  if (is429 && tries>0){ await new Promise(r=>setTimeout(r, delay)); return fetchJSON(url, tries-1, delay*2); }
  throw new Error(`Request failed, ${r.status}${txt?`, ${txt}`:""}`);
}
async function initDDragon(){
  try { const r = await fetch("https://ddragon.leagueoflegends.com/api/versions.json"); if (r.ok){ const arr = await r.json(); if (arr?.[0]) DD_VERSION = arr[0]; } } catch {}
}

// ===== Progress UI =====
function showIndeterminate(msg){ if(!progressWrap||!progressBar||!progressText) return; progressWrap.hidden=false; progressBar.classList.add('indeterminate'); progressBar.style.width='100%'; progressText.textContent=msg||'Working…'; }
function showDeterminate(msg,pct){ if(!progressWrap||!progressBar||!progressText) return; progressWrap.hidden=false; progressBar.classList.remove('indeterminate'); progressBar.style.width=`${Math.max(0,Math.min(100,pct))}%`; progressText.textContent=msg||''; }
function hideProgress(){ if(!progressWrap||!progressBar||!progressText) return; progressWrap.hidden=true; progressBar.classList.remove('indeterminate'); progressBar.style.width='0%'; progressText.textContent=''; }

// ===== Pins/Recents =====
const PIN_KEY = "arena_pins_v1";
const RECENT_KEY = "arena_recents_v1";
function loadPins(){ try{ return JSON.parse(localStorage.getItem(PIN_KEY)||"[]"); }catch{ return []; } }
function savePins(arr){ try{ localStorage.setItem(PIN_KEY, JSON.stringify(arr)); }catch{} }
function loadRecents(){ try{ return JSON.parse(localStorage.getItem(RECENT_KEY)||"[]"); }catch{ return []; } }
function saveRecents(arr){ try{ localStorage.setItem(RECENT_KEY, JSON.stringify(arr)); }catch{} }
function currentNameTag(){ return (CURRENT.gameName && CURRENT.tagLine) ? `${CURRENT.gameName}#${CURRENT.tagLine}` : null; }
function isPinned(nameTag, regionUI){ return loadPins().some(p => p.id===nameTag && p.regionUI===regionUI); }
function onTogglePin(){
  const id = currentNameTag(); if (!id) return;
  const reg = safeRegionUI();
  const pins = loadPins();
  const idx = pins.findIndex(p => p.id===id && p.regionUI===reg);
  if (idx !== -1) pins.splice(idx,1); else pins.unshift({ id, regionUI: reg, ts: Date.now() });
  savePins(pins.slice(0,8));
  updatePinButton(); renderQuicklists();
}
function updatePinButton(){
  if (!btnPin) return;
  const id = currentNameTag();
  if (!id){ btnPin.disabled = true; btnPin.textContent = "☆ Pin"; return; }
  btnPin.disabled = false;
  const pinned = isPinned(id, safeRegionUI());
  btnPin.textContent = pinned ? "★ Unpin" : "☆ Pin";
  btnPin.title = pinned ? "Unpin this profile" : "Pin this profile";
}
function pushRecent(nameTag, regionUI){
  if (!nameTag) return;
  const arr = loadRecents().filter(x => !(x.id===nameTag && x.regionUI===regionUI));
  arr.unshift({ id:nameTag, regionUI, ts: Date.now() });
  saveRecents(arr.slice(0,8));
}
function renderQuicklists(){
  if (pinsList) {
    const pins = loadPins();
    pinsList.innerHTML = pins.length ? pins.map(x=>{
      const url = new URL("./app.html", location.href);
      url.searchParams.set("id", x.id); url.searchParams.set("region", x.regionUI);
      return `<a href="${url.toString()}" class="link-chip" title="${x.id} (${x.regionUI})">${x.id}</a>`;
    }).join("") : `<div class="muted small">Sem fixos</div>`;
  }
  if (recentsList) {
    const recs = loadRecents();
    recentsList.innerHTML = recs.length ? recs.map(x=>{
      const url = new URL("./app.html", location.href);
      url.searchParams.set("id", x.id); url.searchParams.set("region", x.regionUI);
      return `<a href="${url.toString()}" class="link-chip" title="${x.id} (${x.regionUI})">${x.id}</a>`;
    }).join("") : `<div class="muted small">Sem recentes</div>`;
  }
}

// ===== Cache =====
function loadCache(puuid){ try { return JSON.parse(localStorage.getItem(cacheKey(puuid))||"null"); } catch { return null; } }
function saveCache(puuid, payload){ try { localStorage.setItem(cacheKey(puuid), JSON.stringify(payload)); } catch {} }

// ===== Prefill =====
function prefillFromURL(){
  const u = new URL(location.href);
  const id = u.searchParams.get('id');
  const region = u.searchParams.get('region');
  if (region && regionSelect) regionSelect.value = region.toUpperCase();
  if (id && riotIdInput && id.includes('#')) {
    riotIdInput.value = id;
    setTimeout(()=> startSearch(new Event('submit')), 0);
  }
  renderQuicklists();
}
prefillFromURL();

// ===== Tabs =====
if (tabsNav) {
  tabsNav.addEventListener("click", (e)=>{
    const btn = e.target.closest("button"); if (!btn) return;
    const key = btn.dataset.tab;
    [...tabsNav.querySelectorAll("button")].forEach(b=>{
      const active = b === btn;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
    Object.entries(tabViews).forEach(([k, el])=>{
      if (!el) return;
      el.classList.toggle("active", k === key);
    });
  });
}

// ===== Listeners =====
if (form) form.addEventListener("submit", onSearch, { capture: true });
if (btnSearch) btnSearch.addEventListener("click", (e)=>{ e.preventDefault(); onSearch(e); });
if (btnUpdate) btnUpdate.addEventListener("click", () => refresh(true));
if (btnPin) btnPin.addEventListener("click", onTogglePin);

if (filtersEl) {
  filtersEl.addEventListener("click", (e)=>{
    const btn = e.target.closest("button"); if (!btn) return;
    [...filtersEl.children].forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    CURRENT.filter = btn.dataset.filter;
    renderHistory();
  });
}
if (champInput) champInput.addEventListener("input", ()=>{ CURRENT.champQuery = (champInput.value || "").trim(); renderHistory(); });
if (champClear) champClear.addEventListener("click", ()=>{ if (champInput) champInput.value=""; CURRENT.champQuery=""; renderHistory(); });

// History → match.html
if (matchesBox) {
  matchesBox.addEventListener("click", (e)=>{
    const card = e.target.closest(".item"); if (!card) return;
    const id = card.dataset.id;
    const base = new URL(location.href.replace(/[^/]*$/, ""));
    const url = new URL("match.html", base);
    url.searchParams.set("id", id);
    url.searchParams.set("puuid", CURRENT.puuid || "");
    url.searchParams.set("region", CURRENT.region || "");
    location.href = url.toString();
  });
}

// ===== Expor fallback global p/ HTML inline =====
window.startSearch = function startSearch(e){
  try { if (e && e.preventDefault) { e.preventDefault(); e.stopPropagation?.(); e.stopImmediatePropagation?.(); } } catch {}
  onSearch(e);
  return false;
};

// ===== Search / Refresh =====
async function onSearch(e){
  if (e){ e.preventDefault?.(); e.stopPropagation?.(); e.stopImmediatePropagation?.(); }

  const raw = riotIdInput?.value ?? "";
  const parsed = parseRiotId(raw);
  if (!parsed){ alert('Usa "Name#TAG" ou "Name TAG"'); return; }

  await initDDragon();

  try{
    status("Looking up account…");
    showIndeterminate("Looking up account…"); setMainVisible(false);

    // 1) Resolve conta (barato)
    const acc = await fetchJSON(api(`/account?gameName=${encodeURIComponent(parsed.gameName)}&tagLine=${encodeURIComponent(parsed.tagLine)}`));
    const regionRouting = mapRegionUItoRouting(safeRegionUI());

    // 2) Tentar cache local (cache-first; sem fetch de jogos)
    const cached = loadCache(acc.puuid);
    if (cached?.matches?.length){
      Object.assign(CURRENT, {
        gameName: acc.gameName, tagLine: acc.tagLine, puuid: acc.puuid,
        matches: cached.matches, ids: cached.ids||[], region: cached.region || regionRouting,
        lastUpdated: cached.updatedAt || null,
      });

      populateChampionDatalist();
      renderAll();
      setLastUpdated(cached.updatedAt);
      hideProgress(); setMainVisible(true);
      status("Loaded from device cache. Click Update to refresh.");
      pushRecent(`${acc.gameName}#${acc.tagLine}`, safeRegionUI());
      renderQuicklists(); updatePinButton();
      return; // ← NÃO faz refresh automaticamente
    }

    // 3) Sem cache → fetch normal
    Object.assign(CURRENT, {
      gameName: acc.gameName, tagLine: acc.tagLine, puuid: acc.puuid,
      matches: [], ids: [], lastUpdated: null, region: regionRouting,
    });
    pushRecent(`${acc.gameName}#${acc.tagLine}`, safeRegionUI());
    renderQuicklists(); updatePinButton();

    await refresh(true);
  } catch(err){
    console.error(err);
    alert(`Erro ao procurar conta: ${err.message||err}`);
    status(err.message || "Error"); hideProgress(); setMainVisible(false);
  }
}

async function refresh(){
  if (!CURRENT.puuid) return;
  try{
    showIndeterminate("Fetching match IDs…");
    let allIds = [];
    let start = 0;
    for (;;) {
      progressText && (progressText.textContent = `Fetching match IDs… ${start}–${start + PAGE_SIZE - 1}`);
      const ids = await fetchJSON(api(`/match-ids?puuid=${CURRENT.puuid}&region=${CURRENT.region}&queue=${ARENA_QUEUE}&start=${start}&count=${PAGE_SIZE}`));
      if (!ids.length) break;
      allIds.push(...ids);
      start += ids.length;
      if (ids.length < PAGE_SIZE) break;
      await new Promise(r=>setTimeout(r, IDS_PAGE_DELAY));
    }
    CURRENT.ids = allIds.slice();

    const total = allIds.length;
    let fetched = 0;
    showDeterminate(`Fetching match details… 0 / ${total}`, 0);

    let collected = [];
    for (let i=0;i<allIds.length;i+=CHUNK_SIZE){
      const slice = allIds.slice(i, i+CHUNK_SIZE);
      const part = await fetchJSON(api(`/matches?ids=${slice.join(",")}&puuid=${CURRENT.puuid}&region=${CURRENT.region}`));
      collected = collected.concat(part);
      fetched += slice.length;
      const pct = total ? Math.round((100*fetched)/total) : 100;
      showDeterminate(`Fetching match details… ${Math.min(fetched,total)} / ${total}`, pct);
    }

    CURRENT.matches = dedupeById(collected).sort((a,b)=>b.gameStart-a.gameStart);
    const payload = { matches: CURRENT.matches, ids: CURRENT.ids, region: CURRENT.region, updatedAt: Date.now() };
    saveCache(CURRENT.puuid, payload); setLastUpdated(payload.updatedAt);

    populateChampionDatalist(); renderAll();
    hideProgress(); status(""); setMainVisible(true);
  } catch(err){
    console.error(err);
    alert(`Erro a carregar partidas: ${err.message||err}`);
    status(err.message || "Refresh failed"); hideProgress(); setMainVisible(false);
  }
}

function dedupeById(list){ const seen=new Set(); const out=[]; for (const m of list){ if(!m?.matchId||seen.has(m.matchId)) continue; seen.add(m.matchId); out.push(m);} return out; }

// ===== Render =====
function renderAll(){ renderKPIs(); renderSidebar(); renderHistory(); renderSynergy(); renderDuos(); updatePinButton(); }

function renderKPIs(){
  if (!kpisBox) return;
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
  if (!winsChecklist || !hardestList || !placementsCanvas) return;

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

function renderHistory(){
  if (!matchesBox) return;
  const listAll = CURRENT.matches.slice();
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
    const ally = m.allyChampionName ? ` · with ${m.allyChampionName}` : "";
    return `<article class="item" data-id="${m.matchId}">
      <div class="icon"><img src="${champIcon(m.championName)}" alt="${m.championName}"></div>
      <div>
        <div class="head"><strong>${m.championName}${ally}</strong><span class="badge ${cls}">${ordinal(p)}</span></div>
        <div class="small">KDA, ${m.kills}/${m.deaths}/${m.assists}</div>
        <div class="small">Played, ${timeAgo(m.gameStart)}</div>
      </div>
    </article>`;
  }).join("");
}

function renderSynergy(){
  if (!synergyTableBody || !bestDuoEl || !commonDuoEl) return;
  const agg = {};
  for (const m of CURRENT.matches){
    const ally = m.allyChampionName || "Unknown";
    const a = (agg[ally] ||= { ally, games:0, wins:0, sumPlace:0 });
    a.games++; a.wins += (m.placement===1 ? 1 : 0); a.sumPlace += Number(m.placement)||0;
  }
  const rows = Object.values(agg)
    .filter(x=>x.ally!=="Unknown")
    .map(x=>({ ...x, wr: x.games ? Math.round((100*x.wins)/x.games) : 0, avg: x.games ? (x.sumPlace/x.games).toFixed(2) : "—" }));

  const enough = rows.filter(x => x.games >= 5);
  const best = enough.slice().sort((a,b)=> b.wr - a.wr || b.games - a.games)[0];
  const common = rows.slice().sort((a,b)=> b.games - a.games)[0];

  bestDuoEl.innerHTML = best
    ? `<img src="${champIcon(best.ally)}" alt="${best.ally}">${best.ally} • ${best.wr}% WR (${best.games} games)`
    : `<span class="muted">Not enough games yet</span>`;

  commonDuoEl.innerHTML = common
    ? `<img src="${champIcon(common.ally)}" alt="${common.ally}">${common.ally} • ${common.games} games`
    : `<span class="muted">No duo games yet</span>`;

  synergyTableBody.innerHTML = rows.length
    ? rows.sort((a,b)=> b.wr - a.wr).map(x=>`
        <tr>
          <td class="row"><img src="${champIcon(x.ally)}" width="22" height="22" style="border-radius:6px;border:1px solid var(--border)"> ${x.ally}</td>
          <td>${x.games}</td><td>${x.wins}</td><td>${x.wr}%</td><td>${x.avg}</td>
        </tr>`).join("")
    : `<tr><td colspan="5" class="muted">Play with a duo to see stats.</td></tr>`;
}

function renderDuos(){
  if (!duoTableBody) return;
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

// ===== Helpers =====
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
  if (!champDatalist) return;
  const set = new Set(CURRENT.matches.map(m=>m.championName).filter(Boolean));
  const opts = [...set].sort((a,b)=>a.localeCompare(b)).map(c=>`<option value="${c}">`).join("");
  champDatalist.innerHTML = opts;
}
function groupBy(list, fn){ const map={}; for(const x of list){ const k=fn(x); (map[k] ||= []).push(x); } return map; }
function tile(big,label){ return `<div class="tile"><div class="big">${big}</div><div class="label muted">${label}</div></div>`; }
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
    ctx.fillStyle = colors[i]; ctx.fillRect(x, y, bw, h);
    ctx.fillStyle = "#cfd9df"; ctx.font = "bold 14px system-ui";
    ctx.fillText(String(counts[i]), x + bw/2 - 4, y - 4);
    ctx.fillText(`${i+1}${["st","nd","rd"][i]||"th"}`, x + bw/2 - 10, H - 4);
  }
}

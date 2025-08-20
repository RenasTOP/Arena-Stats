// Arena.gg frontend (tabs + search + paging + sidebar + synergy + tierlist)
const API_BASE = "https://arenaproxy.irenasthat.workers.dev"; // no trailing slash
const ARENA_QUEUE = 1700;

const CHUNK_SIZE = 10;
const CHUNK_DELAY_MS = 700;
const PAGE_SIZE = 100;

function api(pathAndQuery){
  const base = API_BASE.replace(/\/+$/, "");
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  return `${base}${path}`;
}

// ---- DOM ----
const tabs = document.getElementById("tabs");
const tabViews = {
  overview: document.getElementById("tab-overview"),
  history:  document.getElementById("tab-history"),
  synergy:  document.getElementById("tab-synergy"),
  tierlist: document.getElementById("tab-tierlist"),
};
const form = document.getElementById("search-form");
const riotIdInput = document.getElementById("riotid");
const btnUpdate = document.getElementById("btn-update");
const kpisBox = document.getElementById("kpis");
const matchesBox = document.getElementById("matches");
const btnMore = document.getElementById("btn-more");
const winsChecklist = document.getElementById("wins-checklist");
const hardestList = document.getElementById("hardest-list");
const placementsCanvas = document.getElementById("placements-canvas");
const rollingCanvas = document.getElementById("rolling-canvas");
const lastUpdatedEl = document.getElementById("last-updated");
const filters = document.querySelector("#tab-history .filters");
const synergyTableBody = document.querySelector("#synergy-table tbody");
const statusBox = createStatus();

// ---- State ----
let DD_VERSION = "15.16.1";
const NAME_FIX = { FiddleSticks:"Fiddlesticks", Wukong:"MonkeyKing", KhaZix:"Khazix", VelKoz:"Velkoz", ChoGath:"Chogath", KaiSa:"Kaisa", LeBlanc:"Leblanc", DrMundo:"DrMundo", Nunu:"Nunu", Renata:"Renata", RekSai:"RekSai", KogMaw:"KogMaw", BelVeth:"Belveth", TahmKench:"TahmKench" };

let CURRENT = {
  gameName: "", tagLine: "",
  puuid: null, region: null,
  matches: [],
  ids: [],
  nextStart: 0,
  filter: "all",
  lastUpdated: null,
};
const cacheKey = (puuid)=>`arena_cache_v1:${puuid}`;

// ---- Tabs & filters ----
tabs.addEventListener("click", (e)=>{
  const btn = e.target.closest("button"); if (!btn) return;
  [...tabs.children].forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  const key = btn.dataset.tab;
  for (const [k, el] of Object.entries(tabViews)) el.classList.toggle("active", k===key);
});
filters.addEventListener("click", (e)=>{
  const btn = e.target.closest("button"); if (!btn) return;
  [...filters.children].forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  CURRENT.filter = btn.dataset.filter;
  renderHistory();
});

// ---- Actions ----
btnMore.addEventListener("click", () => loadMore());
form.addEventListener("submit", onSearch);
btnUpdate.addEventListener("click", () => refresh(true));

matchesBox.addEventListener("click", (e)=>{
  const card = e.target.closest(".item");
  if (!card) return;
  const id = card.dataset.id;
  // build URL relative to current directory (works on GitHub Pages subfolder)
  const base = new URL(location.href.replace(/[^/]*$/, ""));
  const url = new URL("match.html", base);
  url.searchParams.set("id", id);
  url.searchParams.set("puuid", CURRENT.puuid || "");
  url.searchParams.set("region", CURRENT.region || "");
  location.href = url.toString();
});

// ---- Helpers ----
function champIcon(name){ const fixed = NAME_FIX[name] || name; return `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/champion/${encodeURIComponent(fixed)}.png`; }
function ordinal(n){ if(n===1) return "1st"; if(n===2) return "2nd"; if(n===3) return "3rd"; if(!Number.isFinite(n)) return "?"; return `${n}th`; }
function timeAgo(ts){ if(!ts) return "unknown"; const s=Math.max(1,Math.floor((Date.now()-Number(ts))/1000)); const m=Math.floor(s/60); if(m<60) return `${m}m ago`; const h=Math.floor(m/60); if(h<48) return `${h}h ago`; const d=Math.floor(h/24); return `${d}d ago`; }
function status(t){ statusBox.textContent = t||""; }
function setLastUpdated(ts){ lastUpdatedEl.textContent = ts ? `Last updated, ${new Date(ts).toLocaleString()}` : ""; }

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
function loadCache(puuid){ try { return JSON.parse(localStorage.getItem(cacheKey(puuid))||"null"); } catch { return null; } }
function saveCache(puuid, payload){ try { localStorage.setItem(cacheKey(puuid), JSON.stringify(payload)); } catch {} }
function createStatus(){ const el=document.createElement("div"); el.id="status"; el.className="container muted"; document.body.prepend(el); return el; }

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

    const cached = loadCache(acc.puuid);
    if (cached?.matches?.length){
      Object.assign(CURRENT, { matches: cached.matches, ids: cached.ids||[], nextStart: cached.nextStart||0, region: cached.region||null, lastUpdated: cached.updatedAt||null });
      renderAll(); setLastUpdated(cached.updatedAt); status("Refreshing…");
    } else {
      Object.assign(CURRENT, { matches: [], ids: [], nextStart: 0, region: null, lastUpdated: null });
    }

    const reg = await fetchJSON(api(`/region?puuid=${encodeURIComponent(CURRENT.puuid)}`));
    CURRENT.region = reg.region;

    await refresh(true);
  } catch(err){ console.error(err); status(err.message || "Error"); }
}

async function refresh(full){
  if (!CURRENT.puuid) return;
  try{
    status("Fetching match ids…");
    const ids0 = await fetchJSON(api(`/match-ids?puuid=${CURRENT.puuid}&region=${CURRENT.region}&queue=${ARENA_QUEUE}&start=0&count=${PAGE_SIZE}`));
    if (full){ CURRENT.ids = ids0.slice(); CURRENT.nextStart = PAGE_SIZE; }

    const known = new Set(CURRENT.matches.map(m=>m.matchId));
    const toFetch = ids0.filter(id=>!known.has(id));
    const newRows = await fetchMatchesInChunks(toFetch, CURRENT.puuid, CURRENT.region);

    CURRENT.matches = dedupeById(newRows.concat(CURRENT.matches)).sort((a,b)=>b.gameStart-a.gameStart);

    const payload = { matches: CURRENT.matches, ids: CURRENT.ids, nextStart: CURRENT.nextStart, region: CURRENT.region, updatedAt: Date.now() };
    saveCache(CURRENT.puuid, payload); setLastUpdated(payload.updatedAt);

    renderAll(); status("");
  } catch(err){ console.error(err); status(err.message || "Refresh failed"); }
}

async function loadMore(){
  try{
    status(`Loading ids ${CURRENT.nextStart}…`);
    const ids = await fetchJSON(api(`/match-ids?puuid=${CURRENT.puuid}&region=${CURRENT.region}&queue=${ARENA_QUEUE}&start=${CURRENT.nextStart}&count=${PAGE_SIZE}`));
    if (!ids.length){ status("No more games."); return; }
    CURRENT.nextStart += ids.length; CURRENT.ids.push(...ids);

    const known = new Set(CURRENT.matches.map(m=>m.matchId));
    const toFetch = ids.filter(id=>!known.has(id));
    const newRows = await fetchMatchesInChunks(toFetch, CURRENT.puuid, CURRENT.region);
    CURRENT.matches = dedupeById(CURRENT.matches.concat(newRows)).sort((a,b)=>b.gameStart-a.gameStart);

    saveCache(CURRENT.puuid, { matches: CURRENT.matches, ids: CURRENT.ids, nextStart: CURRENT.nextStart, region: CURRENT.region, updatedAt: Date.now() });

    renderAll(); status("");
  } catch(err){ console.error(err); status(err.message || "Load failed"); }
}

async function fetchMatchesInChunks(ids, puuid, region){
  let collected = [];
  for (let i=0;i<ids.length;i+=CHUNK_SIZE){
    const slice = ids.slice(i, i+CHUNK_SIZE);
    status(`Fetching match details ${Math.min(i+CHUNK_SIZE, ids.length)}/${ids.length}`);
    const part = await fetchJSON(api(`/matches?ids=${slice.join(",")}&puuid=${puuid}&region=${region}`));
    collected = collected.concat(part);
    renderHistory(dedupeById(CURRENT.matches.concat(collected)).sort((a,b)=>b.gameStart-a.gameStart));
    if (i + CHUNK_SIZE < ids.length) await new Promise(r=>setTimeout(r, CHUNK_DELAY_MS));
  }
  return collected;
}

function dedupeById(list){ const seen=new Set(); const out=[]; for (const m of list){ if(!m?.matchId||seen.has(m.matchId)) continue; seen.add(m.matchId); out.push(m);} return out; }

// ---- Render ----
function renderAll(){ renderKPIs(); renderSidebar(); renderHistory(); renderSynergy(); renderTierlistOnce(); }
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
  drawRolling(rollingCanvas, places);
}
function renderSidebar(){
  const byChamp = groupBy(CURRENT.matches, m=>m.championName);
  const rows = Object.keys(byChamp).sort((a,b)=>a.localeCompare(b)).map(name=>{
    const got = byChamp[name].some(m=>m.placement===1);
    return `<div class="check" title="${name}">
      <img src="${champIcon(name)}" alt="${name}">
      ${got ? `<div class="tick">✓</div>` : ""}
    </div>`;
  }).join("");
  winsChecklist.innerHTML = rows || `<div class="muted small">Play some games to see this fill up.</div>`;

  const progress = buildProgress(CURRENT.matches);
  const hardest = Object.values(progress).filter(p=>p.completed).sort((a,b)=>b.attemptsUntilFirst-a.attemptsUntilFirst).slice(0,5);
  hardestList.innerHTML = hardest.length ? hardest.map(p=>
    `<span class="tag"><img src="${champIcon(p.name)}" width="16" height="16" style="border-radius:4px;border:1px solid var(--border)"> ${p.name} · ${p.attemptsUntilFirst}</span>`
  ).join("") : `<div class="muted small">No 1sts yet.</div>`;

  const counts = Array(8).fill(0);
  for (const m of CURRENT.matches){ const p=Number(m.placement); if (p>=1 && p<=8) counts[p-1]++; }
  drawPlacementBars(placementsCanvas, counts);
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

  btnMore.parentElement.style.display = "block";
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
    .sort((a,b)=> (b.wins/b.games) - (a.wins/a.games))
    .map(x=>{
      const wr = x.games ? Math.round((100*x.wins)/x.games) : 0;
      const avg = x.games ? (x.sumPlace/x.games).toFixed(2) : "—";
      return `<tr>
        <td class="row"><img src="${champIcon(x.ally)}" width="22" height="22" style="border-radius:6px;border:1px solid var(--border)"> ${x.ally}</td>
        <td>${x.games}</td><td>${x.wins}</td><td>${wr}%</td><td>${avg}</td>
      </tr>`;
    }).join("");
  synergyTableBody.innerHTML = rows || `<tr><td colspan="5" class="muted">Play with a duo to see stats.</td></tr>`;
}

// ---- Progress, Charts, Utils ----
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
function groupBy(list, fn){ const map={}; for(const x of list){ const k=fn(x); (map[k] ||= []).push(x); } return map; }
function tile(big,label){ return `<div class="tile"><div class="big">${big}</div><div class="label muted">${label}</div></div>`; }

function drawPlacementBars(canvas, counts){
  const ctx = canvas.getContext("2d");
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle="#2a3340"; ctx.lineWidth=1;
  const max=Math.max(1,...counts), top=Math.ceil(max/2)*2;
  for(let y=0;y<=top;y+=Math.max(1,Math.floor(top/5))){
    const yy = H-20 - (H-40)*(y/top);
    ctx.beginPath(); ctx.moveTo(40,yy); ctx.lineTo(W-10,yy); ctx.stroke();
    ctx.fillStyle="#7f8c8d"; ctx.font="12px system-ui"; ctx.fillText(String(y),10,yy+4);
  }
  const colors=["#f4d03f","#e056fd","#74b9ff","#2ecc71","#bdc3c7","#bdc3c7","#bdc3c7","#bdc3c7"];
  const n=counts.length, bw=(W-60)/n*0.7;
  for(let i=0;i<n;i++){
    const x=40 + i*((W-60)/n) + ((W-60)/n - bw)/2;
    const h=(H-40)*(counts[i]/top), y=H-20-h;
    ctx.fillStyle=colors[i]; ctx.fillRect(x,y,bw,h);
    ctx.fillStyle="#cfd9df"; ctx.font="bold 14px system-ui"; ctx.fillText(String(counts[i]), x+bw/2-4, y-4);
    const lbl = `${i+1}${["st","nd","rd"][i]||"th"}`; ctx.fillText(lbl, x+bw/2-10, H-4);
  }
}
function drawRolling(canvas, placements){
  const ctx=canvas.getContext("2d"); const W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H); if(!placements.length) return;
  const roll=[]; const N=10;
  for(let i=0;i<placements.length;i++){ const s=Math.max(0,i-N+1); const slice=placements.slice(s,i+1); roll.push(slice.reduce((a,b)=>a+b,0)/slice.length); }
  const xmin=0,xmax=roll.length-1,ymin=1,ymax=8;
  const x=i=>40+(W-60)*(i-xmin)/Math.max(1,xmax-xmin);
  const y=v=>H-20-(H-40)*(v-ymin)/(ymax-ymin);
  ctx.strokeStyle="#2a3340"; ctx.lineWidth=1;
  for(let v=1;v<=8;v++){ ctx.beginPath(); ctx.moveTo(40,y(v)); ctx.lineTo(W-20,y(v)); ctx.stroke(); ctx.fillStyle="#7f8c8d"; ctx.font="12px system-ui"; ctx.fillText(String(v),10,y(v)+4); }
  ctx.strokeStyle="#35a854"; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x(0),y(roll[0])); for(let i=1;i<roll.length;i++) ctx.lineTo(x(i),y(roll[i])); ctx.stroke();
}

/* Arena Progress Tracker app
   Author, Renas
*/

// ---------- Config ----------
const API_BASE = "https://arenaproxy.irenasthat.workers.dev";
const ARENA_QUEUE = 1700;
const MATCH_COUNT = 120;

const CHUNK_SIZE = 10;
const CHUNK_DELAY_MS = 700;
const PAGE_MORE = 200;
const ROLLING_WINDOW = 10;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- DOM ----------
const form = document.getElementById("search-form");
const riotIdInput = document.getElementById("riotid");
const statusBox = document.getElementById("status");
const summaryBox = document.getElementById("summary");
const matchesBox = document.getElementById("matches");
const filters = document.getElementById("filters");
const rangeSelect = document.getElementById("range-select");

const actions = document.getElementById("actions");
const btnMore  = document.getElementById("load-more");
const btnAll   = document.getElementById("load-all");
const btnCSV   = document.getElementById("export-csv");
const btnCopy  = document.getElementById("copy-link");
const btnClear = document.getElementById("clear-cache");

// visuals
const viz = document.getElementById("viz");
const placementChart = document.getElementById("placement-chart");
const firstChampsBox = document.getElementById("first-champs");
const firstCountEl   = document.getElementById("first-count");
const rollingCanvas  = document.getElementById("rolling-canvas");

// modal
const overlay   = document.getElementById("overlay");
const modalBody = document.getElementById("modal-body");
const closeBtn  = document.getElementById("close-modal");
if (closeBtn) closeBtn.addEventListener("click", () => (overlay.hidden = true));
if (overlay) overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.hidden = true; });
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay && !overlay.hidden) overlay.hidden = true; });

// hardest
const hardestBox = document.getElementById("hardest");

// ---------- State ----------
let LAST_MATCHES = [];         // full list loaded so far, newest first
let PROGRESS = null;           // by champion stats
let CURRENT_PUUID = null;
let CURRENT_PLAYER_TAG = "";
let NEXT_START = 0;            // pointer for pagination in match-id calls

// ---------- Events ----------
filters?.addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  [...filters.querySelectorAll("button")].forEach(b => b.classList.remove("active"));
  e.target.classList.add("active");
  renderAll();
});

rangeSelect?.addEventListener("change", () => {
  setParam("range", rangeSelect.value);
  renderAll();
});

matchesBox.addEventListener("click", (e) => {
  const card = e.target.closest("article.item");
  if (!card) return;
  const id = card.dataset.id;
  if (id) openMatchModal(id);
});

btnMore?.addEventListener("click", () => loadMorePages(PAGE_MORE));
btnAll?.addEventListener("click", () => loadAllPages());
btnCSV?.addEventListener("click", () => exportCSV());
btnCopy?.addEventListener("click", () => copyLink());
btnClear?.addEventListener("click", () => clearCache());

// ---------- Data Dragon ----------
let DD_VERSION = "15.16.1";
const NAME_FIX = {
  FiddleSticks: "Fiddlesticks", Wukong: "MonkeyKing", KhaZix: "Khazix",
  VelKoz: "Velkoz", ChoGath: "Chogath", KaiSa: "Kaisa", LeBlanc: "Leblanc",
  DrMundo: "DrMundo", Nunu: "Nunu", Renata: "Renata", RekSai: "RekSai",
  KogMaw: "KogMaw", BelVeth: "Belveth", TahmKench: "TahmKench",
};
async function initDDragon() {
  try {
    const r = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
    if (r.ok) {
      const arr = await r.json();
      if (Array.isArray(arr) && arr[0]) DD_VERSION = arr[0];
    }
  } catch {}
}
function champIcon(name) {
  const fixed = NAME_FIX[name] || name;
  return `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/champion/${encodeURIComponent(fixed)}.png`;
}
function itemIcon(id) {
  if (!id || id === 0) return "";
  return `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/item/${id}.png`;
}
function ordinal(n){
  if(n===1) return "1st"; if(n===2) return "2nd"; if(n===3) return "3rd";
  if(!Number.isFinite(n)) return "?"; return `${n}th`;
}

// ---------- URL helpers ----------
function getParam(name) { return new URLSearchParams(location.search).get(name); }
function setParam(name, v) {
  const u = new URL(location.href);
  if (v == null || v === "") u.searchParams.delete(name);
  else u.searchParams.set(name, v);
  history.replaceState({}, "", u.toString());
}
function prefillFromURL() {
  const id = getParam("id");
  const range = getParam("range");
  if (range) rangeSelect.value = range;
  if (id) {
    riotIdInput.value = id;
    setTimeout(()=>form.dispatchEvent(new Event("submit", {cancelable:true})), 0);
  }
}

// ---------- Local cache ----------
function cacheKey(puuid){ return `arena_cache:${puuid}`; }
function loadCache(puuid){
  try { return JSON.parse(localStorage.getItem(cacheKey(puuid)) || "null"); } catch { return null; }
}
function saveCache(puuid, data){
  try { localStorage.setItem(cacheKey(puuid), JSON.stringify(data)); } catch {}
}
function clearCache() {
  if (!CURRENT_PUUID) return;
  if (confirm("Clear local cache for this player?")) {
    localStorage.removeItem(cacheKey(CURRENT_PUUID));
    resetUI();
    status("Cache cleared.");
  }
}

// ---------- Fetch helpers with backoff ----------
async function fetchJSON(url, tries = 3, delay = 600) {
  const r = await fetch(url);
  if (r.ok) return r.json();
  const text = await r.text().catch(()=> "");
  const is429 = r.status === 429 || /Riot 429/i.test(text);
  if (is429 && tries > 0) {
    await sleep(delay);
    return fetchJSON(url, tries - 1, delay * 2);
  }
  throw new Error(`Request failed, ${r.status}${text ? `, ${text}` : ""}`);
}

async function fetchIdsPaged(puuid, total, queue = ARENA_QUEUE) {
  const all = [];
  let start = 0;
  const PER = 100;
  while (all.length < total) {
    const count = Math.min(PER, total - all.length);
    status(`Fetching match ids, ${all.length}/${total}`);
    const batch = await fetchJSON(
      `${API_BASE}/match-ids?puuid=${puuid}&queue=${queue}&start=${start}&count=${count}`
    );
    if (!batch.length) break;
    all.push(...batch);
    start += batch.length;
    await sleep(300);
  }
  status(`Fetched match ids, ${all.length}`);
  return all;
}

async function fetchIdsRange(puuid, startFrom, totalNeeded, queue = ARENA_QUEUE) {
  const ids = [];
  let start = startFrom;
  while (ids.length < totalNeeded) {
    const count = Math.min(100, totalNeeded - ids.length);
    status(`Fetching match ids, ${start} to ${start + count - 1}`);
    const batch = await fetchJSON(
      `${API_BASE}/match-ids?puuid=${puuid}&queue=${queue}&start=${start}&count=${count}`
    );
    if (!batch.length) break;
    ids.push(...batch);
    start += batch.length;
    await sleep(300);
    if (batch.length < count) break;
  }
  return { ids, nextStart: start };
}

function dedupeById(list) {
  const seen = new Set();
  const out = [];
  for (const m of list) {
    const id = m?.matchId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(m);
  }
  return out;
}

async function fetchMatchesInChunks(ids, puuid) {
  let collected = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const slice = ids.slice(i, i + CHUNK_SIZE);
    status(`Fetching match details, ${Math.min(i + CHUNK_SIZE, ids.length)}/${ids.length}`);
    const part = await fetchJSON(`${API_BASE}/matches?ids=${slice.join(",")}&puuid=${puuid}`);
    collected = collected.concat(part);

    // live union preview
    const preview = dedupeById(LAST_MATCHES.concat(collected)).sort((a,b)=>b.gameStart - a.gameStart);
    renderMatches(preview);

    if (i + CHUNK_SIZE < ids.length) await sleep(CHUNK_DELAY_MS);
  }
  return collected;
}

// ---------- Filters ----------
function activeFilter() {
  const btn = filters.querySelector("button.active");
  return btn ? btn.dataset.filter : "all";
}
function timeRangeFilter(ts) {
  const mode = rangeSelect.value || "all";
  if (mode === "all") return true;
  const now = Date.now();
  const days = mode === "7d" ? 7 : mode === "30d" ? 30 : 90;
  return Number(ts) >= now - days*24*60*60*1000;
}
function baseFilteredList() {
  // apply time range to the main list, maintain newest first
  return LAST_MATCHES.filter(m => timeRangeFilter(m.gameStart)).sort((a,b)=>b.gameStart - a.gameStart);
}
function filterMatchesByMode(list, mode) {
  if (mode === "top3") return list.filter(m => Number(m.placement) && m.placement <= 3);
  if (mode === "firsts") return list.filter(m => m.placement === 1);
  if (mode === "inprogress") {
    const setTrying = new Set(Object.values(PROGRESS).filter(p => !p.completed).map(p => p.name));
    return list.filter(m => setTrying.has(m.championName));
  }
  return list;
}

// ---------- Paging actions ----------
async function loadMorePages(amount) {
  if (!CURRENT_PUUID) return;
  const startFrom = Number.isFinite(NEXT_START) ? NEXT_START : (LAST_MATCHES.length || 0);

  const { ids, nextStart } = await fetchIdsRange(CURRENT_PUUID, startFrom, amount, ARENA_QUEUE);
  if (!ids.length) { status("No more Arena matches found."); return; }

  status(`Fetching match details, 0/${ids.length}`);
  const newMatches = await fetchMatchesInChunks(ids, CURRENT_PUUID);

  LAST_MATCHES = dedupeById(LAST_MATCHES.concat(newMatches)).sort((a,b)=>b.gameStart - a.gameStart);
  PROGRESS = buildProgress(LAST_MATCHES);
  renderAll();

  NEXT_START = nextStart;

  const cached = loadCache(CURRENT_PUUID) || {};
  saveCache(CURRENT_PUUID, {
    latestId: cached.latestId || (LAST_MATCHES[0]?.matchId ?? null),
    matches: LAST_MATCHES,
    updatedAt: Date.now(),
    nextStart: NEXT_START,
  });

  status("");
}

async function loadAllPages() {
  if (!CURRENT_PUUID) return;
  status("Loading all past Arena matches, this can take a while.");
  while (true) {
    const prevStart = Number.isFinite(NEXT_START) ? NEXT_START : (LAST_MATCHES.length || 0);
    const { ids, nextStart } = await fetchIdsRange(CURRENT_PUUID, prevStart, 500, ARENA_QUEUE);
    if (!ids.length) { status("All past Arena matches loaded."); break; }

    status(`Fetching match details, 0/${ids.length}`);
    const newMatches = await fetchMatchesInChunks(ids, CURRENT_PUUID);

    LAST_MATCHES = dedupeById(LAST_MATCHES.concat(newMatches)).sort((a,b)=>b.gameStart - a.gameStart);
    PROGRESS = buildProgress(LAST_MATCHES);
    renderAll();

    NEXT_START = nextStart;

    const cached = loadCache(CURRENT_PUUID) || {};
    saveCache(CURRENT_PUUID, {
      latestId: cached.latestId || (LAST_MATCHES[0]?.matchId ?? null),
      matches: LAST_MATCHES,
      updatedAt: Date.now(),
      nextStart: NEXT_START,
    });

    await sleep(1000);
  }
}

// ---------- Summary + visuals ----------
function renderAll() {
  const base = baseFilteredList();
  const mode = activeFilter();
  const list = filterMatchesByMode(base, mode);

  // progress and KPIs computed on the time filtered base
  const progressForRange = buildProgress(base);
  renderSummary(base, progressForRange);

  // charts
  renderPlacementChartFromList(base);
  renderRollingAverage(base);

  // first champs grid computed on full progress, not time filtered, to represent lifetime toward 60
  renderFirstChamps(PROGRESS);

  // hardest 1st by attempts lifetime
  renderHardest(PROGRESS);

  // list
  renderMatches(list);

  viz.hidden = false;
}

function renderSummary(list, progressForRange) {
  const total = list.length;
  const places = list.map(m => Number(m.placement)).filter(x => Number.isFinite(x));
  const avgPlace = places.length ? (places.reduce((a,b)=>a+b,0) / places.length).toFixed(2) : "0.00";

  const completedLifetime = Object.values(PROGRESS).filter(p => p.completed).length;
  const arenaGodNeeded = Math.max(0, 60 - completedLifetime);

  summaryBox.innerHTML = [
    tile(CURRENT_PLAYER_TAG, "Player"),
    tile(`${total}`, "Total Arena games, in view"),
    tile(`${avgPlace}`, "Average place, in view"),
    tile(`${completedLifetime}/60`, `Arena God, ${arenaGodNeeded} left`),
  ].join("");
}

function renderPlacementChartFromList(list) {
  const counts = Array(8).fill(0);
  for (const m of list) {
    const p = Number(m.placement);
    if (p >= 1 && p <= 8) counts[p-1]++;
  }
  renderPlacementChart(counts);
}

function buildProgress(matches){
  const byChamp = {};
  for (const m of matches){
    if (!byChamp[m.championName]) byChamp[m.championName] = [];
    byChamp[m.championName].push(m);
  }
  const out = {};
  for (const [name, list] of Object.entries(byChamp)){
    const asc = list.slice().sort((a,b)=>a.gameStart - b.gameStart);
    const firstIndex = asc.findIndex(x => x.placement === 1);
    const completed = firstIndex !== -1;
    const attemptsUntilFirst = completed ? firstIndex + 1 : asc.length;
    const when = completed ? asc[firstIndex].gameStart : null;
    out[name] = { name, completed, attemptsUntilFirst, attemptsSoFar: asc.length, when };
  }
  return out;
}

function renderPlacementChart(counts){
  const max = Math.max(1, ...counts);
  placementChart.innerHTML = counts.map((c, i) => {
    const h = Math.round((c / max) * 100);
    return `
      <div class="bar" style="--h:${h}%">
        <div class="bar-fill"></div>
        <div class="bar-count">${c}</div>
        <div class="bar-label">${i+1}</div>
      </div>
    `;
  }).join("");
}

function renderRollingAverage(list){
  const ctx = rollingCanvas.getContext("2d");
  ctx.clearRect(0,0,rollingCanvas.width,rollingCanvas.height);

  const placements = list.map(m => Number(m.placement)).filter(Number.isFinite);
  if (placements.length === 0) return;

  const roll = [];
  for (let i = 0; i < placements.length; i++) {
    const start = Math.max(0, i - ROLLING_WINDOW + 1);
    const slice = placements.slice(start, i + 1);
    roll.push(slice.reduce((a,b)=>a+b,0) / slice.length);
  }

  const W = rollingCanvas.width;
  const H = rollingCanvas.height;
  const P = 20; // padding
  const xmin = 0, xmax = roll.length - 1;
  const ymin = 1, ymax = 8;

  function x(i){ return P + (W - 2*P) * (i - xmin) / Math.max(1, xmax - xmin); }
  function y(v){ return H - P - (H - 2*P) * (v - ymin) / (ymax - ymin); }

  // axes
  ctx.strokeStyle = "rgba(154,164,173,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(P, y(1)); ctx.lineTo(P, y(8)); ctx.lineTo(W - P, y(8));
  ctx.stroke();

  // horizontal guide lines
  for (let v = 2; v <= 7; v++) {
    ctx.beginPath();
    ctx.moveTo(P, y(v)); ctx.lineTo(W - P, y(v));
    ctx.stroke();
  }

  // path
  ctx.strokeStyle = "#35a854";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x(0), y(roll[0]));
  for (let i = 1; i < roll.length; i++) ctx.lineTo(x(i), y(roll[i]));
  ctx.stroke();
}

function renderFirstChamps(progress){
  const done = Object.values(progress).filter(p => p.completed).sort((a,b)=>a.when - b.when);
  firstCountEl.textContent = String(done.length);
  firstChampsBox.innerHTML = done.map(p => `
    <div class="champ" title="${p.name}">
      <img src="${champIcon(p.name)}" alt="${p.name}">
      <div class="check">✓</div>
    </div>
  `).join("");
}

function renderHardest(progress) {
  const hardest = Object.values(progress)
    .filter(p => p.completed)
    .sort((a,b)=>b.attemptsUntilFirst - a.attemptsUntilFirst)
    .slice(0,10);
  if (!hardest.length) { hardestBox.hidden = true; hardestBox.innerHTML = ""; return; }
  hardestBox.hidden = false;
  hardestBox.innerHTML = `
    <div class="section-title">
      <strong>Hardest 1st places by attempts</strong>
      <span class="small">${hardest.length}</span>
    </div>
    <div class="list">
      ${hardest.map(p => `
        <span class="badge sm"><img src="${champIcon(p.name)}" alt="${p.name}" style="width:16px;height:16px;border-radius:4px;border:1px solid var(--border);vertical-align:-3px;margin-right:6px">${p.name} · ${p.attemptsUntilFirst}</span>
      `).join("")}
    </div>
  `;
}

// ---------- Rendering ----------
function renderMatches(list) {
  matchesBox.innerHTML = list.map(m => {
    const place = Number(m.placement);
    const cls = place === 1 ? "p1" : place === 2 ? "p2" : place === 3 ? "p3" : "px";
    const when = timeAgo(m.gameStart);
    const kda = `${m.kills}/${m.deaths}/${m.assists}`;
    return `
      <article class="item" data-id="${m.matchId}" tabindex="0">
        <div class="icon"><img src="${champIcon(m.championName)}" alt="${m.championName}"></div>
        <div>
          <div class="head">
            <strong>${m.championName}</strong>
            <span class="badge ${cls} place">${ordinal(place)}</span>
          </div>
          <div class="small">KDA, ${kda}</div>
          <div class="small">Played, ${when}</div>
        </div>
      </article>
    `;
  }).join("");
}

// ---------- Modal ----------
async function openMatchModal(matchId) {
  try {
    status("Loading match...");
    const match = await fetchJSON(`${API_BASE}/match?id=${encodeURIComponent(matchId)}`);
    renderMatchModal(match);
    overlay.hidden = false;
    status("");
  } catch (e) {
    console.error(e);
    status(e.message || "Failed to load match");
  }
}

function renderMatchModal(match) {
  const info = match?.info || {};
  const started = info.gameStartTimestamp ? new Date(info.gameStartTimestamp).toLocaleString() : "?";
  const q = info.queueId ?? "?";

  const parts = (info.participants || []).slice().sort((a,b) => {
    const ap = a.placement ?? a.challenges?.arenaPlacement ?? 99;
    const bp = b.placement ?? b.challenges?.arenaPlacement ?? 99;
    return ap - bp;
  });

  const rows = parts.map(p => {
    const me = (p.puuid && p.puuid === CURRENT_PUUID) ? "row-me" : "";
    const placement = p.placement ?? p.challenges?.arenaPlacement ?? "?";
    const kda = `${p.kills ?? 0}/${p.deaths ?? 0}/${p.assists ?? 0}`;
    const dmg = p.totalDamageDealtToChampions ?? p.challenges?.teamDamagePercentage ?? 0;
    const gold = p.goldEarned ?? 0;

    const items = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6]
      .filter(v => Number.isFinite(v) && v > 0)
      .map(id => `<img src="${itemIcon(id)}" alt="${id}">`).join("");

    const augments = [p.playerAugment1, p.playerAugment2, p.playerAugment3, p.playerAugment4]
      .filter(Boolean)
      .map(a => `<span class="badge sm">${a}</span>`).join(" ");

    return `
      <tr class="${me}">
        <td class="row" style="white-space:nowrap">
          <img src="${champIcon(p.championName)}" alt="${p.championName}" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border);margin-right:6px">
          ${p.championName}
        </td>
        <td>${ordinal(Number(placement))}</td>
        <td>${kda}</td>
        <td>${Number(gold).toLocaleString()}</td>
        <td>${Number.isFinite(dmg) ? Number(dmg).toLocaleString() : "?"}</td>
        <td><div class="item-icons">${items || ""}</div></td>
        <td>${augments || ""}</td>
      </tr>
    `;
  }).join("");

  modalBody.innerHTML = `
    <h3 id="modal-title">Match ${match.metadata?.matchId || ""}</h3>
    <div class="small" style="margin-bottom:8px">Queue ${q} • ${started}</div>
    <div style="overflow:auto">
      <table class="table">
        <thead>
          <tr>
            <th>Champion</th>
            <th>Place</th>
            <th>K / D / A</th>
            <th>Gold</th>
            <th>Damage</th>
            <th>Items</th>
            <th>Augments</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ---------- Submit ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = riotIdInput.value.trim();
  if (!raw.includes("#")) { alert("Write your Riot ID like Name#TAG"); return; }
  const [gameName, tagLine] = raw.split("#");
  setParam("id", `${gameName}#${tagLine}`);
  resetUI();
  status("Looking up account...");

  await initDDragon();

  try {
    // account
    const acc = await fetchJSON(
      `${API_BASE}/account?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`
    );
    CURRENT_PUUID = acc.puuid;
    CURRENT_PLAYER_TAG = `${acc.gameName}#${acc.tagLine}`;

    // cached
    const cached = loadCache(acc.puuid);
    if (cached?.matches?.length) {
      LAST_MATCHES = cached.matches;
      PROGRESS = buildProgress(LAST_MATCHES);
      NEXT_START = Number.isFinite(cached.nextStart) ? cached.nextStart : cached.matches.length || 0;
      renderAll();
      filters.hidden = false;
      actions.hidden = false;
      status("Refreshing...");
    } else {
      NEXT_START = 0;
    }

    // quick newest check to always include latest game
    try {
      const newestIds = await fetchJSON(`${API_BASE}/match-ids?puuid=${CURRENT_PUUID}&queue=${ARENA_QUEUE}&start=0&count=1`);
      const newest = newestIds[0];
      const latestInCache = cached?.latestId || null;
      if (newest && newest !== latestInCache) {
        const head = await fetchMatchesInChunks([newest], CURRENT_PUUID);
        LAST_MATCHES = dedupeById(head.concat(LAST_MATCHES)).sort((a,b)=>b.gameStart - a.gameStart);
      }
    } catch {}

    // newest IDs for initial window
    status("Fetching match IDs...");
    let ids = await fetchIdsPaged(acc.puuid, MATCH_COUNT, ARENA_QUEUE);
    if (!ids.length) { status("No Arena matches found for this player."); return; }

    // if cache exists, only fetch ones that are newer than cached.latestId
    let newIds = ids;
    let merged = [];
    const latestId = loadCache(CURRENT_PUUID)?.latestId || null;
    if (latestId) {
      const idx = ids.indexOf(latestId);
      newIds = idx === -1 ? ids : ids.slice(0, idx);
      merged = (loadCache(CURRENT_PUUID)?.matches || []).slice();
    }

    // fetch details for new
    let newlyFetched = [];
    if (newIds.length) {
      status(`Fetching match details, 0/${newIds.length}`);
      newlyFetched = await fetchMatchesInChunks(newIds, acc.puuid);
      newlyFetched.sort((a,b)=>b.gameStart - a.gameStart);
    }

    // final list
    if (merged.length) {
      LAST_MATCHES = dedupeById((newlyFetched.length ? newlyFetched.concat(merged) : merged));
      LAST_MATCHES.sort((a,b)=>b.gameStart - a.gameStart);
    } else {
      const full = newlyFetched.length ? newlyFetched : await fetchMatchesInChunks(ids, acc.puuid);
      LAST_MATCHES = dedupeById(full).sort((a,b)=>b.gameStart - a.gameStart);
      NEXT_START = LAST_MATCHES.length;
    }

    // visuals + UI
    PROGRESS = buildProgress(LAST_MATCHES);
    filters.hidden = false;
    actions.hidden = false;
    renderAll();
    status("");

    // save
    saveCache(acc.puuid, {
      latestId: ids[0] || latestId || null,
      matches: LAST_MATCHES,
      updatedAt: Date.now(),
      nextStart: NEXT_START,
    });

  } catch (err) {
    console.error(err);
    status(err.message || "Error");
  }
});

// ---------- Utils ----------
function tile(big, label) { return `<div class="tile"><div class="big kpi">${big}</div><div class="label">${label}</div></div>`; }
function status(t) { statusBox.textContent = t; }
function resetUI() {
  summaryBox.innerHTML = "";
  matchesBox.innerHTML = "";
  filters.hidden = true;
  actions.hidden = true;
  viz.hidden = true;
  hardestBox.hidden = true;
  firstChampsBox.innerHTML = "";
  placementChart.innerHTML = "";
  if (rollingCanvas) {
    const ctx = rollingCanvas.getContext("2d");
    ctx.clearRect(0,0,rollingCanvas.width,rollingCanvas.height);
  }
  status("");
}
function timeAgo(ts) {
  if (!ts) return "unknown";
  const s = Math.max(1, Math.floor((Date.now() - Number(ts)) / 1000));
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
function copyLink() {
  const u = new URL(location.href);
  u.searchParams.set("id", riotIdInput.value.trim());
  u.searchParams.set("range", rangeSelect.value);
  navigator.clipboard.writeText(u.toString()).then(()=>{
    status("Link copied.");
    setTimeout(()=>status(""), 1200);
  });
}
function exportCSV() {
  const list = baseFilteredList();
  if (!list.length) { status("Nothing to export."); return; }
  const header = ["matchId","gameStart","championName","placement","kills","deaths","assists"];
  const rows = list.map(m => [
    m.matchId,
    new Date(m.gameStart).toISOString(),
    m.championName,
    m.placement,
    m.kills,
    m.deaths,
    m.assists
  ]);
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `arena_${CURRENT_PLAYER_TAG.replace(/[#\s]/g,"_")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// kick off
prefillFromURL();

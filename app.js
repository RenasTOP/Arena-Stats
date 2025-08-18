const API_BASE = "https://arenaproxy.irenasthat.workers.dev";
const ARENA_QUEUE = 1700;
const MATCH_COUNT = 120; // pull more so progress per champion is meaningful

const CHUNK_SIZE = 10;        // 10–20 is safe
const CHUNK_DELAY_MS = 700;   // pause between chunks to avoid 429s

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let CURRENT_PUUID = null;
let CURRENT_PLAYER_TAG = "";
let NEXT_START = 0;           // where the next /match-ids page should start
const PAGE_MORE = 200;        // how many IDs to fetch per "Load next" click

const actions = document.getElementById("actions");
const btnMore  = document.getElementById("load-more");
const btnAll   = document.getElementById("load-all");

if (btnMore) btnMore.addEventListener("click", () => loadMorePages(PAGE_MORE));
if (btnAll)  btnAll.addEventListener("click", () => loadAllPages());

async function fetchMatchesInChunks(ids, puuid) {
  let out = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const slice = ids.slice(i, i + CHUNK_SIZE);
    status(`Fetching match details… ${Math.min(i + CHUNK_SIZE, ids.length)}/${ids.length}`);
    const part = await fetchJSON(`${API_BASE}/matches?ids=${slice.join(",")}&puuid=${puuid}`);
    out = out.concat(part);

    // live update so users see progress
    LAST_MATCHES = out.slice().sort((a,b)=>b.gameStart - a.gameStart);
    renderMatches(LAST_MATCHES);

    if (i + CHUNK_SIZE < ids.length) await sleep(CHUNK_DELAY_MS);
  }
  return out;
}


async function fetchIdsPaged(puuid, total, queue = ARENA_QUEUE) {
  const all = [];
  let start = 0;
  const PER = 100;
  while (all.length < total) {
    const count = Math.min(PER, total - all.length);
    status(`Fetching match ids… ${all.length}/${total}`);
    const batch = await fetchJSON(
      `${API_BASE}/match-ids?puuid=${puuid}&queue=${queue}&start=${start}&count=${count}`
    );
    if (!batch.length) break;
    all.push(...batch);
    start += batch.length;
    await sleep(300);
  }
  status(`Fetched match ids: ${all.length}`);
  return all;
}

// fetch a specific RANGE of ids starting at "startFrom", up to "totalNeeded"
async function fetchIdsRange(puuid, startFrom, totalNeeded, queue = ARENA_QUEUE) {
  const ids = [];
  let start = startFrom;
  while (ids.length < totalNeeded) {
    const count = Math.min(100, totalNeeded - ids.length);
    status(`Fetching match ids… ${start}–${start + count - 1}`);
    const batch = await fetchJSON(
      `${API_BASE}/match-ids?puuid=${puuid}&queue=${queue}&start=${start}&count=${count}`
    );
    if (!batch.length) break;
    ids.push(...batch);
    start += batch.length;
    await sleep(300);
    if (batch.length < count) break; // Riot returned fewer than requested: end
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

function updateSummaryFromProgress() {
  const uniqueChamps = Object.keys(PROGRESS).length;
  const completed = Object.values(PROGRESS).filter(p => p.completed).length;
  const remaining = uniqueChamps - completed;
  const places = LAST_MATCHES.map(m => m.placement).filter(Number.isFinite);
  const avgPlace = places.length ? (places.reduce((a,b)=>a+b,0)/places.length).toFixed(2) : "0.00";

  summaryBox.innerHTML = [
    tile(CURRENT_PLAYER_TAG, "Player"),
    tile(`${completed} champions 1st`, "Completed"),
    tile(`${remaining} still trying`, "In progress"),
    tile(`${avgPlace} average place`, "Across matches"),
  ].join("");
}

function cacheKey(puuid){ return `arena_cache:${puuid}`; }
function loadCache(puuid){
  try { return JSON.parse(localStorage.getItem(cacheKey(puuid)) || "null"); } catch { return null; }
}
function saveCache(puuid, data){
  try { localStorage.setItem(cacheKey(puuid), JSON.stringify(data)); } catch {}
}

async function loadMorePages(amount) {
  if (!CURRENT_PUUID) return;
  const startFrom = NEXT_START || LAST_MATCHES.length || 0;

  // get the next "amount" ids (paged internally in 100s)
  const { ids, nextStart } = await fetchIdsRange(CURRENT_PUUID, startFrom, amount, ARENA_QUEUE);
  if (!ids.length) { status("No more Arena matches found."); return; }

  status(`Fetching match details… 0/${ids.length}`);
  const newMatches = await fetchMatchesInChunks(ids, CURRENT_PUUID);

  // merge, dedupe, sort
  LAST_MATCHES = dedupeById(LAST_MATCHES.concat(newMatches)).sort((a,b)=>b.gameStart - a.gameStart);
  PROGRESS = buildProgress(LAST_MATCHES);
  updateSummaryFromProgress();
  renderMatches(LAST_MATCHES);

  NEXT_START = nextStart;

  // persist
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
  status("Loading all past Arena matches… this may take a while.");
  while (true) {
    const prevStart = NEXT_START || LAST_MATCHES.length || 0;
    const { ids, nextStart } = await fetchIdsRange(CURRENT_PUUID, prevStart, 500, ARENA_QUEUE);
    if (!ids.length) { status("All past Arena matches loaded."); break; }

    status(`Fetching match details… 0/${ids.length}`);
    const newMatches = await fetchMatchesInChunks(ids, CURRENT_PUUID);

    LAST_MATCHES = dedupeById(LAST_MATCHES.concat(newMatches)).sort((a,b)=>b.gameStart - a.gameStart);
    PROGRESS = buildProgress(LAST_MATCHES);
    updateSummaryFromProgress();
    renderMatches(LAST_MATCHES);

    NEXT_START = nextStart;

    const cached = loadCache(CURRENT_PUUID) || {};
    saveCache(CURRENT_PUUID, {
      latestId: cached.latestId || (LAST_MATCHES[0]?.matchId ?? null),
      matches: LAST_MATCHES,
      updatedAt: Date.now(),
      nextStart: NEXT_START,
    });

    // be gentle to Riot
    await sleep(1000);
  }
}



// --- URL helpers (shareable links) ---
function getParam(name) { return new URLSearchParams(location.search).get(name); }
function setParam(name, v) {
  const u = new URL(location.href);
  if (v == null || v === "") u.searchParams.delete(name);
  else u.searchParams.set(name, v);
  history.replaceState({}, "", u.toString());
}
function prefillFromURL() {
  const id = getParam("id");
  if (id) {
    riotIdInput.value = id;
    // auto submit after a tick so the DOM is ready
    setTimeout(()=>form.dispatchEvent(new Event("submit", {cancelable:true})), 0);
  }
}

// Data Dragon version and icon helper
let DD_VERSION = "15.16.1";
const NAME_FIX = {
  FiddleSticks: "Fiddlesticks",
  Wukong: "MonkeyKing",
  KhaZix: "Khazix",
  VelKoz: "Velkoz",
  ChoGath: "Chogath",
  KaiSa: "Kaisa",
  LeBlanc: "Leblanc",
  DrMundo: "DrMundo",
  Nunu: "Nunu",
  Renata: "Renata",
  RekSai: "RekSai",
  KogMaw: "KogMaw",
  BelVeth: "Belveth",
  TahmKench: "TahmKench",
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
function ordinal(n){
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  if (!Number.isFinite(n)) return "—";
  return `${n}th`;
}

const form = document.getElementById("search-form");
const riotIdInput = document.getElementById("riotid");
const statusBox = document.getElementById("status");
const summaryBox = document.getElementById("summary");
const matchesBox = document.getElementById("matches");
const filters = document.getElementById("filters");
const progressWrap = document.getElementById("progress");
const progComplete = document.getElementById("progress-complete");
const progPending = document.getElementById("progress-pending");
const hardestBox = document.getElementById("hardest");

let LAST_MATCHES = [];
let PROGRESS = null; // per champion progress

filters.addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  [...filters.querySelectorAll("button")].forEach(b => b.classList.remove("active"));
  e.target.classList.add("active");
  const mode = e.target.dataset.filter;
  renderMatches(filterMatches(mode));
});

function filterMatches(mode) {
  if (mode === "top3") return LAST_MATCHES.filter(m => Number(m.placement) && m.placement <= 3);
  if (mode === "firsts") return LAST_MATCHES.filter(m => m.placement === 1);
  if (mode === "inprogress") {
    const setTrying = new Set(Object.values(PROGRESS).filter(p => !p.completed).map(p => p.name));
    return LAST_MATCHES.filter(m => setTrying.has(m.championName));
  }
  return LAST_MATCHES;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = riotIdInput.value.trim();
  if (!raw.includes("#")) { alert("Write your Riot ID like Name#TAG"); return; }
  const [gameName, tagLine] = raw.split("#");
  setParam("id", `${gameName}#${tagLine}`);
  resetUI();
  status("Loading, fetching account...");

  await initDDragon();

  try {
    // 1) account
    const acc = await fetchJSON(
      `${API_BASE}/account?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`
    );
    CURRENT_PUUID = acc.puuid;
    CURRENT_PLAYER_TAG = `${acc.gameName}#${acc.tagLine}`;

    // 2) try to render cached matches instantly (if we have them)
    const cached = loadCache(acc.puuid);
    if (cached?.matches?.length) {
      LAST_MATCHES = cached.matches;
      PROGRESS = buildProgress(LAST_MATCHES);
      NEXT_START = cached.nextStart ?? cached.matches.length ?? 0;  // where to continue
      updateSummaryFromProgress();
      renderMatches(LAST_MATCHES);
      filters.hidden = false;
      actions.hidden = false;
      status("Refreshing…");
    } else {
      NEXT_START = 0;
    }

    // 3) fetch newest IDs (paged from 0 up to MATCH_COUNT)
    status("Fetching match ids…");
    const ids = await fetchIdsPaged(acc.puuid, MATCH_COUNT, ARENA_QUEUE);
    if (!ids.length) { status("No Arena matches found for this player."); return; }

    // 4) figure out which IDs are NEW since last time
    let newIds = ids;              // default: all
    let merged = [];
    if (cached?.matches?.length && cached.latestId) {
      const idx = ids.indexOf(cached.latestId); // ids are newest → oldest
      newIds = idx === -1 ? ids : ids.slice(0, idx); // only until we hit last known
      merged = cached.matches.slice();              // keep cached as base
    }

    // 5) fetch details only for new IDs (if any)
    let newlyFetched = [];
    if (newIds.length) {
      status(`Fetching match details… 0/${newIds.length}`);
      newlyFetched = await fetchMatchesInChunks(newIds, acc.puuid);
      newlyFetched.sort((a,b)=>b.gameStart - a.gameStart);
    }

    // 6) compute final list (new + old) or first-time pull everything
    if (cached?.matches?.length) {
      LAST_MATCHES = dedupeById((newlyFetched.length ? newlyFetched.concat(merged) : merged));
      LAST_MATCHES.sort((a,b)=>b.gameStart - a.gameStart);
      // keep NEXT_START from cache (where to continue for Load more)
    } else {
      const full = newlyFetched.length ? newlyFetched : await fetchMatchesInChunks(ids, acc.puuid);
      LAST_MATCHES = dedupeById(full).sort((a,b)=>b.gameStart - a.gameStart);
      NEXT_START = LAST_MATCHES.length; // continue from here
    }

    // 7) recompute summary + progress
    PROGRESS = buildProgress(LAST_MATCHES);
    updateSummaryFromProgress();

    // 8) show UI
    filters.hidden = false;
    actions.hidden = false;
    renderMatches(LAST_MATCHES);
    status("");

    // 9) save cache for next time
    saveCache(acc.puuid, {
      latestId: ids[0] || cached?.latestId || null, // newest ID we saw at the top
      matches: LAST_MATCHES,
      updatedAt: Date.now(),
      nextStart: NEXT_START,
    });

  } catch (err) {
    console.error(err);
    status(err.message || "Error");
  }
});

function buildProgress(matches){
  // group by champ, sort by time ascending to find first 1st
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

function renderComplete(progress){
  const done = Object.values(progress).filter(p => p.completed).sort((a,b)=>a.when - b.when);
  return `
    <div class="section-title">
      <strong>Champions completed</strong>
      <span class="small">${done.length}</span>
    </div>
    <div class="list">
      ${done.map(p => `
        <span class="tag"><img src="${champIcon(p.name)}" alt="${p.name}">${p.name} · ${p.attemptsUntilFirst} tries</span>
      `).join("")}
    </div>
  `;
}
function renderPending(progress){
  const todo = Object.values(progress).filter(p => !p.completed).sort((a,b)=>b.attemptsSoFar - a.attemptsSoFar);
  return `
    <div class="section-title">
      <strong>Still trying</strong>
      <span class="small">${todo.length}</span>
    </div>
    <div class="list">
      ${todo.map(p => `
        <span class="tag"><img src="${champIcon(p.name)}" alt="${p.name}">${p.name} · ${p.attemptsSoFar} tries</span>
      `).join("")}
    </div>
  `;
}

function renderMatches(list) {
  matchesBox.innerHTML = list.map(m => {
    const place = Number(m.placement);
    const cls = place === 1 ? "p1" : place === 2 ? "p2" : place === 3 ? "p3" : "px";
    const when = timeAgo(m.gameStart);
    const kda = `${m.kills}/${m.deaths}/${m.assists}`;
    return `
      <article class="item">
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

function tile(big, label) { return `<div class="tile"><div class="big kpi">${big}</div><div class="label">${label}</div></div>`; }
function status(t) { statusBox.textContent = t; }
function resetUI() {
  summaryBox.innerHTML = "";
  matchesBox.innerHTML = "";
  filters.hidden = true;
  progressWrap.hidden = true;
  hardestBox.hidden = true;
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

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const text = await r.text().catch(()=> "");
    if (r.status === 429 || /Riot 429/i.test(text)) {
      throw new Error("Riot is rate limiting right now. Please wait ~1–2 minutes and try again.");
    }
    throw new Error(`Request failed, ${r.status}${text ? `, ${text}` : ""}`);
  }
  return r.json();
}

prefillFromURL();

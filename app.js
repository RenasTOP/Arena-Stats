const API_BASE = "https://arenaproxy.irenasthat.workers.dev";
const ARENA_QUEUE = 1700;
const MATCH_COUNT = 80; // pull more so progress per champion is meaningful

const CHUNK_SIZE = 10;        // 10–20 is safe
const CHUNK_DELAY_MS = 500;   // pause between chunks to avoid 429s

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchMatchesInChunks(ids, puuid) {
  let out = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const slice = ids.slice(i, i + CHUNK_SIZE);
    const part = await fetchJSON(`${API_BASE}/matches?ids=${slice.join(",")}&puuid=${puuid}`);
    out = out.concat(part);
    if (i + CHUNK_SIZE < ids.length) await sleep(CHUNK_DELAY_MS);
  }
  return out;
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
    const acc = await fetchJSON(`${API_BASE}/account?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`);

    status("Fetching match ids...");
    const ids = await fetchJSON(`${API_BASE}/match-ids?puuid=${acc.puuid}&queue=${ARENA_QUEUE}&count=${MATCH_COUNT}`);

    status("Fetching match details...");
    const all = await fetchMatchesInChunks(ids, acc.puuid);
    LAST_MATCHES = all.sort((a,b)=>b.gameStart - a.gameStart);

    // Build progress per champion
    PROGRESS = buildProgress(LAST_MATCHES);

    // Summary tiles
    const total = LAST_MATCHES.length;
    const uniqueChamps = Object.keys(PROGRESS).length;
    const completed = Object.values(PROGRESS).filter(p => p.completed).length;
    const remaining = uniqueChamps - completed;
    const firsts = completed;
    const places = LAST_MATCHES.map(m => m.placement).filter(Number.isFinite);
    const avgPlace = places.length ? (places.reduce((a,b)=>a+b,0)/places.length).toFixed(2) : "0.00";

    summaryBox.innerHTML = [
      tile(`${acc.gameName}#${acc.tagLine}`, "Player"),
      tile(`${firsts} champions 1st`, "Completed"),
      tile(`${remaining} still trying`, "In progress"),
      tile(`${avgPlace} average place`, "Across matches"),
    ].join("");

    // Progress panes
    progressWrap.hidden = false;
    progComplete.innerHTML = renderComplete(PROGRESS);
    progPending.innerHTML = renderPending(PROGRESS);

    // Hardest top 10
    const hardest = Object.values(PROGRESS)
      .filter(p => p.completed)
      .sort((a,b)=>b.attemptsUntilFirst - a.attemptsUntilFirst)
      .slice(0,10);
    hardestBox.hidden = false;
    hardestBox.innerHTML = `
      <div class="section-title"><strong>Top 10 hardest to get 1st</strong><span class="small">by attempts</span></div>
      <div class="list">
        ${hardest.map(p => `
          <span class="tag"><img src="${champIcon(p.name)}" alt="${p.name}">${p.name} · ${p.attemptsUntilFirst}</span>
        `).join("")}
      </div>
    `;

    // Filters visible
    filters.hidden = false;

    // Match cards with placement badge
    renderMatches(LAST_MATCHES);

    status("");
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

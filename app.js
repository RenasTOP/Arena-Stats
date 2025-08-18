const API_BASE = "https://arenaproxy.irenasthat.workers.dev";

// Data Dragon version and icon helper
let DD_VERSION = "15.16.1";
const NAME_FIX = {
  FiddleSticks: "Fiddlesticks",
  Wukong: "MonkeyKing",
  Renata: "Renata",
  Nunu: "Nunu",
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
  const key = NAME_FIX[name] || name;
  return `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/champion/${encodeURIComponent(key)}.png`;
}

const form = document.getElementById("search-form");
const riotIdInput = document.getElementById("riotid");
const statusBox = document.getElementById("status");
const summaryBox = document.getElementById("summary");
const matchesBox = document.getElementById("matches");
const filters = document.getElementById("filters");
const topRow = document.getElementById("tops");
const topChamps = document.getElementById("top-champs");
const recentRecord = document.getElementById("recent-record");

const ARENA_QUEUE = 1700;

let LAST_MATCHES = [];

filters.addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  [...filters.querySelectorAll("button")].forEach(b => b.classList.remove("active"));
  e.target.classList.add("active");
  const f = e.target.dataset.filter;
  renderMatches(filterMatches(f));
});

function filterMatches(mode) {
  if (mode === "wins") return LAST_MATCHES.filter(m => m.win === true);
  if (mode === "losses") return LAST_MATCHES.filter(m => m.win === false);
  return LAST_MATCHES;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = riotIdInput.value.trim();
  if (!raw.includes("#")) { alert("Write your Riot ID like Name#TAG"); return; }
  const [gameName, tagLine] = raw.split("#");
  resetUI();
  status("Loading, fetching account...");

  await initDDragon();

  try {
    // 1) account
    const acc = await fetchJSON(`${API_BASE}/account?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`);

    status("Fetching match ids...");
    // 2) ids
    const ids = await fetchJSON(`${API_BASE}/match-ids?puuid=${acc.puuid}&queue=${ARENA_QUEUE}&count=20`);

    status("Fetching match details...");
    // 3) details
    const all = await fetchJSON(`${API_BASE}/matches?ids=${ids.join(",")}&puuid=${acc.puuid}`);
    LAST_MATCHES = all;

    // Aggregates
    const total = all.length;
    const wins = all.filter(x => x.win === true).length;
    const losses = all.filter(x => x.win === false).length;
    const wr = total ? ((wins / total) * 100).toFixed(1) : "0.0";
    const places = all.map(m => m.placement).filter(Number.isFinite);
    const firsts = places.filter(p => p === 1).length;
    const avgPlace = places.length ? (places.reduce((a,b)=>a+b,0)/places.length).toFixed(2) : "0.00";
    const champs = countBy(all.map(m => m.championName));

    // Summary tiles
    summaryBox.innerHTML = [
      tile(`${acc.gameName}#${acc.tagLine}`, "Player"),
      tile(`${wins}W, ${losses}L`, "Record"),
      tile(`${wr}%`, "Win rate"),
      tile(`${firsts} firsts, ${avgPlace} avg place`, "Arena"),
    ].join("");

    // Top row, top champs and recent record
    topRow.hidden = false;
    const top = Object.entries(champs).sort((a,b)=>b[1]-a[1]).slice(0,6);
    topChamps.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <strong>Most played</strong><span class="small">${Object.keys(champs).length} unique</span>
      </div>
      <div class="chips">
        ${top.map(([name,c]) => `
          <span class="chip"><img src="${champIcon(name)}" alt="${name}" />${name} · ${c}</span>
        `).join("")}
      </div>
    `;
    const last5 = all.slice(0,5);
    const rWins = last5.filter(m=>m.win).length;
    recentRecord.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <strong>Recent form</strong><span class="small">last 5</span>
      </div>
      <div class="chips">
        ${last5.map(m=>`<span class="chip ${m.win?'win':'loss'}">${m.win?'W':'L'}</span>`).join("")}
      </div>
      <div class="small">${rWins}W, ${5-rWins}L</div>
    `;

    // Filters visible
    filters.hidden = false;

    // Cards
    renderMatches(all);

    status("");
  } catch (err) {
    console.error(err);
    status(err.message || "Error");
  }
});

function renderMatches(list) {
  matchesBox.innerHTML = list.map(m => {
    const badge = m.win === true ? "badge win" : m.win === false ? "badge loss" : "badge";
    const when = timeAgo(m.gameStart);
    const kda = `${m.kills}/${m.deaths}/${m.assists}`;
    return `
      <article class="item">
        <div class="icon"><img src="${champIcon(m.championName)}" alt="${m.championName}" /></div>
        <div>
          <div class="head">
            <strong>${m.championName}</strong>
            <span class="${badge}">${m.win === true ? "Win" : m.win === false ? "Loss" : "—"}</span>
          </div>
          <div class="small">KDA, ${kda}</div>
          <div class="small">Placement, ${m.placement ?? "—"}</div>
          <div class="small">Played, ${when}</div>
        </div>
      </article>
    `;
  }).join("");
}

function tile(big, label) {
  return `<div class="tile"><div class="big">${big}</div><div class="label">${label}</div></div>`;
}

function status(t) { statusBox.textContent = t; }
function resetUI() {
  summaryBox.innerHTML = "";
  matchesBox.innerHTML = "";
  topRow.hidden = true;
  filters.hidden = true;
  status("");
}

function countBy(arr) {
  return arr.reduce((acc, x) => (acc[x] = (acc[x] || 0) + 1, acc), {});
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
    // try to read server error text
    let msg = `Request failed, ${r.status}`;
    try { msg += `, ${await r.text()}`; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

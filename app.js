const API_BASE = "https://arenaproxy.irenasthat.workers.dev"; // change to your backend URL

const form = document.getElementById("search-form");
const riotIdInput = document.getElementById("riotid");
const statusBox = document.getElementById("status");
const summaryBox = document.getElementById("summary");
const matchesBox = document.getElementById("matches");

// queue 1700 is Arena, keep as default but you can change
const ARENA_QUEUE = 1700;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = riotIdInput.value.trim();
  if (!raw.includes("#")) {
    alert("Write your Riot ID like Name#TAG");
    return;
  }
  const [gameName, tagLine] = raw.split("#");
  matchesBox.innerHTML = "";
  summaryBox.innerHTML = "";
  statusBox.textContent = "Loading...";

  try {
    // 1) get puuid from Riot ID
    const acc = await fetchJSON(`${API_BASE}/account?gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`);

    // 2) get last N arena match IDs
    const ids = await fetchJSON(`${API_BASE}/match-ids?puuid=${acc.puuid}&queue=${ARENA_QUEUE}&count=20`);

    // 3) fetch summaries for those matches
    const all = await fetchJSON(`${API_BASE}/matches?ids=${ids.join(",")}&puuid=${acc.puuid}`);

    // aggregate simple stats
    const total = all.length;
    const placements = all.map(m => m.placement).filter(Boolean);
    const firsts = placements.filter(p => p === 1).length;
    const avgPlace = placements.length ? (placements.reduce((a,b)=>a+b,0)/placements.length).toFixed(2) : "—";
    const champs = countBy(all.map(m => m.championName));

    summaryBox.innerHTML = `
      <div><strong>${acc.gameName}#${acc.tagLine}</strong></div>
      <div class="small">Matches analyzed, ${total} in queue ${ARENA_QUEUE}</div>
      <div class="small">1st places, ${firsts} · Avg placement, ${avgPlace}</div>
      <div class="small">Unique champions, ${Object.keys(champs).length}</div>
    `;

    matchesBox.innerHTML = all.map(m => {
      const badge = m.win === true ? "badge win" : m.win === false ? "badge loss" : "badge";
      return `
        <div class="item">
          <div><strong>${m.championName}</strong> <span class="${badge}">${m.win === true ? "Win" : m.win === false ? "Loss" : "—"}</span></div>
          <div class="small">KDA, ${m.kills}/${m.deaths}/${m.assists}</div>
          <div class="small">Placement, ${m.placement ?? "—"}</div>
          <div class="small">GameStart, ${new Date(m.gameStart).toLocaleString()}</div>
        </div>
      `;
    }).join("");

    statusBox.textContent = "";
  } catch (err) {
    console.error(err);
    statusBox.textContent = err.message || "Error";
  }
});

function countBy(arr) {
  return arr.reduce((acc, x) => (acc[x] = (acc[x] || 0) + 1, acc), {});
}
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Request failed, ${r.status}`);
  return r.json();
}

// Match details page — pretty teams, clickable names, readable augments, item tooltips
const API_BASE = "https://arenaproxy.irenasthat.workers.dev"; // no trailing slash

// --- Params ---
const params = new URLSearchParams(location.search);
const matchId = params.get("id");
const focusPuuid = params.get("puuid");           // the profile we came from
const routingRegion = params.get("region") || ""; // americas/europe for API
let uiRegion = params.get("regionUI") || "";      // NA / EUW / EUNE for links

// --- DOM ---
const backLink = document.getElementById("back-link");
const card = document.getElementById("match-card");
const teamsWrap = document.getElementById("teams");
const tbody = document.querySelector("#match-table tbody");

// --- DDragon ---
let DD_VERSION = "15.16.1";
const NAME_FIX = { FiddleSticks:"Fiddlesticks", Wukong:"MonkeyKing", KhaZix:"Khazix", VelKoz:"Velkoz", ChoGath:"Chogath", KaiSa:"Kaisa", LeBlanc:"Leblanc", DrMundo:"DrMundo", Nunu:"Nunu", Renata:"Renata", RekSai:"RekSai", KogMaw:"KogMaw", BelVeth:"Belveth", TahmKench:"TahmKench" };
const ITEM_DB = { byId:{} };

function champIcon(name){ const fixed = NAME_FIX[name] || name; return `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/champion/${encodeURIComponent(fixed)}.png`; }
function itemIcon(id){ return !id||id===0 ? "" : `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/item/${id}.png`; }

async function initDDragon(){
  try {
    const r = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
    if (r.ok){ const a = await r.json(); if (a?.[0]) DD_VERSION = a[0]; }
  } catch {}
  try {
    const r = await fetch(`https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/data/en_US/item.json`);
    if (r.ok){ const data = await r.json(); ITEM_DB.byId = data.data || {}; }
  } catch {}
}
function itemName(id){ const rec = ITEM_DB.byId?.[String(id)]; return rec ? rec.name : `Item ${id}`; }

// --- Augments mapping ---
// Riot returns either numeric IDs or strings for Arena augments.
// We'll prettify strings and map common numeric IDs. Unknowns get a friendly fallback.
const AUGMENT_MAP = {
  // (Examples; extend over time)
  6021: "Blunt Force",
  6022: "Heavy Hitter",
  6031: "Goliath",
  6041: "Bread & Butter",
  6051: "Scoped Weapons",
  6061: "Restless Restoration",
  6071: "Infernal Conduit",
  6081: "Rabble Rousing",
  6091: "Lucky Clover",
  6101: "Kleptomancy",
};
function prettifyAugment(raw){
  if (!raw && raw !== 0) return null;
  if (typeof raw === "number") return AUGMENT_MAP[raw] || `Augment #${raw}`;
  // strings like "Arena_Mastery_FleetFootwork" -> "Fleet Footwork"
  const s = String(raw).replace(/^Arena[_-]?/i, "").replace(/^Mastery[_-]?/i,"").replace(/^Augment[_-]?/i,"").replace(/[_-]+/g," ").trim();
  // capitalize nice
  return s.split(" ").map(w=> w.length ? w[0].toUpperCase()+w.slice(1) : w).join(" ");
}

// --- Utils ---
function api(pathAndQuery){
  const base = API_BASE.replace(/\/+$/, "");
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  return `${base}${path}`;
}
async function fetchJSON(url){ const r = await fetch(url); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
function ordinal(n){ if(n===1) return "1st"; if(n===2) return "2nd"; if(n===3) return "3rd"; if(!Number.isFinite(n)) return "?"; return `${n}th`; }
function timeStr(ts){
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return "—"; }
}
function secondsToMin(s){
  if (!Number.isFinite(s)) return "—";
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return `${m}m ${sec}s`;
}
function linkToProfile(nameTag, uiRegionGuess){
  const base = new URL(location.href.replace(/[^/]*$/, ""));
  const url = new URL("index.html", base);
  url.searchParams.set("id", nameTag);
  if (uiRegionGuess) url.searchParams.set("region", uiRegionGuess.toUpperCase());
  return url.toString();
}
function routingToUI(r){ const v=(r||"").toLowerCase(); if (v==="americas") return "NA"; return "EUW"; }

function makeNameTag(p){
  // Prefer riotId fields; fallback to summonerName
  if (p.riotIdGameName && p.riotIdTagline) return `${p.riotIdGameName}#${p.riotIdTagline}`;
  return p.summonerName || "Unknown";
}

// Team grouping for Arena: group by placement, then pair players (2 per team)
function groupDuoTeams(parts){
  const normPlace = (p)=> p.placement ?? p.challenges?.arenaPlacement ?? 99;
  const sorted = parts.slice().sort((a,b)=> normPlace(a) - normPlace(b));
  const groups = [];
  for (let i=0;i<sorted.length;i+=2){
    const a = sorted[i], b = sorted[i+1];
    groups.push([a, b].filter(Boolean));
  }
  return groups;
}

// --- Renderers ---
function renderSummary(match, focus){
  const info = match?.info || {};
  const started = info.gameStartTimestamp ? timeStr(info.gameStartTimestamp) : "—";
  const dur = info.gameDuration ? secondsToMin(info.gameDuration) : "—";
  const q = info.queueId ?? "—";

  let focusRow = null;
  if (focus) {
    focusRow = {
      champ: focus.championName || "—",
      placement: focus.placement ?? focus.challenges?.arenaPlacement ?? null,
    };
  }

  const placeBadge =
    focusRow && Number.isFinite(focusRow.placement)
      ? `<span class="badge ${focusRow.placement===1?'p1':focusRow.placement===2?'p2':focusRow.placement===3?'p3':'px'}">${ordinal(focusRow.placement)}</span>`
      : "";

  card.innerHTML = `
    <div class="match-summary">
      <div class="left">
        <h2>Match <span class="muted">${match.metadata?.matchId || ""}</span></h2>
        <div class="muted">Queue ${q} • ${started} • Duration ${dur}</div>
      </div>
      <div class="right">
        ${focusRow ? `<div class="pill">You played <strong>${focusRow.champ}</strong> ${placeBadge}</div>` : ""}
      </div>
    </div>
  `;
}

function renderTeams(match, focusId){
  const info = match?.info || {};
  const parts = info.participants || [];
  const normPlace = (p)=> p.placement ?? p.challenges?.arenaPlacement ?? 99;

  const teams = groupDuoTeams(parts);
  const myPlace = parts.find(p=>p.puuid===focusId) ? normPlace(parts.find(p=>p.puuid===focusId)) : null;

  teamsWrap.innerHTML = teams.map((team, idx)=>{
    const place = team.length ? normPlace(team[0]) : "?";
    return `
      <div class="team-card">
        <div class="team-head">
          <div class="team-rank">${ordinal(place)}</div>
        </div>
        <div class="team-body">
          ${team.map(p=>{
            const you = p.puuid === focusId;
            const ally = myPlace!=null && normPlace(p)===myPlace && !you;
            const tag = makeNameTag(p);
            const clickHref = linkToProfile(tag, uiRegion || routingToUI(routingRegion));
            const augments = [p.playerAugment1,p.playerAugment2,p.playerAugment3,p.playerAugment4]
              .filter(Boolean)
              .map(a => `<span class="badge sm" title="${typeof a==='number'?`ID ${a}`:a}">${prettifyAugment(a)}</span>`).join(" ");

            const items = [p.item0,p.item1,p.item2,p.item3,p.item4,p.item5,p.item6]
              .filter(v => Number.isFinite(v) && v>0)
              .map(id => `<img src="${itemIcon(id)}" alt="${id}" title="${itemName(id)}">`).join("");

            return `
              <a class="player ${you?'me':''} ${ally?'ally':''}" href="${clickHref}">
                <div class="row">
                  <img class="champ-ico" src="${champIcon(p.championName)}" alt="${p.championName}">
                  <div class="col">
                    <div class="pname">${tag}</div>
                    <div class="muted tiny">${p.championName} • ${p.kills}/${p.deaths}/${p.assists} KDA</div>
                    <div class="augments">${augments || `<span class="muted tiny">No augments</span>`}</div>
                    <div class="items small">${items}</div>
                  </div>
                  <div class="place ${you?'me':''}">${ordinal(normPlace(p))}</div>
                </div>
              </a>`;
          }).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function renderTable(match, focusId){
  const info = match?.info || {};
  const parts = (info.participants||[]).slice().sort((a,b)=>{
    const ap = a.placement ?? a.challenges?.arenaPlacement ?? 99;
    const bp = b.placement ?? b.challenges?.arenaPlacement ?? 99;
    return ap - bp;
  });

  tbody.innerHTML = parts.map((p, idx)=>{
    const isMe = p.puuid === focusId;
    const myPlace = parts.find(x=>x.puuid===focusId)?.placement ?? parts.find(x=>x.puuid===focusId)?.challenges?.arenaPlacement ?? null;
    const isAlly = myPlace!=null && (p.placement ?? p.challenges?.arenaPlacement ?? 0) === myPlace && !isMe;

    const placement = p.placement ?? p.challenges?.arenaPlacement ?? "?";
    const kda = `${p.kills ?? 0}/${p.deaths ?? 0}/${p.assists ?? 0}`;
    const dmg = p.totalDamageDealtToChampions ?? p.challenges?.teamDamagePercentage ?? 0;
    const gold = p.goldEarned ?? 0;

    const tag = makeNameTag(p);
    const prof = linkToProfile(tag, uiRegion || routingToUI(routingRegion));

    const items = [p.item0,p.item1,p.item2,p.item3,p.item4,p.item5,p.item6]
      .filter(v => Number.isFinite(v) && v > 0)
      .map(id => `<img src="${itemIcon(id)}" alt="${id}" title="${itemName(id)}" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border)">`).join("");

    const augments = [p.playerAugment1,p.playerAugment2,p.playerAugment3,p.playerAugment4]
      .filter(Boolean)
      .map(a => `<span class="badge sm" title="${typeof a==='number'?`ID ${a}`:a}">${prettifyAugment(a)}</span>`).join(" ");

    const rowCls = isMe ? "row-me" : (isAlly ? "row-ally" : "");
    const placeCls = placement===1?'p1':placement===2?'p2':placement===3?'p3':'px';

    return `<tr class="${rowCls}">
      <td>${idx+1}</td>
      <td><a class="link" href="${prof}">${tag}</a></td>
      <td class="row"><img src="${champIcon(p.championName)}" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border);margin-right:6px">${p.championName}</td>
      <td><span class="badge ${placeCls}">${ordinal(Number(placement))}</span></td>
      <td>${kda}</td>
      <td>${Number(gold).toLocaleString()}</td>
      <td>${Number.isFinite(dmg)?Number(dmg).toLocaleString():"—"}</td>
      <td>${items || "—"}</td>
      <td>${augments || "—"}</td>
    </tr>`;
  }).join("");
}

// --- Run ---
(async function(){
  if (!matchId){
    card.innerHTML = `<div class="muted">Missing match id.</div>`;
    return;
  }
  if (!uiRegion) uiRegion = routingToUI(routingRegion);

  // make the back link preserve region if present
  const back = new URL(location.href.replace(/[^/]*$/, ""));
  back.searchParams.set("region", uiRegion);
  backLink.href = back.toString();

  await initDDragon();

  try{
    const match = await fetchJSON(api(`/match?id=${encodeURIComponent(matchId)}${routingRegion?`&region=${routingRegion}`:""}`));
    const parts = match?.info?.participants || [];
    const me = parts.find(p => p.puuid === focusPuuid) || null;

    renderSummary(match, me);
    renderTeams(match, focusPuuid);
    renderTable(match, focusPuuid);
  } catch(err){
    card.textContent = err.message || "Failed to load match";
  }
})();

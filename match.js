// Match details — LoG-style cards + LIVE augment names/icons via CommunityDragon (no json to maintain)
const API_BASE = "https://arenaproxy.irenasthat.workers.dev"; // no trailing slash

// --- Params ---
const params = new URLSearchParams(location.search);
const matchId = params.get("id");
const focusPuuid = params.get("puuid");
const routingRegion = params.get("region") || ""; // americas/europe
let uiRegion = params.get("regionUI") || "";      // NA/EUW/EUNE for links

// --- DOM ---
const backLink = document.getElementById("back-link");
const card = document.getElementById("match-card");
const teamsWrap = document.getElementById("teams");
const tbody = document.querySelector("#match-table tbody");

// --- DDragon (items/champs) ---
let DD_VERSION = "15.16.1";
const NAME_FIX = { FiddleSticks:"Fiddlesticks", Wukong:"MonkeyKing", KhaZix:"Khazix", VelKoz:"Velkoz", ChoGath:"Chogath", KaiSa:"Kaisa", LeBlanc:"Leblanc", DrMundo:"DrMundo", Nunu:"Nunu", Renata:"Renata", RekSai:"RekSai", KogMaw:"KogMaw", BelVeth:"Belveth", TahmKench:"TahmKench" };
const ITEM_DB = { byId:{} };

function champIcon(name){ const fixed = NAME_FIX[name] || name; return `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/champion/${encodeURIComponent(fixed)}.png`; }
function itemIcon(id){ return !id||id===0 ? "" : `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/item/${id}.png`; }
function itemName(id){ const rec = ITEM_DB.byId?.[String(id)]; return rec ? rec.name : `Item ${id}`; }

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

// --- CommunityDragon Augments ---
const CDRAGON_BASE = "https://raw.communitydragon.org/latest";
const AUG_DB = { byId: new Map(), byKey: new Map() };

/**
 * We try a few well-known CDragon endpoints for Arena augments.
 * If an endpoint changes, the others still make this robust.
 */
async function loadAugmentsFromCDragon(){
  const candidates = [
    // Most accurate for Arena augments (preferred):
    `${CDRAGON_BASE}/plugins/rcp-be-lol-game-data/global/default/v1/arena-augments.json`,
    // Older / backup datasets people mirror:
    `${CDRAGON_BASE}/plugins/rcp-be-lol-game-data/global/default/v1/augments.json`,
    // Runes (in case some augments come through as rune-like keys):
    `${CDRAGON_BASE}/plugins/rcp-be-lol-game-data/global/default/v1/perks.json`
  ];

  for (const url of candidates){
    try{
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const data = await r.json();
      ingestAugments(data);
    } catch {}
  }
}

function ingestAugments(data){
  // We accept either Array or Object maps; try to be flexible with field names.
  const arr = Array.isArray(data) ? data : Object.values(data || {});
  for (const a of arr){
    const id   = a.id ?? a.augmentId ?? a.gameModifierId ?? null;
    const key  = a.nameId ?? a.tftId ?? a.apiName ?? a.inventoryIcon ?? a.icon ?? a.contentId ?? null;
    const name = a.name ?? a.localizedName ?? a.displayName ?? a.title ?? null;
    const desc = a.desc ?? a.tooltip ?? a.description ?? a.longDesc ?? null;
    const iconPath = a.iconPath ?? a.iconLargePath ?? a.icon ?? a.augmentIcon ?? null;
    const icon = iconPath ? (CDRAGON_BASE + (iconPath.startsWith("/") ? iconPath : "/" + iconPath)).toLowerCase() : null;

    const rec = { id, key, name, desc, icon };
    if (id != null && !AUG_DB.byId.has(Number(id))) AUG_DB.byId.set(Number(id), rec);
    if (key && !AUG_DB.byKey.has(String(key)))      AUG_DB.byKey.set(String(key), rec);
  }
}

function prettifyAugString(raw){
  const s = String(raw).replace(/^arena[_-]?/i,"")
                       .replace(/^mastery[_-]?/i,"")
                       .replace(/^augment[_-]?/i,"")
                       .replace(/[_-]+/g," ").trim();
  return s.split(" ").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

function lookupAug(raw){
  if (raw == null) return null;

  // Numeric id
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && AUG_DB.byId.size){
    const rec = AUG_DB.byId.get(asNum);
    if (rec) return rec;
  }

  // Exact key
  if (AUG_DB.byKey.size){
    const rec = AUG_DB.byKey.get(String(raw));
    if (rec) return rec;
  }

  // Fallback: prettify string token
  return { name: typeof raw === "string" ? prettifyAugString(raw) : `Augment #${raw}` };
}

// --- Utils ---
function api(pathAndQuery){
  const base = API_BASE.replace(/\/+$/, "");
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  return `${base}${path}`;
}
async function fetchJSON(url){ const r = await fetch(url); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
function ordinal(n){ if(n===1) return "1st"; if(n===2) return "2nd"; if(n===3) return "3rd"; if(!Number.isFinite(n)) return "?"; return `${n}th`; }
function timeStr(ts){ try { return new Date(ts).toLocaleString(); } catch { return "—"; } }
function secondsToMin(s){ if (!Number.isFinite(s)) return "—"; const m=Math.floor(s/60), sec=Math.floor(s%60); return `${m}m ${sec}s`; }
function routingToUI(r){ const v=(r||"").toLowerCase(); if (v==="americas") return "NA"; return "EUW"; }
function linkToProfile(nameTag, uiRegionGuess){
  const base = new URL(location.href.replace(/[^/]*$/, ""));
  const url = new URL("app.html", base);
  url.searchParams.set("id", nameTag);
  if (uiRegionGuess) url.searchParams.set("region", uiRegionGuess.toUpperCase());
  return url.toString();
}

function makeNameTag(p){ return (p.riotIdGameName && p.riotIdTagline) ? `${p.riotIdGameName}#${p.riotIdTagline}` : (p.summonerName || "Unknown"); }

function normPlace(p){ return p.placement ?? p.challenges?.arenaPlacement ?? 99; }
function groupDuoTeams(parts){
  const sorted = parts.slice().sort((a,b)=> normPlace(a) - normPlace(b));
  const out = [];
  for (let i=0;i<sorted.length;i+=2) out.push([sorted[i], sorted[i+1]].filter(Boolean));
  return out;
}

// --- Renderers ---
function renderSummary(match, focus){
  const info = match?.info || {};
  const started = info.gameStartTimestamp ? timeStr(info.gameStartTimestamp) : "—";
  const dur = info.gameDuration ? secondsToMin(info.gameDuration) : "—";
  const q = info.queueId ?? "—";
  const myPlace = focus ? normPlace(focus) : null;
  const placeBadge = Number.isFinite(myPlace)
    ? `<span class="badge ${myPlace===1?'p1':myPlace===2?'p2':myPlace===3?'p3':'px'}">${ordinal(myPlace)}</span>` : "";

  card.innerHTML = `
    <div class="match-summary">
      <div class="left">
        <h2>Match <span class="muted">${match.metadata?.matchId || ""}</span></h2>
        <div class="muted">Queue ${q} • ${started} • Duration ${dur}</div>
      </div>
      <div class="right">
        ${focus ? `<div class="pill">You played <strong>${focus.championName}</strong> ${placeBadge}</div>` : ""}
      </div>
    </div>
  `;
}

function teamColorClass(place){
  if (place===1) return "team-gold";
  if (place===2) return "team-red";
  if (place===3) return "team-purple";
  if (place===4) return "team-blue";
  if (place===5) return "team-green";
  if (place===6) return "team-pink";
  if (place===7) return "team-brown";
  return "team-gray";
}

function renderTeams(match, focusId){
  const parts = match?.info?.participants || [];
  const pairs = groupDuoTeams(parts);

  teamsWrap.innerHTML = pairs.map(team=>{
    const place = team.length ? normPlace(team[0]) : 99;
    const colorCls = teamColorClass(place);
    return `
      <div class="team-card ${colorCls}">
        <div class="team-head">
          <div class="team-rank">${ordinal(place)}</div>
        </div>
        <div class="team-body">
          ${team.map(p=>{
            const you  = p.puuid === focusId;
            const tag  = makeNameTag(p);
            const href = linkToProfile(tag, uiRegion || routingToUI(routingRegion));

            const augBadges = [p.playerAugment1,p.playerAugment2,p.playerAugment3,p.playerAugment4]
              .filter(Boolean)
              .map(a => {
                const rec = lookupAug(a);
                const title = [rec.name, rec.desc].filter(Boolean).join(" — ");
                const icon = rec.icon ? `<img class="aug-ico" src="${rec.icon}" alt="${rec.name}" title="${title}">` : "";
                return icon ? icon : `<span class="badge sm" title="${title}">${rec.name}</span>`;
              }).join("");

            const items = [p.item0,p.item1,p.item2,p.item3,p.item4,p.item5,p.item6]
              .filter(v => Number.isFinite(v) && v>0)
              .map(id => `<img src="${itemIcon(id)}" alt="${id}" title="${itemName(id)}">`).join("");

            return `
              <a class="player ${you?'me':''}" href="${href}">
                <div class="row">
                  <img class="champ-ico" src="${champIcon(p.championName)}" alt="${p.championName}">
                  <div class="col">
                    <div class="topline"><span class="pname">${tag}</span></div>
                    <div class="muted tiny">${p.championName} • ${p.kills}/${p.deaths}/${p.assists} KDA</div>
                    <div class="augments">${augBadges || `<span class="muted tiny">No augments</span>`}</div>
                    <div class="items small">${items}</div>
                  </div>
                  <div class="place">${ordinal(normPlace(p))}</div>
                </div>
              </a>`;
          }).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function renderTable(match, focusId){
  const parts = (match?.info?.participants||[]).slice().sort((a,b)=> normPlace(a) - normPlace(b));

  tbody.innerHTML = parts.map((p, idx)=>{
    const isMe = p.puuid === focusId;
    const placement = normPlace(p);
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
      .map(a => {
        const rec = lookupAug(a);
        const title = [rec.name, rec.desc].filter(Boolean).join(" — ");
        return rec.icon
          ? `<img class="aug-ico" src="${rec.icon}" alt="${rec.name}" title="${title}">`
          : `<span class="badge sm" title="${title}">${rec.name}</span>`;
      }).join(" ");

    const placeCls = placement===1?'p1':placement===2?'p2':placement===3?'p3':'px';

    return `<tr class="${isMe ? "row-me" : ""}">
      <td>${idx+1}</td>
      <td><a class="link" href="${prof}">${tag}</a></td>
      <td class="row"><img src="${champIcon(p.championName)}" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border);margin-right:6px">${p.championName}</td>
      <td><span class="badge ${placeCls}">${ordinal(placement)}</span></td>
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

  // back link keeps region
  const back = new URL(location.href.replace(/[^/]*$/, ""));
  back.searchParams.set("region", uiRegion);
  backLink.href = back.toString();

  await Promise.all([initDDragon(), loadAugmentsFromCDragon()]);

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

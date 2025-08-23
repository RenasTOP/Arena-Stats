// Match details — layout compacto + tooltips e augments robustos via CDragon
const API_BASE = "https://arenaproxy.irenasthat.workers.dev";

// --- Params ---
const params = new URLSearchParams(location.search);
const matchId = params.get("id");
const focusPuuid = params.get("puuid");
const routingRegion = params.get("region") || ""; // americas/europe
let uiRegion = params.get("regionUI") || "";      // NA/EUW/EUNE para links

// --- DOM ---
const backLink = document.getElementById("back-link");
const card = document.getElementById("match-card");
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

/** Fontes que costumam alinhar com playerAugment*:
 *  - game-modifiers.json (tem gameModifierId numérico)
 *  - arena-augments.json / augments.json / perks.json (fallbacks)
 */
async function loadAugmentsFromCDragon(){
  const candidates = [
    `${CDRAGON_BASE}/plugins/rcp-be-lol-game-data/global/default/v1/game-modifiers.json`,
    `${CDRAGON_BASE}/plugins/rcp-be-lol-game-data/global/default/v1/arena-augments.json`,
    `${CDRAGON_BASE}/plugins/rcp-be-lol-game-data/global/default/v1/augments.json`,
    `${CDRAGON_BASE}/plugins/rcp-be-lol-game-data/global/default/v1/perks.json`,
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
  const arr = Array.isArray(data) ? data : Object.values(data || {});
  for (const a of arr){
    let id = a.id ?? a.augmentId ?? a.gameModifierId ?? a.tftId ?? null;
    if (typeof id === "string" && /^\d+$/.test(id)) id = Number(id);

    const key  = a.nameId ?? a.apiName ?? a.inventoryIcon ?? a.icon ?? a.contentId ?? null;
    const name = a.name ?? a.localizedName ?? a.displayName ?? a.title ?? null;
    const desc = a.desc ?? a.tooltip ?? a.description ?? a.longDesc ?? null;
    const iconPath = a.iconPath ?? a.iconLargePath ?? a.icon ?? a.augmentIcon ?? a.inventoryIcon ?? null;
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

  // Numeric id (preferido)
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

  // Fallback
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

function renderTable(match, focusId){
  const info = match?.info || {};
  const durSec = Number(info.gameDuration) || null;
  const parts = (info.participants||[]).slice().sort((a,b)=> normPlace(a) - normPlace(b));

  tbody.innerHTML = parts.map((p, idx)=>{
    const isMe = p.puuid === focusId;
    const placement = normPlace(p);
    const k = p.kills ?? 0, d = p.deaths ?? 0, a = p.assists ?? 0;
    const kdaRatio = ((k + a) / Math.max(1, d)).toFixed(2);
    const dmg = Number(p.totalDamageDealtToChampions ?? p.challenges?.teamDamagePercentage ?? 0);
    const dmgShare = Number(p.challenges?.teamDamagePercentage ?? 0) * 100; // já pode vir em fracção
    const showShare = Number.isFinite(p.challenges?.teamDamagePercentage);
    const gold = Number(p.goldEarned ?? 0);
    const gpm = durSec ? Math.round((gold / durSec) * 60) : null;

    const tag = makeNameTag(p);
    const prof = linkToProfile(tag, uiRegion || routingToUI(routingRegion));

    const items = [p.item0,p.item1,p.item2,p.item3,p.item4,p.item5,p.item6]
      .filter(v => Number.isFinite(v) && v > 0)
      .map(id => `<img src="${itemIcon(id)}" alt="${itemName(id)}" title="${itemName(id)}" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border);margin-right:4px">`).join("");

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
    const kdaTitle = `KDA ratio ${(kdaRatio)}\nKills ${k} • Deaths ${d} • Assists ${a}`;
    const dmgTitle = showShare ? `${Math.round(dmg).toLocaleString()} dmg • ${Math.round(dmgShare)}% of team` : `${Math.round(dmg).toLocaleString()} dmg`;
    const goldTitle = gpm != null ? `${gold.toLocaleString()} gold • ${gpm} GPM` : `${gold.toLocaleString()} gold`;

    const allySamePlace = parts.find(q => q.puuid !== p.puuid && normPlace(q) === placement);
    const rowClass = isMe ? "row-me" : (allySamePlace && focusId && allySamePlace.puuid===focusId ? "row-ally" : "");

    return `<tr class="${rowClass}">
      <td>${idx+1}</td>
      <td><a class="link" href="${prof}">${tag}</a></td>
      <td class="row"><img src="${champIcon(p.championName)}" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border);margin-right:6px" alt="${p.championName}">${p.championName}</td>
      <td><span class="badge ${placeCls}">${ordinal(placement)}</span></td>
      <td title="${kdaTitle}">${k}/${d}/${a}</td>
      <td title="${goldTitle}">${gold.toLocaleString()}</td>
      <td title="${dmgTitle}">${Number.isFinite(dmg)?Math.round(dmg).toLocaleString():"—"}</td>
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

  // back link mantém região
  const back = new URL(location.href.replace(/[^/]*$/, "")); back.searchParams.set("region", uiRegion); backLink.href = back.toString();

  await Promise.all([initDDragon(), loadAugmentsFromCDragon()]);

  try{
    const match = await fetchJSON(api(`/match?id=${encodeURIComponent(matchId)}${routingRegion?`&region=${routingRegion}`:""}`));
    const parts = match?.info?.participants || [];
    const me = parts.find(p => p.puuid === focusPuuid) || null;

    renderSummary(match, me);
    renderTable(match, focusPuuid);
  } catch(err){
    card.textContent = err.message || "Failed to load match";
  }
})();

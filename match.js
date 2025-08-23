const API_BASE = "https://arenaproxy.irenasthat.workers.dev";

let DD_VERSION = "15.16.1";
const NAME_FIX = { FiddleSticks:"Fiddlesticks", Wukong:"MonkeyKing", KhaZix:"Khazix", VelKoz:"Velkoz", ChoGath:"Chogath", KaiSa:"Kaisa", LeBlanc:"Leblanc", DrMundo:"DrMundo", Nunu:"Nunu", Renata:"Renata", RekSai:"RekSai", KogMaw:"KogMaw", BelVeth:"Belveth", TahmKench:"TahmKench" };
async function initDDragon(){ try{ const r=await fetch("https://ddragon.leagueoflegends.com/api/versions.json"); if(r.ok){ const a=await r.json(); if(a?.[0]) DD_VERSION=a[0]; } }catch{} }
function champIcon(name){ const fixed = NAME_FIX[name] || name; return `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/champion/${encodeURIComponent(fixed)}.png`; }
function itemIcon(id){ return !id||id===0 ? "" : `https://ddragon.leagueoflegends.com/cdn/${DD_VERSION}/img/item/${id}.png`; }
function ordinal(n){ if(n===1) return "1st"; if(n===2) return "2nd"; if(n===3) return "3rd"; if(!Number.isFinite(n)) return "?"; return `${n}th`; }

const params = new URLSearchParams(location.search);
const matchId = params.get("id");
const puuid = params.get("puuid");
const region = params.get("region") || "";

const card = document.getElementById("match-card");
const tbody = document.querySelector("#match-table tbody");

(async function(){
  if (!matchId){ card.textContent="Missing match id"; return; }
  await initDDragon();

  try{
    const r = await fetch(`${API_BASE.replace(/\/+$/,"")}/match?id=${encodeURIComponent(matchId)}${region?`&region=${region}`:""}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const match = await r.json();
    render(match);
  } catch(err){
    card.textContent = err.message || "Failed to load match";
  }
})();

function render(match){
  const info = match?.info || {};
  const started = info.gameStartTimestamp ? new Date(info.gameStartTimestamp).toLocaleString() : "?";
  const q = info.queueId ?? "?";
  const dur = info.gameDuration ? `${Math.floor(info.gameDuration/60)}m ${info.gameDuration%60}s` : "—";

  card.innerHTML = `<h2>Match ${match.metadata?.matchId || ""}</h2>
    <div class="muted">Queue ${q} • ${started} • Duration ${dur}</div>`;

  const parts = (info.participants||[]).slice().sort((a,b)=>(a.placement??a.challenges?.arenaPlacement??99)-(b.placement??b.challenges?.arenaPlacement??99));
  tbody.innerHTML = parts.map(p=>{
    const me = puuid && p.puuid===puuid ? "row-me":"";
    const placement = p.placement ?? p.challenges?.arenaPlacement ?? "?";
    const kda = `${p.kills ?? 0}/${p.deaths ?? 0}/${p.assists ?? 0}`;
    const dmg = p.totalDamageDealtToChampions ?? p.challenges?.teamDamagePercentage ?? 0;
    const gold = p.goldEarned ?? 0;
    const items = [p.item0,p.item1,p.item2,p.item3,p.item4,p.item5,p.item6].filter(v=>Number.isFinite(v)&&v>0).map(id=>`<img src="${itemIcon(id)}" alt="${id}" style="width:22px;height:22px;border-radius:4px;border:1px solid var(--border)">`).join("");
    const augments = [p.playerAugment1,p.playerAugment2,p.playerAugment3,p.playerAugment4].filter(Boolean).map(a=>`<span class="badge sm">${a}</span>`).join(" ");
    return `<tr class="${me}">
      <td class="row"><img src="${champIcon(p.championName)}" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border);margin-right:6px">${p.championName}</td>
      <td>${ordinal(Number(placement))}</td>
      <td>${kda}</td>
      <td>${Number(gold).toLocaleString()}</td>
      <td>${Number.isFinite(dmg)?Number(dmg).toLocaleString():"?"}</td>
      <td>${items}</td>
      <td>${augments}</td>
    </tr>`;
  }).join("");
}

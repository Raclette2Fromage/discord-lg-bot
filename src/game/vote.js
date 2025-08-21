import { ActionRowBuilder, StringSelectMenuBuilder, ComponentType, ButtonBuilder, ButtonStyle } from "discord.js";
import { sleep } from "./utils.js";


export async function startVote({ channel, title, voters, candidates, durationMs=45000, mode="plurality", tie="random", secret=false }){
// Simple sélecteur (1 choix). secret=false: bulletin public; secret=true: DM individuel (non utilisé ici pour le village)
const options = candidates.map(p=>({ label: p.user.username, value: p.id }));
const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("vote").setPlaceholder(title).addOptions(options));
const msg = await channel.send({ content: `🗳️ ${title}\nTemps: ${(durationMs/1000)|0}s`, components: [row] });


const votes = new Map();
const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: durationMs });
collector.on("collect", async (i)=>{
const uid = i.user.id;
if (!voters.find(v=>v.id===uid)) return i.reply({ content:"❌ Vous ne pouvez pas voter ici.", ephemeral:true });
votes.set(uid, i.values[0]);
await i.reply({ content:"✅ Vote pris en compte.", ephemeral:true });
});
await sleep(durationMs);
collector.stop("time");


// Décompte
const tally = new Map();
for (const [,cid] of votes) tally.set(cid, (tally.get(cid)||0)+1);


// Résultat
let max = -1, winners=[];
for (const c of candidates){ const n = tally.get(c.id)||0; if (n>max){ max=n; winners=[c]; } else if (n===max){ winners.push(c); } }
if (winners.length===0) return null;
if (winners.length===1) return winners[0];
if (tie==="random") return winners[Math.floor(Math.random()*winners.length)];
// autres modes à ajouter (revote), mais par défaut random
return winners[Math.floor(Math.random()*winners.length)];
}

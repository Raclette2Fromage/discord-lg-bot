import { ChannelType, PermissionsBitField } from "discord.js";
// Révélation à la mort
if (this.config.options.reveal==="on_death"){
await this.lobby.send(`☠️ ${this.nameOf(id)} — ${label(p.roleKey)} (${labelAlign(ROLE_CATALOG[p.roleKey].align)}) — mort (${this.causeText(cause)})`);
} else {
await this.lobby.send(`☠️ ${this.nameOf(id)} — mort (${this.causeText(cause)})`);
}


// Mort de chagrin
if (p.loverId){ const lover = this.players.find(x=>x.id===p.loverId); if (lover && lover.alive){ await this.kill(lover.id, { cause:"chagrin" }); } }
}


causeText(c){
const map = { loups:"Loups", village:"vote du Village", sorciere:"Sorcière", chasseur:"Chasseur", loup_blanc:"Loup Blanc", chagrin:"mort de chagrin" };
return map[c]||c;
}


lastDeathsText(){
// retourne concat des morts depuis fin du dernier jour; MVP: on affiche dernières entrées de this.deaths (dans ce prototype, une nuit = 0/1 mort typiquement)
if (this.deaths.length===0) return ""; const last = this.deaths.slice(-2).map(d=> this.nameOf(d.id)).join(", "); return `Morts cette nuit: **${last}**`;
}


async resolveChasseur(ch){
const targets = this.alive().filter(x=>x.id!==ch.id); if (targets.length===0) return;
const t = pickRandom(targets);
await this.kill(t.id, { cause:"chasseur" });
}


toggleDeadTalk(day){
// Jour: morts muets; Nuit: morts parlent; Shaman parle tout le temps
if (!this.channels.dead) return;
const overwrites = [ { id: this.guild.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] }, { id: this.client.user.id, allow: VIEW_WRITE } ];
for (const p of this.players){
if (!p.alive){ overwrites.push({ id:p.id, allow: day? []: VIEW_WRITE }); }
if (p.roleKey==="shaman"){ overwrites.push({ id:p.id, allow: VIEW_WRITE }); }
}
this.channels.dead.permissionOverwrites.set(overwrites);
}


winCheck(){
const alive = this.alive();
const wolves = alive.filter(p=>isWolf(p.roleKey)).length;
const vill = alive.length - wolves; // ignore neutres pour MVP
if (wolves===0) return { done:true, winner: ALIGN.VILLAGE };
if (wolves>=vill) return { done:true, winner: ALIGN.WOLF };
return { done:false };
}


async endGame(winner){
this.state="ended";
// Récap: trier morts par ancien -> récent, puis vivants
const deadIds = this.deaths.map(d=>d.id);
const deadSet = new Set(deadIds);
const list = [ ...deadIds.map(id=> this.players.find(p=>p.id===id)), ...this.players.filter(p=>!deadSet.has(p.id)) ];


const heart = (p)=> p.loverId? "❤️ ":"";
const lines = list.map(p=> `${heart(p)}${this.nameOf(p.id)} — ${label(p.roleKey)} (${labelAlign(ROLE_CATALOG[p.roleKey].align)}) — ${p.alive?"vivant":`mort (${this.causeText(this.deaths.find(d=>d.id===p.id)?.cause||"?")})`}` ).join("\n");


await this.lobby.send(`🏁 **Fin de partie** — Vainqueur: **${winner===ALIGN.WOLF?"Loups":"Village"}**\n\n${lines}`);
await this.stop();
}


async stop(){
try{ await this.channels.wolves?.delete("cleanup"); }catch{}
try{ await this.channels.dead?.delete("cleanup"); }catch{}
try{ await this.channels.sisters?.delete("cleanup"); }catch{}
try{ await this.channels.brothers?.delete("cleanup"); }catch{}
this.state="ended";
}
}

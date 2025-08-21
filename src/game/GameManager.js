import { ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, StringSelectMenuBuilder } from "discord.js";
import { ROLE_CATALOG, ALIGN, isWolf } from "./roles.js";
import { VIEW_WRITE } from "../util/perms.js";
import { shuffleArray, sleep, pickRandom } from "./utils.js";
import { DM_TEMPLATES, label, labelAlign } from "./texts.js";

export class GameManager {
  static fromChannel(client, channelId) { return client.games.get(channelId); }

  static async createLobby(client, guild, ownerUser) {
    const catName = client.config.categoryName || "loup-garou";
    let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === catName);
    if (!category) {
      category = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory });
    }
    const lobbyName = `${client.config.channels?.lobbyPrefix || "lg-lobby-"}${ownerUser.username.toLowerCase().slice(0,60)}`;
    const lobby = await guild.channels.create({ name: lobbyName, type: ChannelType.GuildText, parent: category.id });

    const gm = new GameManager(client, guild, lobby);
    client.games.set(lobby.id, gm);
    await lobby.send("🎲 **Lobby Loup-Garou** ouvert.\nUtilisez `/lg join`, puis `/lg config`, puis `/lg start`.");
    return gm;
  }

  constructor(client, guild, lobby) {
    this.client = client; this.guild = guild; this.lobby = lobby;
    this.players = []; // {id,user,roleKey,alive,canVote,loverId,seat}
    this.state = "lobby";

    this.config = { total: 0, counts: {}, options: { ...(client.config?.options || {}) } };
    this.channels = { wolves: null, dead: null, sisters: null, brothers: null };
    this.table = [];
    this.nightIndex = 0;
    this.deaths = []; // {id,cause,nightIndex}

    // Petite-Fille
    this.pfRevealed = false; this.pfSpyActive = false; this.pfSpiedThisNight = false; this._wolvesRelayListener = null;

    // Cupidon / couple
    this.cupidonId = null; this.coupleIds = []; // [a,b]

    // Voyante bavarde
    this._bavardeReveals = []; // [{targetId, roleKey}]

    // Salvateur
    this.salvateurLast = null; this.salvateurTonight = null;

    // Sorcière
    this.witchLifeAvailable = true; this.witchDeathAvailable = true;

    // Infect Père des Loups
    this.infectUsed = false;

    // Joueur de Flûte
    this.fluteCharmed = new Set();

    // Divers
    this.captainId = null;
  }

  // ---------- helpers ----------
  nameOf(id){ return this.players.find(x=>x.id===id)?.user?.username || `<${id}>`; }
  alive(){ return this.players.filter(p=>p.alive); }
  getPlayer(id){ return this.players.find(p=>p.id===id) || null; }
  roleOf(id){ return this.players.find(p=>p.id===id)?.roleKey || null; }

  livingNeighbors(id){
    if (!this.table.length) return [];
    const idx = this.table.indexOf(id); if (idx === -1) return [];
    const n = this.table.length;

    let left = (idx - 1 + n) % n;
    while (left !== idx && !this.getPlayer(this.table[left])?.alive) left = (left - 1 + n) % n;

    let right = (idx + 1) % n;
    while (right !== idx && !this.getPlayer(this.table[right])?.alive) right = (right + 1) % n;

    const res = [];
    if (left !== idx) res.push(this.getPlayer(this.table[left]));
    if (right !== idx) res.push(this.getPlayer(this.table[right]));
    return res.filter(Boolean);
  }

  // ---------- UI helpers (DM menus/boutons) ----------
  async dmConfirm(user, content, { yesLabel="Oui", noLabel="Non", timeoutMs=30000, includeSkip=true } = {}){
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("yes").setLabel(yesLabel).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("no").setLabel(noLabel).setStyle(ButtonStyle.Secondary),
      ...(includeSkip ? [new ButtonBuilder().setCustomId("skip").setLabel("⏭️ Passer").setStyle(ButtonStyle.Danger)] : [])
    );
    try{
      const msg = await user.send({ content, components: [row] });
      const i = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: timeoutMs }).catch(()=>null);
      if (!i) { try{ await msg.edit({ content: `${content}\n\n⏳ *Temps écoulé.*`, components: [] }); }catch{}; return { choice: "timeout" }; }
      await i.update({ content: `${content}\n\n✅ Choix: **${i.customId}**`, components: [] });
      return { choice: i.customId };
    }catch{ return { choice: "fail" }; }
  }

  async dmSelect(user, content, options, { minValues=1, maxValues=1, timeoutMs=30000, placeholder="Choisir...", includeSkip=true } = {}){
    // options: [{ label, value }]
    const select = new StringSelectMenuBuilder()
      .setCustomId("sel")
      .setPlaceholder(placeholder)
      .setMinValues(minValues)
      .setMaxValues(maxValues)
      .addOptions(options.slice(0, 25)); // limite Discord

    const row1 = new ActionRowBuilder().addComponents(select);
    const row2 = includeSkip
      ? new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("skip").setLabel("⏭️ Passer").setStyle(ButtonStyle.Danger))
      : null;

    try{
      const msg = await user.send({ content, components: row2 ? [row1, row2] : [row1] });
      const i = await msg.awaitMessageComponent({ time: timeoutMs }).catch(()=>null);
      if (!i) { try{ await msg.edit({ content: `${content}\n\n⏳ *Temps écoulé.*`, components: [] }); }catch{}; return { choice: "timeout" }; }
      if (i.customId === "skip"){
        await i.update({ content: `${content}\n\n⏭️ Passé.`, components: [] });
        return { choice: "skip" };
      }
      const values = i.values || [];
      await i.update({ content: `${content}\n\n✅ Sélection: ${values.map(v=>`\`${v}\``).join(", ")}`, components: [] });
      return { choice: "ok", values };
    }catch{ return { choice: "fail" }; }
  }

  // ---------- lobby ----------
  addPlayer(user){
    if (this.state !== "lobby") return { ok:false, msg:"⛔ Partie déjà démarrée." };
    if (this.players.find(p=>p.id===user.id)) return { ok:true, msg:"ℹ️ Déjà inscrit." };
    this.players.push({ id:user.id, user, roleKey:null, alive:true, canVote:true, loverId:null, seat:null });
    return { ok:true, msg:`✅ ${user} a rejoint. (${this.players.length} joueurs)` };
  }
  removePlayer(uid){
    if (this.state !== "lobby") return { ok:false, msg:"⛔ Partie déjà démarrée." };
    const i = this.players.findIndex(p=>p.id===uid); if (i===-1) return { ok:false, msg:"ℹ️ Non inscrit." };
    this.players.splice(i,1); return { ok:true, msg:`👋 Retiré. (${this.players.length} joueurs)` };
  }
  kickBeforeStart(uid){ return this.removePlayer(uid); }

  countsFromInteraction(interaction){
    const counts = {};
    for (const key of Object.keys(ROLE_CATALOG)){
      if (key === "villageois") continue;
      const v = interaction.options.getInteger(key);
      if (v !== null && v !== undefined) counts[key] = v;
    }
    return counts;
  }

  setConfig({ total, counts, options }){
    if (this.state !== "lobby") return { ok:false, msg:"⛔ Déjà démarré." };
    if (total < 4) return { ok:false, msg:"❌ Minimum 4 joueurs." };

    // compat seerMode (si vous préférez renseigner directement voyante/voyante_bavarde dans roles, ignorez ça)
    const mode = options?.seerMode ?? this.config.options.seerMode;
    if (mode){
      if (mode==="none"){ counts.voyante = 0; counts.voyante_bavarde = 0; }
      else if (mode==="classic"){ counts.voyante_bavarde = 0; }
      else if (mode==="chatty"){ counts.voyante = 0; }
    }

    if (counts.voleur) delete counts.voleur;

    const sum = Object.values(counts).reduce((a,b)=>a+(b||0),0);
    if (sum > total) return { ok:false, msg:"❌ Plus de rôles que de joueurs." };

    this.config.total = total;
    this.config.counts = Object.fromEntries(Object.entries(counts).filter(([,n])=>(n||0)>0));
    this.config.options = { ...this.config.options, ...options };
    return { ok:true, msg:`🧩 Configuration enregistrée.\n• Joueurs: **${total}**\n• Rôles assignés: **${sum}** (le reste = Villageois)` };
  }

  canStart(){
    if (this.state !== "lobby") return { ok:false, error:"Partie déjà démarrée." };
    if (this.players.length !== this.config.total) return { ok:false, error:`Il faut **${this.config.total}** joueurs (inscrits: ${this.players.length}).` };
    return { ok:true };
  }

  // ---------- start ----------
  async startGame(){
    this.state = "night0";
    shuffleArray(this.players); this.players.forEach((p,i)=>p.seat=i); this.table = this.players.map(p=>p.id);

    const comp = this.expandComposition(); shuffleArray(comp);
    this.players.forEach((p,i)=>p.roleKey = comp[i] || "villageois");

    for (const p of this.players){
      try{ await p.user.send(DM_TEMPLATES.role(p.roleKey, ROLE_CATALOG[p.roleKey].align, ROLE_CATALOG[p.roleKey].dmDesc||"")); }catch{}
    }

    // Cupidon / couple
    const cup = this.players.find(p=>p.roleKey==="cupidon"); this.cupidonId = cup?.id || null;
    await this.setupCoupleIfAny();

    // Sœurs / Frères (DM connaissance)
    await this.dmSiblingsKnowledge();

    // Salons
    await this.setupChannels();

    // boucle principale
    this.nightIndex = 1;
    while (true){
      await this.nightPhase();
      const w1 = this.winCheck(); if (w1.done) return this.endGame(w1.winner);

      await this.dayPhase();
      const w2 = this.winCheck(); if (w2.done) return this.endGame(w2.winner);

      this.nightIndex++;
    }
  }

  renderTable(){
    if (!this.table.length) return "Table non définie.";
    const names = this.table.map(id=>this.nameOf(id));
    return `🪑 **Ordre de table** : ${names.join(" → ")}`;
  }
  
  renderCompositionSummary() {
    const total = this.config.total || 0;
    const counts = this.config.counts || {};
    const sumAssigned = Object.values(counts).reduce((a,b)=> a+(b||0), 0);
    const villagers = Math.max(0, total - sumAssigned);

    const lines = [];
    for (const [k, n] of Object.entries(counts)) {
      if ((n || 0) > 0) lines.push(`- ${label(k)} ×${n}`);
    }
    if (villagers > 0) lines.push(`- ${label("villageois")} ×${villagers}`);

    return `🧩 **Composition** (${total} joueurs)\n${lines.join("\n") || "_(vide)_"}`
  }

  // ---------- composition ----------
  expandComposition(){
    const roles = [];
    for (const [k,n] of Object.entries(this.config.counts)){
      for (let i=0;i<n;i++) roles.push(k);
    }
    while (roles.length < this.config.total) roles.push("villageois");
    return roles;
  }

  // ---------- Cupidon / couple ----------
  async setupCoupleIfAny(){
    if (!this.cupidonId) return;
    const opt = this.config.options?.cupidon || {};
    const allowSelf = !!opt.allowSelf;
    const randomCouple = !!opt.randomCouple;

    if (!randomCouple) return; // (on garde simple pour l’instant : couple aléatoire)

    const pool = this.players.filter(p=>p.alive);
    let candidates = pool; if (!allowSelf) candidates = pool.filter(p=>p.id!==this.cupidonId);
    if (candidates.length < 2) return;

    shuffleArray(candidates);
    const a = candidates[0];
    const b = candidates.find(x=>x.id!==a.id);
    if (!b) return;

    a.loverId = b.id; b.loverId = a.id; this.coupleIds = [a.id,b.id];

    try{ await a.user.send(`❤️ Tu es **Amoureux** avec **${this.nameOf(b.id)}**. Si l’un meurt, l’autre meurt de chagrin.`);}catch{}
    try{ await b.user.send(`❤️ Tu es **Amoureux** avec **${this.nameOf(a.id)}**. Si l’un meurt, l’autre meurt de chagrin.`);}catch{}
    const cup = this.getPlayer(this.cupidonId);
    if (cup){ try{ await cup.user.send(`💘 **Couple formé** : ${this.nameOf(a.id)} ❤️ ${this.nameOf(b.id)}${(a.id===cup.id||b.id===cup.id)?" (tu en fais partie)":""}.`);}catch{} }
    await this.lobby.send("💘 Cupidon a décoché ses flèches… deux cœurs sont liés cette nuit.");
  }
  isCoupleAlive(){ if (!this.coupleIds?.length) return false; const [a,b]=this.coupleIds; const pa=this.getPlayer(a), pb=this.getPlayer(b); return !!(pa&&pb&&pa.alive&&pb.alive); }
  isCoupleMixed(){
    if (!this.coupleIds?.length) return false;
    const [a,b] = this.coupleIds; const pa=this.getPlayer(a), pb=this.getPlayer(b);
    if (!pa || !pb) return false;
    const aa = ROLE_CATALOG[pa.roleKey]?.align;
    const ab = ROLE_CATALOG[pb.roleKey]?.align;
    return aa && ab && aa !== ab;
  }

  // ---------- Sœurs / Frères (DM connaissance) ----------
  async dmSiblingsKnowledge(){
    const sisters = this.players.filter(p=>p.roleKey==="deux_soeurs");
    if (sisters.length >= 2){
      const names = sisters.map(p=>this.nameOf(p.id)).join(" & ");
      for (const s of sisters){ try{ await s.user.send(`👯 **Deux Sœurs** — Votre duo : ${names}`);}catch{} }
    }
    const brothers = this.players.filter(p=>p.roleKey==="trois_freres");
    if (brothers.length >= 2){
      const names = brothers.map(p=>this.nameOf(p.id)).join(" & ");
      for (const b of brothers){ try{ await b.user.send(`👨‍👨‍👦 **Trois Frères** — Votre trio : ${names}`);}catch{} }
    }
  }

  // ---------- salons ----------
  async setupChannels(){
    // Loups
    const wolves = this.players.filter(p=>isWolf(p.roleKey) && p.alive);
    if (wolves.length){
      const overwrites = [
        { id:this.guild.id, deny:[PermissionsBitField.Flags.ViewChannel] },
        { id:this.client.user.id, allow:VIEW_WRITE },
        ...wolves.map(w=>({ id:w.id, allow:VIEW_WRITE }))
      ];
      this.channels.wolves = await this.guild.channels.create({
        type: ChannelType.GuildText, parent: this.lobby.parentId,
        name: (this.client.config.channels?.wolvesPrefix || "lg-loups-") + this.lobby.name.split("-").pop(),
        permissionOverwrites: overwrites
      });
      await this.channels.wolves.send("🌙 **Salon des Loups** — discutez et votez chaque nuit.");
      this.disablePFRelay();
    }

    // Morts
    const overwritesDead = [
      { id:this.guild.id, deny:[PermissionsBitField.Flags.ViewChannel] },
      { id:this.client.user.id, allow:VIEW_WRITE }
    ];
    this.channels.dead = await this.guild.channels.create({
      type: ChannelType.GuildText, parent: this.lobby.parentId,
      name: (this.client.config.channels?.deadPrefix || "lg-morts-") + this.lobby.name.split("-").pop(),
      permissionOverwrites: overwritesDead
    });
    await this.channels.dead.send("💀 **Salon des Morts** — vous pourrez parler ici après votre décès.");
  }

  // ---------- Petite-Fille ----------
  getPetiteFille(){ return this.players.find(p=>p.alive && p.roleKey==="petite_fille") || null; }

  async promptPFChoice(){
    const pf = this.getPetiteFille(); if (!pf || this.pfRevealed){ this.pfSpyActive = false; return; }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pf_yes").setLabel("Espionner (risque 20%)").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("pf_no").setLabel("Ne pas espionner").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("skip").setLabel("⏭️ Passer").setStyle(ButtonStyle.Danger)
    );
    try{
      const msg = await pf.user.send({ content:"🔎 **Petite-Fille** — Espionner le salon des Loups *cette nuit* ?", components:[row] });
      const i = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 45000 }).catch(()=>null);
      if (!i){ this.pfSpyActive=false; try{ await msg.edit({ content:"⏳ Pas de réponse — tu **n’espionnes pas** cette nuit.", components:[] }); }catch{}; return; }
      if (i.customId === "pf_yes"){ this.pfSpyActive = true;  await i.update({ content:"✅ Tu **espionnes** cette nuit.", components:[] }); }
      else if (i.customId === "pf_no"){ this.pfSpyActive = false; await i.update({ content:"❌ Tu **n’espionnes pas** cette nuit.", components:[] }); }
      else { this.pfSpyActive = false; await i.update({ content:"⏭️ Passé.", components:[] }); }
    }catch{ this.pfSpyActive=false; }
  }

  enablePFRelayForThisNight(){
    if (this._wolvesRelayListener || !this.channels.wolves) return;
    const pf = this.getPetiteFille(); if (!pf) return;
    this.pfSpiedThisNight = false;
    this._wolvesRelayListener = async (msg)=>{
      if (!this.pfSpyActive || this.pfRevealed) return;
      if (msg.channelId !== this.channels.wolves.id) return;
      if (msg.author?.bot) return;
      const content = (msg.content||"").trim(); if (!content) return;
      try{ await pf.user.send(`[Loups] ${content}`); this.pfSpiedThisNight = true; }catch{}
    };
    this.client.on("messageCreate", this._wolvesRelayListener);
  }
  disablePFRelay(){ if (this._wolvesRelayListener){ this.client.off("messageCreate", this._wolvesRelayListener); this._wolvesRelayListener=null; } this.pfSpyActive=false; }

  async maybeRevealPetiteFilleAtDawn(){
    const pf = this.getPetiteFille(); if (!pf || this.pfRevealed) return;
    if (!this.pfSpiedThisNight) return;
    const chance = this.config.options?.petiteFille?.revealChance ?? 0.2;
    if (Math.random() < chance){
      this.pfRevealed = true;
      if (this.channels.wolves){ await this.channels.wolves.send(`⚠️ **Cette nuit**, vous avez découvert que la **Petite-Fille** vous espionnait : <@${pf.id}> !`); }
      try{ await pf.user.send("⚠️ Tu as été **démasquée**. Tu ne peux plus espionner pour le reste de la partie."); }catch{}
    }
    this.pfSpiedThisNight = false;
  }

  // ---------- phases ----------
  async nightPhase(){
    await this.lobby.send(`🌙 **Nuit ${this.nightIndex}**. Tout le monde dort…`);
    await this.toggleDeadTalk(false); // nuit : morts parlent, shaman toujours

    // Salvateur — menu (pas deux fois de suite la même)
    await this.resolveSalvateur();

    // Voyantes & Détective — menus
    await this.resolveSeersAndDetective();

    // PF
    await this.promptPFChoice();
    if (this.pfSpyActive && this.channels.wolves) this.enablePFRelayForThisNight(); else this.disablePFRelay();

    // Loups — vote
    const wolves = this.alive().filter((p) => isWolf(p.roleKey));
      const candidates = this.alive().filter((p) => !isWolf(p.roleKey));
       if (wolves.length && candidates.length && this.channels.wolves) {
         const victim = await this.voteSelect({
           channel: this.channels.wolves,
           title: "Vote des Loups : qui dévorer ?",
           voters: wolves,
          candidates,
          durationMs: 45000
        });
        if (victim) {
          await this.kill(victim.id, { cause: "loups" });
        }
      }

    // Infect Père des Loups — 30s pour convertir la cible des Loups (si vivant, pas protégé Salvateur), sinon passer
    wolfTarget = await this.resolveInfectPere(wolfTarget);

    // Sorcière — 30s sauver (boutons) puis 30s potion de mort (menu), '⏭️ Passer' dispo
    wolfTarget = await this.resolveSorciere(wolfTarget);

    // Loup Blanc — nuits paires : menu pour tuer un Loup
    await this.resolveLoupBlanc();

    // Exécuter la mort par Loups si cible finale existe
    if (wolfTarget){ await this.kill(wolfTarget.id, { cause:"loups" }); }

    // PF — tirage démasquage et couper relais
    await this.maybeRevealPetiteFilleAtDawn(); this.disablePFRelay();

    // Joueur de Flûte — sélection multi (2 cibles)
    await this.resolveFlutist();

    // Fin de nuit
    const recap = this.lastDeathsText(); if (recap) await this.lobby.send(`🌅 ${recap}`);
    await sleep(800);
  }

  async dayPhase(){
    // Montreur d’Ours — DM info voisins
    await this.resolveMontreurOursInfo();

    // Voyante bavarde — annonces publiques
    if (this._bavardeReveals.length){
      const lines = this._bavardeReveals.map(r => `🔍 ${this.nameOf(r.targetId)} est **${label(r.roleKey)}**`);
      await this.lobby.send(lines.join("\n"));
      this._bavardeReveals = [];
    }

    await this.lobby.send("☀️ **Jour**. Discutez… puis votez pour éliminer quelqu’un.");
    await this.toggleDeadTalk(true); // jour : morts muets, shaman OK

    const voters = this.alive();
    if (voters.length <= 2) return;
    const victim = await this.voteSelect({
      channel: this.lobby,
      title: "Vote du Village : qui éliminer ?",
      voters,
      candidates: voters,
      durationMs: 60000
   });
    if (victim){ await this.kill(victim.id, { cause:"village" }); }
  }

  // ---------- pouvoirs (menus) ----------
  async resolveSalvateur(){
    const salv = this.alive().find(p=>p.roleKey==="salvateur"); if (!salv){ this.salvateurTonight=null; return; }
    let pool = this.alive().slice();
    if (this.salvateurLast) pool = pool.filter(p=>p.id !== this.salvateurLast);
    const opts = pool.map(p=>({ label: this.nameOf(p.id), value: p.id }));
    if (!opts.length) { this.salvateurTonight = null; return; }

    const res = await this.dmSelect(salv.user, "🛡️ **Salvateur** — Choisis **une** personne à protéger (30s).", opts, { timeoutMs: 30000, includeSkip: true });
    if (res.choice === "ok"){
      this.salvateurTonight = res.values[0];
      this.salvateurLast = this.salvateurTonight;
    } else {
      this.salvateurTonight = null; // passe
    }
  }

  async resolveSeersAndDetective(){
    // Voyante
    for (const seer of this.alive().filter(p=>p.roleKey==="voyante")){
      const pool = this.alive().filter(x=>x.id!==seer.id);
      if (!pool.length) continue;
      const opts = pool.map(p=>({ label: this.nameOf(p.id), value: p.id }));
      const res = await this.dmSelect(seer.user, "🔮 **Voyante** — Choisis **une** cible à sonder (30s).", opts, { timeoutMs: 30000, includeSkip: true });
      if (res.choice === "ok"){
        const tid = res.values[0];
        try{ await seer.user.send(`🔮 Résultat — ${this.nameOf(tid)} est **${label(this.roleOf(tid))}**.`); }catch{}
      }
    }

    // Voyante bavarde
    for (const seer of this.alive().filter(p=>p.roleKey==="voyante_bavarde")){
      const pool = this.alive().filter(x=>x.id!==seer.id);
      if (!pool.length) continue;
      const opts = pool.map(p=>({ label: this.nameOf(p.id), value: p.id }));
      const res = await this.dmSelect(seer.user, "🗣️ **Voyante bavarde** — Choisis **une** cible à sonder (30s).", opts, { timeoutMs: 30000, includeSkip: true });
      if (res.choice === "ok"){
        const tid = res.values[0];
        const rkey = this.roleOf(tid);
        try{ await seer.user.send(`🔮 Résultat — ${this.nameOf(tid)} est **${label(rkey)}**.`); }catch{}
        this._bavardeReveals.push({ targetId: tid, roleKey: rkey });
      }
    }

    // Détective — choisir 2 joueurs
    for (const det of this.alive().filter(p=>p.roleKey==="detective")){
      const pool = this.alive().filter(x=>x.id!==det.id);
      if (pool.length < 2) continue;
      const opts = pool.map(p=>({ label: this.nameOf(p.id), value: p.id }));
      const res = await this.dmSelect(det.user, "🕵️ **Détective** — Choisis **deux** joueurs à comparer (30s).", opts, { minValues: 2, maxValues: 2, timeoutMs: 30000, includeSkip: true });
      if (res.choice === "ok" && res.values.length === 2){
        const [a,b] = res.values;
        const same = (ROLE_CATALOG[this.roleOf(a)]?.align === ROLE_CATALOG[this.roleOf(b)]?.align);
        try{ await det.user.send(`🕵️ Résultat — ${this.nameOf(a)} & ${this.nameOf(b)} : **${same?"MÊME":"DIFFÉRENT"} camp**.`); }catch{}
      }
    }
  }

  async resolveInfectPere(wolfTarget){
    const infect = this.alive().find(p=>p.roleKey==="infect_pere");
    if (!infect || this.infectUsed || !wolfTarget) return wolfTarget;

    // si protégé par le Salvateur, pas de conversion (attaque échoue déjà)
    if (this.salvateurTonight && wolfTarget.id === this.salvateurTonight) return wolfTarget;

    // proposer conversion (30s) + passer
    const ask = await this.dmConfirm(infect.user,
      `🩸 **Infect Père des Loups** — Convertir **${this.nameOf(wolfTarget.id)}** en **Loup** au lieu de le tuer ? (30s)`,
      { timeoutMs: 30000, includeSkip: true }
    );
    if (ask.choice === "yes"){
      this.infectUsed = true;
      await this.convertToWolf(wolfTarget.id);
      // conversion → plus de mort par loups cette nuit
      return null;
    }
    // no / skip / timeout ⇒ pas de conversion
    return wolfTarget;
  }

  async convertToWolf(id){
    const p = this.getPlayer(id); if (!p || !p.alive) return;
    p.roleKey = "loup"; // on le bascule en Loup standard
    try{ await p.user.send("🐺 **Tu as été infecté** : tu deviens **Loup-Garou** !"); }catch{}
    // ajouter l’accès au salon des loups
    if (this.channels.wolves){
      try{
        await this.channels.wolves.permissionOverwrites.edit(id, { ViewChannel: true, SendMessages: true });
        await this.channels.wolves.send(`➕ Un nouveau Loup a rejoint la meute : **${this.nameOf(id)}**.`);
      }catch{}
    }
  }

  async resolveSorciere(wolfTarget){
    const witch = this.alive().find(p=>p.roleKey==="sorciere"); if (!witch) return wolfTarget;

    // Sauver la cible des loups (si potion de vie & cible non protégée déjà par Salvateur)
    if (wolfTarget && this.witchLifeAvailable){
      const protectedBySalv = (this.salvateurTonight && wolfTarget.id === this.salvateurTonight);
      if (!protectedBySalv){
        const ans = await this.dmConfirm(
          witch.user,
          `🧙 **Sorcière** — Les Loups vont tuer **${this.nameOf(wolfTarget.id)}**.\nUtiliser la **potion de vie** ? (30s)`,
          { timeoutMs: 30000, includeSkip: true }
        );
        if (ans.choice === "yes"){
          this.witchLifeAvailable = false;
          wolfTarget = null; // sauvé
        }
      }
    }

    // Potion de mort (optionnelle) — menu des vivants (hors Sorcière)
    if (this.witchDeathAvailable){
      const pool = this.alive().filter(x=>x.id!==witch.id);
      if (pool.length){
        const ans2 = await this.dmConfirm(
          witch.user,
          "☠️ **Sorcière** — Utiliser la **potion de mort** cette nuit ? (30s)",
          { timeoutMs: 30000, includeSkip: true }
        );
        if (ans2.choice === "yes"){
          const opts = pool.map(p=>({ label: this.nameOf(p.id), value: p.id }));
          const pick = await this.dmSelect(witch.user, "☠️ **Potion de mort** — Choisis **une** cible (30s).", opts, { timeoutMs: 30000, includeSkip: true });
          if (pick.choice === "ok"){
            const tid = pick.values[0];
            this.witchDeathAvailable = false;
            await this.kill(tid, { cause: "sorciere" });
          }
        }
      }
    }
    return wolfTarget;
  }

  async resolveLoupBlanc(){
    const lb = this.alive().find(p=>p.roleKey==="loup_blanc"); if (!lb) return;
    if (this.nightIndex % 2 !== 0) return; // nuits paires
    const wolfTargets = this.alive().filter(p=>isWolf(p.roleKey) && p.id !== lb.id);
    if (!wolfTargets.length) return;

    const opts = wolfTargets.map(p=>({ label: this.nameOf(p.id), value: p.id }));
    const res = await this.dmSelect(lb.user, "🌕 **Loup Blanc** — Éliminer un **Loup** cette nuit ? (30s)", opts, { timeoutMs: 30000, includeSkip: true });
    if (res.choice === "ok"){
      const tid = res.values[0];
      await this.kill(tid, { cause: "loup_blanc" });
    }
  }

  async resolveFlutist(){
    const fl = this.alive().find(p=>p.roleKey==="joueur_flute"); if (!fl) return;
    const pool = this.alive().filter(p=>p.id!==fl.id);
    if (!pool.length) return;

    // prioriser non-envoûtés dans les options (ils apparaissent en premier)
    const nonCharmed = pool.filter(p=>!this.fluteCharmed.has(p.id));
    const rest = pool.filter(p=>this.fluteCharmed.has(p.id));
    const ordered = [...nonCharmed, ...rest];
    const opts = ordered.map(p=>({ label: this.nameOf(p.id) + (this.fluteCharmed.has(p.id) ? " (déjà envoûté)" : ""), value: p.id }));

    const res = await this.dmSelect(fl.user, "🎼 **Joueur de Flûte** — Choisis jusqu’à **2** cibles à envoûter (30s).", opts, { minValues: 1, maxValues: 2, timeoutMs: 30000, includeSkip: true });
    if (res.choice === "ok"){
      for (const id of res.values) this.fluteCharmed.add(id);
      try{ await fl.user.send(`🎼 Envoûtés: ${res.values.map(v=>this.nameOf(v)).join(" & ")}`);}catch{}
    }
  }

  async resolveMontreurOursInfo(){
    for (const mo of this.alive().filter(p=>p.roleKey==="montreur_ours")){
      const neighbors = this.livingNeighbors(mo.id);
      const hasWolf = neighbors.some(n=>isWolf(n.roleKey));
      try{ await mo.user.send(`🐻 **Montreur d’Ours** — Loup chez tes voisins : **${hasWolf ? "OUI" : "NON"}**.`);}catch{}
    }
  }

  // ---------- morts / annonces ----------
  async kill(id, { cause } = {}){
    const p = this.players.find(x=>x.id===id); if (!p || !p.alive) return;
    p.alive = false; this.deaths.push({ id, cause, nightIndex: this.nightIndex });

    if (p.roleKey === "petite_fille") this.disablePFRelay();

    if (this.config.options.reveal === "on_death"){
      await this.lobby.send(`☠️ ${this.nameOf(id)} — ${label(p.roleKey)} (${labelAlign(ROLE_CATALOG[p.roleKey].align)}) — mort (${this.causeText(cause)})`);
    } else {
      await this.lobby.send(`☠️ ${this.nameOf(id)} — mort (${this.causeText(cause)})`);
    }

    // amoureux
    if (p.loverId){
      const lover = this.players.find(x=>x.id===p.loverId);
      if (lover && lover.alive){ await this.kill(lover.id, { cause: "chagrin" }); }
    }

    // Chasseur
    if (p.roleKey === "chasseur"){ await this.resolveChasseur(p); }
  }

  causeText(c){
    const map = { loups:"Loups", village:"vote du Village", sorciere:"Sorcière", chasseur:"Chasseur", loup_blanc:"Loup Blanc", chagrin:"mort de chagrin" };
    return map[c] || c;
  }

  lastDeathsText(){
    if (this.deaths.length === 0) return "";
    const last = this.deaths.slice(-2).map(d=>this.nameOf(d.id)).join(", ");
    return `Morts cette nuit: **${last}**`;
  }

  async resolveChasseur(ch){
    const targets = this.alive().filter(x=>x.id!==ch.id); if (!targets.length) return;
    try{ await ch.user.send("💥 Tu es mort... mais en tant que **Chasseur**, tu peux tirer une dernière balle. Choisis ta cible (45s)."); }catch{}
    const victim = await startVote({
      channel: this.lobby,
      title: `🎯 Tir du **Chasseur** (${this.nameOf(ch.id)}) — choisis une cible`,
      voters: [ch],
      candidates: targets,
      durationMs: 45000
    });
    if (victim){ await this.kill(victim.id, { cause:"chasseur" }); }
    else { await this.lobby.send("💥 Le **Chasseur** a raté sa cible (aucun choix)."); }
  }

  // ---------- dead chat perms ----------
  async toggleDeadTalk(day){
    if (!this.channels.dead) return;
    const overwrites = [
      { id: this.guild.id, allow:[PermissionsBitField.Flags.ViewChannel], deny:[PermissionsBitField.Flags.SendMessages] },
      { id: this.client.user.id, allow: VIEW_WRITE }
    ];
    for (const p of this.players){
      if (!p.alive){ overwrites.push({ id:p.id, allow: day ? [] : VIEW_WRITE }); }
      if (p.roleKey === "shaman"){ overwrites.push({ id:p.id, allow: VIEW_WRITE }); }
    }
    await this.channels.dead.permissionOverwrites.set(overwrites);
  }

  // ---------- conditions de victoire ----------
  winCheck(){
    const alive = this.alive();

    // Couple mixte / 2 derniers
    if (this.isCoupleAlive() && alive.length === 2 && this.isCoupleMixed()){
      return { done:true, winner:"couple" };
    }

    // Loup Blanc solo
    if (alive.length === 1 && alive[0].roleKey === "loup_blanc"){
      return { done:true, winner:"loup_blanc" };
    }

    // Joueur de Flûte — tous vivants envoûtés + flûtiste vivant
    const fl = alive.find(p=>p.roleKey==="joueur_flute");
    if (fl){
      const allCharmed = alive.every(p => this.fluteCharmed.has(p.id) || p.id === fl.id);
      if (allCharmed) return { done:true, winner:"flute" };
    }

    // Village / Loups
    const wolves = alive.filter(p=>isWolf(p.roleKey)).length;
    const vill = alive.length - wolves;
    if (wolves === 0) return { done:true, winner: ALIGN.VILLAGE };
    if (wolves >= vill) return { done:true, winner: ALIGN.WOLF };
    return { done:false };
  }

  // ---------- fin / cleanup ----------
  async endGame(winner){
    this.state = "ended";
    const deadIds = this.deaths.map(d=>d.id);
    const deadSet = new Set(deadIds);
    const ordered = [ ...deadIds.map(id=>this.players.find(p=>p.id===id)), ...this.players.filter(p=>!deadSet.has(p.id)) ];

    const heart = p => p.loverId ? "❤️ " : "";
    const lines = ordered.map(p=>
      `${heart(p)}${this.nameOf(p.id)} — ${label(p.roleKey)} (${labelAlign(ROLE_CATALOG[p.roleKey].align)}) — ${p.alive ? "vivant" : `mort (${this.causeText(this.deaths.find(d=>d.id===p.id)?.cause||"?")})`}`
    ).join("\n");

    let winnerText = "";
    if (winner === "couple"){
      const [a,b] = this.coupleIds;
      winnerText = `**Couple** (❤️) — ${this.nameOf(a)} + ${this.nameOf(b)}\n💘 Cupidon gagne également s’il était en jeu.`;
    } else if (winner === "loup_blanc"){
      winnerText = `**Loup Blanc** (victoire solo)`;
    } else if (winner === "flute"){
      winnerText = `**Joueur de Flûte** (victoire solo)`;
    } else {
      winnerText = `**${winner === ALIGN.WOLF ? "Loups" : "Village"}**`;
    }

    await this.lobby.send(`🏁 **Fin de partie** — Vainqueur: ${winnerText}\n\n${lines}`);
    await this.stop();
  }

  async stop(){
    this.disablePFRelay();
    try{ await this.channels.wolves?.delete("cleanup"); }catch{}
    try{ await this.channels.dead?.delete("cleanup"); }catch{}
    try{ await this.channels.sisters?.delete("cleanup"); }catch{}
    try{ await this.channels.brothers?.delete("cleanup"); }catch{}
    this.state = "ended";
  }
}

import { ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from "discord.js";
import { ROLE_CATALOG, ALIGN, isWolf } from "./roles.js";
import { VIEW_WRITE } from "../util/perms.js";
import { shuffleArray, sleep, pickRandom } from "./utils.js";
import { startVote } from "./vote.js";
import { DM_TEMPLATES, label, labelAlign } from "./texts.js";

export class GameManager {
  static fromChannel(client, channelId) {
    return client.games.get(channelId);
  }

  static async createLobby(client, guild, ownerUser) {
    const catName = client.config.categoryName || "loup-garou";
    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === catName
    );
    if (!category) {
      category = await guild.channels.create({
        name: catName,
        type: ChannelType.GuildCategory,
      });
    }

    const lobbyName = `${client.config.channels?.lobbyPrefix || "lg-lobby-"}${ownerUser.username
      .toLowerCase()
      .slice(0, 60)}`;
    const lobby = await guild.channels.create({
      name: lobbyName,
      type: ChannelType.GuildText,
      parent: category.id,
    });

    const gm = new GameManager(client, guild, lobby);
    client.games.set(lobby.id, gm);
    await lobby.send(
      "🎲 **Lobby Loup-Garou** ouvert.\nUtilisez `/lg join`, puis `/lg config`, puis `/lg start`."
    );
    return gm;
  }

  constructor(client, guild, lobby) {
    this.client = client;
    this.guild = guild;
    this.lobby = lobby;

    this.players = []; // {id,user,roleKey,alive,canVote,loverId,seat}
    this.state = "lobby";

    this.config = {
      total: 0,
      counts: {},
      options: { ...(client.config?.options || {}) },
    };

    this.channels = { wolves: null, dead: null, sisters: null, brothers: null };
    this.table = [];
    this.nightIndex = 0;
    this.deaths = []; // {id,cause,nightIndex}
    this.pfRelayHooked = false;
    this.corbeauTarget = null;
    this.infectUsed = false;
    this.salvateurLast = null;
    this.captainId = null;

    // --- Petite-Fille: états nuit par nuit ---
    this.pfRevealed = false;        // si vrai, elle a perdu son pouvoir définitivement
    this.pfSpyActive = false;       // choix "espionner cette nuit ?"
    this.pfSpiedThisNight = false;  // au moins un message relayé cette nuit
    this._wolvesRelayListener = null; // listener messageCreate pour le relais

    // --- Cupidon / Couple ---
    this.cupidonId = null;          // id du Cupidon (s’il existe)
    this.coupleIds = [];            // [idA, idB] si un couple est formé
  }

  // ---------- helpers ----------
  nameOf(id) {
    const p = this.players.find((x) => x.id === id);
    return p?.user?.username || `<${id}>`;
  }

  alive() {
    return this.players.filter((p) => p.alive);
  }

  getPlayer(id) {
    return this.players.find(p => p.id === id) || null;
  }

  // ---------- lobby ----------
  addPlayer(user) {
    if (this.state !== "lobby") return { ok: false, msg: "⛔ Partie déjà démarrée." };
    if (this.players.find((p) => p.id === user.id))
      return { ok: true, msg: "ℹ️ Déjà inscrit." };
    this.players.push({
      id: user.id,
      user,
      roleKey: null,
      alive: true,
      canVote: true,
      loverId: null,
      seat: null,
    });
    return {
      ok: true,
      msg: `✅ ${user} a rejoint. (${this.players.length} joueurs)`,
    };
  }

  removePlayer(uid) {
    if (this.state !== "lobby") return { ok: false, msg: "⛔ Partie déjà démarrée." };
    const i = this.players.findIndex((p) => p.id === uid);
    if (i === -1) return { ok: false, msg: "ℹ️ Non inscrit." };
    this.players.splice(i, 1);
    return { ok: true, msg: `👋 Retiré. (${this.players.length} joueurs)` };
  }

  kickBeforeStart(uid) {
    return this.removePlayer(uid);
  }

  countsFromInteraction(interaction) {
    const counts = {};
    for (const key of Object.keys(ROLE_CATALOG)) {
      if (key === "villageois") continue;
      const v = interaction.options.getInteger(key);
      if (v !== null && v !== undefined) counts[key] = v;
    }
    return counts;
  }

  setConfig({ total, counts, options }) {
    if (this.state !== "lobby") return { ok: false, msg: "⛔ Déjà démarré." };
    if (total < 4) return { ok: false, msg: "❌ Minimum 4 joueurs." };

    // (optionnel/legacy) Voyante mode — si tu veux 100% "rôles", supprime ce bloc.
    const mode = options?.seerMode ?? this.config.options.seerMode;
    if (mode) {
      if (mode === "none") {
        counts.voyante = 0;
        counts.voyante_bavarde = 0;
      } else if (mode === "classic") {
        counts.voyante_bavarde = 0;
      } else if (mode === "chatty") {
        counts.voyante = 0;
      }
    }

    // Voleur désactivé (au cas où)
    if (counts.voleur) delete counts.voleur;

    const sum = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
    if (sum > total) return { ok: false, msg: "❌ Plus de rôles que de joueurs." };

    this.config.total = total;
    this.config.counts = Object.fromEntries(
      Object.entries(counts).filter(([, n]) => (n || 0) > 0)
    );
    this.config.options = { ...this.config.options, ...options };

    return {
      ok: true,
      msg: `🧩 Configuration enregistrée.\n• Joueurs: **${total}**\n• Rôles assignés: **${sum}** (le reste = Villageois)`,
    };
  }

  canStart() {
    if (this.state !== "lobby") return { ok: false, error: "Partie déjà démarrée." };
    if (this.players.length !== this.config.total)
      return {
        ok: false,
        error: `Il faut **${this.config.total}** joueurs (inscrits: ${this.players.length}).`,
      };
    return { ok: true };
  }

  // ---------- start ----------
  async startGame() {
    this.state = "night0";

    // Table (ordre de jeu / voisins)
    shuffleArray(this.players);
    this.players.forEach((p, i) => (p.seat = i));
    this.table = this.players.map((p) => p.id);

    // Composition → assignation
    const comp = this.expandComposition();
    shuffleArray(comp);
    this.players.forEach((p, i) => (p.roleKey = comp[i] || "villageois"));

    // DM rôles
    for (const p of this.players) {
      try {
        await p.user.send(
          DM_TEMPLATES.role(
            p.roleKey,
            ROLE_CATALOG[p.roleKey].align,
            ROLE_CATALOG[p.roleKey].dmDesc || ""
          )
        );
      } catch {}
    }

    // Mémoriser Cupidon et setup couple si besoin
    const cup = this.players.find(p => p.roleKey === "cupidon");
    this.cupidonId = cup?.id || null;
    await this.setupCoupleIfAny();

    // Création des salons (loups / morts)
    await this.setupChannels();

    // Nuit/Jour jusqu’à condition de victoire
    this.nightIndex = 1;
    while (true) {
      await this.nightPhase();
      const w1 = this.winCheck();
      if (w1.done) return this.endGame(w1.winner);

      await this.dayPhase();
      const w2 = this.winCheck();
      if (w2.done) return this.endGame(w2.winner);

      this.nightIndex++;
    }
  }

  renderTable() {
    if (!this.table.length) return "Table non définie.";
    const names = this.table.map((id) => this.nameOf(id));
    return `🪑 **Ordre de table** : ${names.join(" → ")}`;
    // (Les morts sont ignorés comme voisins réels pendant la partie)
  }

  // ---------- composition ----------
  expandComposition() {
    const roles = [];
    for (const [k, n] of Object.entries(this.config.counts)) {
      for (let i = 0; i < n; i++) roles.push(k);
    }
    // Remplir le reste en Villageois
    while (roles.length < this.config.total) roles.push("villageois");
    return roles;
  }

  // ---------- Cupidon / Couple ----------
  async setupCoupleIfAny() {
    // Pas de Cupidon ? pas de couple
    if (!this.cupidonId) return;

    const opt = this.config.options?.cupidon || {};
    const allowSelf = !!opt.allowSelf;
    const randomCouple = !!opt.randomCouple;

    if (!randomCouple) {
      // (MVP) Pas de sélection manuelle encore — on ne crée le couple que si randomCouple=true
      return;
    }

    // Choisir 2 joueurs pour le couple
    const pool = this.players.filter(p => p.alive);
    let candidates = pool;

    if (!allowSelf) {
      candidates = pool.filter(p => p.id !== this.cupidonId);
    }

    if (candidates.length < 2) return;

    // tirer deux distincts
    shuffleArray(candidates);
    const a = candidates[0];
    let b = candidates.find(x => x.id !== a.id);
    if (!b) return;

    // Former le couple
    a.loverId = b.id;
    b.loverId = a.id;
    this.coupleIds = [a.id, b.id];

    // DM amoureux
    try { await a.user.send(`❤️ Tu es **Amoureux** avec **${this.nameOf(b.id)}**. Si l'un meurt, l'autre meurt de chagrin.`); } catch {}
    try { await b.user.send(`❤️ Tu es **Amoureux** avec **${this.nameOf(a.id)}**. Si l'un meurt, l'autre meurt de chagrin.`); } catch {}

    // DM Cupidon (il connaît l’identité du couple)
    const cupidon = this.cupidonId ? this.getPlayer(this.cupidonId) : null;
    if (cupidon) {
      try {
        await cupidon.user.send(`💘 **Couple formé** : ${this.nameOf(a.id)} ❤️ ${this.nameOf(b.id)}${(a.id===cupidon.id||b.id===cupidon.id) ? " (tu en fais partie)" : ""}.`);
      } catch {}
    }

    // Option : annoncer en lobby que "Cupidon a décoché ses flèches" (sans donner les noms)
    await this.lobby.send("💘 Cupidon a décoché ses flèches… deux cœurs sont liés cette nuit.");
  }

  isCoupleAlive() {
    if (!this.coupleIds?.length) return false;
    const [a, b] = this.coupleIds;
    const pa = this.getPlayer(a), pb = this.getPlayer(b);
    return !!(pa && pb && pa.alive && pb.alive);
  }

  isCoupleMixed() {
    if (!this.coupleIds?.length) return false;
    const [a, b] = this.coupleIds;
    const pa = this.getPlayer(a), pb = this.getPlayer(b);
    if (!pa || !pb) return false;
    const aa = ROLE_CATALOG[pa.roleKey]?.align;
    const ab = ROLE_CATALOG[pb.roleKey]?.align;
    if (!aa || !ab) return false;
    return (aa !== ab); // village vs loup (ou autre)
  }

  // ---------- salons ----------
  async setupChannels() {
    // Loups
    const wolves = this.players.filter((p) => isWolf(p.roleKey) && p.alive);
    if (wolves.length) {
      const overwrites = [
        { id: this.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: this.client.user.id, allow: VIEW_WRITE },
        ...wolves.map((w) => ({ id: w.id, allow: VIEW_WRITE })),
      ];

      this.channels.wolves = await this.guild.channels.create({
        type: ChannelType.GuildText,
        parent: this.lobby.parentId,
        name: (this.client.config.channels?.wolvesPrefix || "lg-loups-") + this.lobby.name.split("-").pop(),
        permissionOverwrites: overwrites,
      });

      await this.channels.wolves.send("🌙 **Salon des Loups** — discutez et votez chaque nuit.");
      // PF : repartir propre
      this.disablePFRelay();
    }

    // Morts
    const overwritesDead = [
      { id: this.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: this.client.user.id, allow: VIEW_WRITE },
    ];
    this.channels.dead = await this.guild.channels.create({
      type: ChannelType.GuildText,
      parent: this.lobby.parentId,
      name: (this.client.config.channels?.deadPrefix || "lg-morts-") + this.lobby.name.split("-").pop(),
      permissionOverwrites: overwritesDead,
    });
    await this.channels.dead.send("💀 **Salon des Morts** — vous pourrez parler ici après votre décès.");
  }

  // ---------- Petite-Fille : helpers ----------
  getPetiteFille() {
    return this.players.find(p => p.alive && p.roleKey === "petite_fille") || null;
  }

  async promptPFChoice() {
    const pf = this.getPetiteFille();
    if (!pf || this.pfRevealed) { this.pfSpyActive = false; return; }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pf_yes").setLabel("Espionner (risque 20%)").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("pf_no").setLabel("Ne pas espionner").setStyle(ButtonStyle.Secondary)
    );

    try {
      const msg = await pf.user.send({
        content: "🔎 **Petite-Fille** — Veux-tu espionner le salon des Loups *cette nuit* ?\n⚠️ Il y a **20%** de chance d’être **démasquée** (les Loups découvriront ton identité au lever du jour).",
        components: [row]
      });

      const choice = await msg.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 45000 // 45s pour répondre
      }).catch(() => null);

      if (!choice) {
        this.pfSpyActive = false;
        try { await msg.edit({ content: "⏳ Pas de réponse — tu **n’espionnes pas** cette nuit.", components: [] }); } catch {}
        return;
      }

      if (choice.customId === "pf_yes") {
        this.pfSpyActive = true;
        try { await choice.update({ content: "✅ Tu **espionnes** les Loups cette nuit.", components: [] }); } catch {}
      } else {
        this.pfSpyActive = false;
        try { await choice.update({ content: "❌ Tu **n’espionnes pas** cette nuit.", components: [] }); } catch {}
      }
    } catch {
      // DM off ou impossible
      this.pfSpyActive = false;
    }
  }

  enablePFRelayForThisNight() {
    if (this._wolvesRelayListener || !this.channels.wolves) return;
    const pf = this.getPetiteFille();
    if (!pf) return;

    this.pfSpiedThisNight = false;

    this._wolvesRelayListener = async (msg) => {
      if (!this.pfSpyActive || this.pfRevealed) return;
      if (msg.channelId !== this.channels.wolves.id) return;
      if (msg.author?.bot) return;
      const content = (msg.content || "").trim();
      if (!content) return;
      try {
        await pf.user.send(`[Loups] ${content}`); // sans pseudo
        this.pfSpiedThisNight = true;
      } catch {}
    };

    this.client.on("messageCreate", this._wolvesRelayListener);
  }

  disablePFRelay() {
    if (this._wolvesRelayListener) {
      this.client.off("messageCreate", this._wolvesRelayListener);
      this._wolvesRelayListener = null;
    }
    this.pfSpyActive = false;
  }

  async maybeRevealPetiteFilleAtDawn() {
    const pf = this.getPetiteFille();
    if (!pf || this.pfRevealed) return;
    if (!this.pfSpiedThisNight) return; // pas d’espionnage → pas de tirage

    const chance = this.config.options?.petiteFille?.revealChance ?? 0.2;
    if (Math.random() < chance) {
      this.pfRevealed = true; // pouvoir perdu définitivement
      if (this.channels.wolves) {
        await this.channels.wolves.send(`⚠️ **Cette nuit**, vous avez découvert que la **Petite-Fille** vous espionnait : <@${pf.id}> !`);
      }
      try { await pf.user.send("⚠️ Tu as été **démasquée**. Tu ne peux plus espionner les Loups pour le reste de la partie."); } catch {}
    }

    // reset des flags de nuit
    this.pfSpiedThisNight = false;
  }

  // ---------- phases (MVP) ----------
  async nightPhase() {
    await this.lobby.send(`🌙 **Nuit ${this.nightIndex}**. Tout le monde dort…`);

    // --- Petite-Fille : choix "espionner cette nuit ?" ---
    await this.promptPFChoice();
    if (this.pfSpyActive && this.channels.wolves) {
      this.enablePFRelayForThisNight();
    } else {
      this.disablePFRelay();
    }

    // Vote des loups (MVP)
    const wolves = this.alive().filter((p) => isWolf(p.roleKey));
    const candidates = this.alive().filter((p) => !isWolf(p.roleKey));
    if (wolves.length && candidates.length && this.channels.wolves) {
      const victim = await startVote({
        channel: this.channels.wolves,
        title: "Vote des Loups : qui dévorer ?",
        voters: wolves,
        candidates,
        durationMs: 45000,
      });
      if (victim) {
        await this.kill(victim.id, { cause: "loups" });
      }
    }

    // --- Fin de nuit : tirage démasquage PF (si elle a espionné) ---
    await this.maybeRevealPetiteFilleAtDawn();
    // désactive le relais à la fin de la nuit quoi qu’il arrive
    this.disablePFRelay();

    // Fin de nuit : petit résumé
    const recap = this.lastDeathsText();
    if (recap) await this.lobby.send(`🌅 ${recap}`);
    await sleep(1500);
  }

  async dayPhase() {
    await this.lobby.send("☀️ **Jour**. Discutez… puis votez pour éliminer quelqu’un.");

    // Vote du village (tous les vivants)
    const voters = this.alive();
    if (voters.length <= 2) return; // on évite un vote inutile

    const victim = await startVote({
      channel: this.lobby,
      title: "Vote du Village : qui éliminer ?",
      voters,
      candidates: voters,
      durationMs: 60000,
    });

    if (victim) {
      await this.kill(victim.id, { cause: "village" });
    }
  }

  // ---------- événements de mort ----------
  async kill(id, { cause } = {}) {
    const p = this.players.find((x) => x.id === id);
    if (!p || !p.alive) return;

    p.alive = false;
    this.deaths.push({ id, cause, nightIndex: this.nightIndex });

    // Si la PF meurt, on coupe son relais immédiatement
    if (p.roleKey === "petite_fille") {
      this.disablePFRelay();
    }

    // Révélation à la mort
    if (this.config.options.reveal === "on_death") {
      await this.lobby.send(
        `☠️ ${this.nameOf(id)} — ${label(p.roleKey)} (${labelAlign(
          ROLE_CATALOG[p.roleKey].align
        )}) — mort (${this.causeText(cause)})`
      );
    } else {
      await this.lobby.send(
        `☠️ ${this.nameOf(id)} — mort (${this.causeText(cause)})`
      );
    }

    // Mort de chagrin (amoureux)
    if (p.loverId) {
      const lover = this.players.find((x) => x.id === p.loverId);
      if (lover && lover.alive) {
        await this.kill(lover.id, { cause: "chagrin" });
      }
    }

    // Déclenchement Chasseur (choix 45s)
    if (p.roleKey === "chasseur") {
      await this.resolveChasseur(p);
    }
  }

  causeText(c) {
    const map = {
      loups: "Loups",
      village: "vote du Village",
      sorciere: "Sorcière",
      chasseur: "Chasseur",
      loup_blanc: "Loup Blanc",
      chagrin: "mort de chagrin",
    };
    return map[c] || c;
  }

  lastDeathsText() {
    if (this.deaths.length === 0) return "";
    const last = this.deaths.slice(-2).map((d) => this.nameOf(d.id)).join(", ");
    return `Morts cette nuit: **${last}**`;
  }

  // capacité Chasseur (choix manuel avec 45s)
  async resolveChasseur(ch) {
    if (!ch || !ch.alive === false) {
      // il vient de mourir, c’est bon
    }
    const targets = this.alive().filter((x) => x.id !== ch.id);
    if (targets.length === 0) return;

    try {
      await ch.user.send("💥 Tu es mort... mais en tant que **Chasseur**, tu peux tirer une dernière balle. Choisis ta cible (45s).");
    } catch {}

    const victim = await startVote({
      channel: this.lobby, // simple : on fait voter uniquement le chasseur dans le lobby
      title: `🎯 Tir du **Chasseur** (${this.nameOf(ch.id)}) — choisis une cible`,
      voters: [ch],
      candidates: targets,
      durationMs: 45000,
    });

    if (victim) {
      await this.kill(victim.id, { cause: "chasseur" });
    } else {
      await this.lobby.send("💥 Le **Chasseur** a raté sa cible (aucun choix).");
    }
  }

  async toggleDeadTalk(day) {
    if (!this.channels.dead) return;
    const overwrites = [
      {
        id: this.guild.id,
        allow: [PermissionsBitField.Flags.ViewChannel],
        deny: [PermissionsBitField.Flags.SendMessages],
      },
      { id: this.client.user.id, allow: VIEW_WRITE },
    ];
    for (const p of this.players) {
      if (!p.alive) {
        overwrites.push({ id: p.id, allow: day ? [] : VIEW_WRITE });
      }
      if (p.roleKey === "shaman") {
        overwrites.push({ id: p.id, allow: VIEW_WRITE });
      }
    }
    await this.channels.dead.permissionOverwrites.set(overwrites);
  }

  // ---------- conditions de victoire ----------
  winCheck() {
    const alive = this.alive();
    const wolves = alive.filter((p) => isWolf(p.roleKey)).length;
    const vill = alive.length - wolves;

    // 1) Victoire couple mixte (prioritaire) : les deux amoureux sont les deux seuls vivants
    if (this.isCoupleAlive() && alive.length === 2) {
      if (this.isCoupleMixed()) {
        return { done: true, winner: "couple" }; // couple + Cupidon gagnent
      }
    }

    // 2) Conditions classiques
    if (wolves === 0) return { done: true, winner: ALIGN.VILLAGE };
    if (wolves >= vill) return { done: true, winner: ALIGN.WOLF };

    return { done: false };
  }

  // ---------- fin de partie / cleanup ----------
  async endGame(winner) {
    this.state = "ended";

    // Récap : morts (des plus anciens aux plus récents), puis vivants
    const deadIds = this.deaths.map((d) => d.id);
    const deadSet = new Set(deadIds);
    const ordered = [
      ...deadIds.map((id) => this.players.find((p) => p.id === id)),
      ...this.players.filter((p) => !deadSet.has(p.id)),
    ];

    const heart = (p) => (p.loverId ? "❤️ " : "");
    const lines = ordered
      .map((p) =>
        `${heart(p)}${this.nameOf(p.id)} — ${label(p.roleKey)} (${labelAlign(
          ROLE_CATALOG[p.roleKey].align
        )}) — ${p.alive ? "vivant" : `mort (${this.causeText(this.deaths.find((d) => d.id === p.id)?.cause || "?")})`}`
      )
      .join("\n");

    let winnerText = "";
    if (winner === "couple") {
      const [a, b] = this.coupleIds;
      winnerText = `**Couple** (❤️) — ${this.nameOf(a)} + ${this.nameOf(b)}\n💘 Cupidon gagne également s’il était en jeu.`;
    } else {
      winnerText = `**${winner === ALIGN.WOLF ? "Loups" : "Village"}**`;
    }

    await this.lobby.send(
      `🏁 **Fin de partie** — Vainqueur: ${winnerText}\n\n${lines}`
    );
    await this.stop();
  }

  async stop() {
    this.disablePFRelay();
    try { await this.channels.wolves?.delete("cleanup"); } catch {}
    try { await this.channels.dead?.delete("cleanup"); } catch {}
    try { await this.channels.sisters?.delete("cleanup"); } catch {}
    try { await this.channels.brothers?.delete("cleanup"); } catch {}
    this.state = "ended";
  }
}

import { ChannelType, PermissionsBitField } from "discord.js";
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
  }

  // ---------- helpers ----------
  nameOf(id) {
    const p = this.players.find((x) => x.id === id);
    return p?.user?.username || `<${id}>`;
  }

  alive() {
    return this.players.filter((p) => p.alive);
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

    // Voyante exclusive
    const mode = options?.seerMode ?? this.config.options.seerMode ?? "classic";
    if (mode === "none") {
      counts.voyante = 0;
      counts.voyante_bavarde = 0;
    } else if (mode === "classic") {
      counts.voyante_bavarde = 0;
    } else if (mode === "chatty") {
      counts.voyante = 0;
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

    // Création des salons (loups / morts)
    await this.setupChannels();

    // Nuit/Jour jusqu’à condition de victoire
    // (MVP: boucle simple, sans tous les pouvoirs avancés)
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

  // ---------- phases (MVP) ----------
  async nightPhase() {
    await this.lobby.send(`🌙 **Nuit ${this.nightIndex}**. Tout le monde dort…`);

    // Vote des loups (MVP : les loups votent une cible parmi les **non-loups** vivants)
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
      // capacité "Idiot" non gérée ici (MVP)
      await this.kill(victim.id, { cause: "village" });
    }
  }

  // ---------- événements de mort ----------
  // tue un joueur et annonce selon les options
  async kill(id, { cause } = {}) {
    const p = this.players.find((x) => x.id === id);
    if (!p || !p.alive) return;

    p.alive = false;
    this.deaths.push({ id, cause, nightIndex: this.nightIndex });

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
  }

  // texte “cause de mort”
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

  // récap des morts de la nuit (affiché le matin)
  lastDeathsText() {
    if (this.deaths.length === 0) return "";
    // MVP : on affiche les 1–2 derniers décès
    const last = this.deaths.slice(-2).map((d) => this.nameOf(d.id)).join(", ");
    return `Morts cette nuit: **${last}**`;
  }

  // capacité Chasseur (MVP aléatoire)
  async resolveChasseur(ch) {
    const targets = this.alive().filter((x) => x.id !== ch.id);
    if (targets.length === 0) return;
    const t = pickRandom(targets);
    await this.kill(t.id, { cause: "chasseur" });
  }

  // salon des morts : jour muet, nuit parlant (shaman parle toujours)
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
    const vill = alive.length - wolves; // on ignore les neutres pour ce MVP

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

    await this.lobby.send(
      `🏁 **Fin de partie** — Vainqueur: **${winner === ALIGN.WOLF ? "Loups" : "Village"}**\n\n${lines}`
    );
    await this.stop();
  }

  async stop() {
    try {
      await this.channels.wolves?.delete("cleanup");
    } catch {}
    try {
      await this.channels.dead?.delete("cleanup");
    } catch {}
    try {
      await this.channels.sisters?.delete("cleanup");
    } catch {}
    try {
      await this.channels.brothers?.delete("cleanup");
    } catch {}
    this.state = "ended";
  }
}

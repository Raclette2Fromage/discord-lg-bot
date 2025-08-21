// --- keepalive (utile sur Replit) 
import express from "express";
const app = express();
app.get("/", (req, res) => res.send("LG-bot OK"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server on :${PORT}`));

// --- Discord bot
import { Client, GatewayIntentBits, Partials, Collection } from "discord.js";
import dotenv from "dotenv";
import configJson from "../config.json" assert { type: "json" };
import { registerGuildCommands } from "./commands.js";
import { GameManager } from "./game/GameManager.js";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

client.games = new Collection();
client.config = configJson;

client.once("ready", async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  if (client.config.guildId) {
    await registerGuildCommands(client);
    console.log("✅ Slash commands enregistrées (guild)");
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "lg") return;
  const sub = interaction.options.getSubcommand();
  try {
    if (sub === "create") return handleCreate(interaction);
    if (sub === "join")   return handleJoin(interaction);
    if (sub === "leave")  return handleLeave(interaction);
    if (sub === "kick")   return handleKick(interaction);
    if (sub === "config") return handleConfig(interaction);
    if (sub === "start")  return handleStart(interaction);
    if (sub === "table")  return handleTable(interaction);
    if (sub === "stop")   return handleStop(interaction);
    if (sub === "help")   return handleHelp(interaction);
    if (sub === "roles")  return handleRoles(interaction);    // ← ajouté
  } catch (e) {
    console.error(e);
    if (!interaction.replied) {
      await interaction.reply({ content: `❌ Erreur: ${e.message}`, ephemeral: true });
    }
  }
});

// ===== handlers =====
async function handleCreate(interaction) {
  const gm = await GameManager.createLobby(interaction.client, interaction.guild, interaction.user);
  await interaction.reply({ content: `Lobby créé: <#${gm.lobby.id}>`, ephemeral: true });
}

async function handleJoin(interaction) {
  const gm = GameManager.fromChannel(interaction.client, interaction.channelId);
  if (!gm) return interaction.reply({ content: "❌ Pas un lobby Loup-Garou.", ephemeral: true });
  const res = gm.addPlayer(interaction.user);
  return interaction.reply({ content: res.msg, ephemeral: true });
}

async function handleLeave(interaction) {
  const gm = GameManager.fromChannel(interaction.client, interaction.channelId);
  if (!gm) return interaction.reply({ content: "❌ Pas un lobby Loup-Garou.", ephemeral: true });
  const res = gm.removePlayer(interaction.user.id);
  return interaction.reply({ content: res.msg, ephemeral: true });
}

async function handleKick(interaction) {
  const gm = GameManager.fromChannel(interaction.client, interaction.channelId);
  if (!gm) return interaction.reply({ content: "❌ Pas un lobby Loup-Garou.", ephemeral: true });
  const target = interaction.options.getUser("user", true);
  const res = gm.kickBeforeStart(target.id);
  return interaction.reply({ content: res.msg, ephemeral: true });
}

async function handleConfig(interaction) {
  const gm = GameManager.fromChannel(interaction.client, interaction.channelId);
  if (!gm) return interaction.reply({ content: "❌ Pas un lobby Loup-Garou.", ephemeral: true });

  const total = interaction.options.getInteger("joueurs", true);
  const compositionVisible = interaction.options.getBoolean("compo_visible");
  const reveal = interaction.options.getString("reveal");         // on_death | end | never
  const seerMode = interaction.options.getString("voyante");      // classic | chatty | none (on laisse pour compat)
  const allowSelf = interaction.options.getBoolean("cupidon_self");
  const randomCouple = interaction.options.getBoolean("cupidon_random");
  const rolesStr = interaction.options.getString("roles") || "";

  // Parse "loup=2 sorciere=1 ..." en objet counts
  const counts = {};
  for (const chunk of rolesStr.split(/\s+/).filter(Boolean)) {
    const m = chunk.match(/^([a-zA-Z0-9_]+)\s*=\s*(\d{1,2})$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const n = parseInt(m[2], 10);
    if (Number.isFinite(n) && n >= 0) counts[key] = n;
  }

  // Rôles uniques (on force max 1 si >1)
  const uniques = [
    "sorciere","salvateur","petite_fille","cupidon","ancien",
    "bouc","idiot","chasseur","capitaine","voyante","voyante_bavarde",
    "detective","montreur_ours","chien_loup","enfant_sauvage","infect_pere"
  ];
  for (const u of uniques) {
    if ((counts[u] || 0) > 1) counts[u] = 1;
  }
  // Rôles autorisés en multiple (ok tels quels) :
  // loup, simple_villageois (villageois), deux_soeurs (2 max en logique de jeu), trois_freres (3), etc.
  // (si tu veux brider deux_soeurs à 2 et trois_freres à 3, décommente ci-dessous)
  // if ((counts["deux_soeurs"]||0) > 2) counts["deux_soeurs"] = 2;
  // if ((counts["trois_freres"]||0) > 3) counts["trois_freres"] = 3;

  const res = gm.setConfig({
    total,
    counts,
    options: {
      compositionVisible,
      reveal,
      // seerMode devient inutile si tu mets carrément voyante=1 ou voyante_bavarde=1 dans roles,
      // mais on le laisse pour compat : le GM fera l’exclusivité si besoin.
      seerMode,
      cupidon: { allowSelf, randomCouple }
    }
  });

  return interaction.reply({ content: res.msg, ephemeral: true });
}

async function handleStart(interaction) {
  const gm = GameManager.fromChannel(interaction.client, interaction.channelId);
  if (!gm) return interaction.reply({ content: "❌ Pas un lobby Loup-Garou.", ephemeral: true });
  const ok = gm.canStart();
  if (!ok.ok) return interaction.reply({ content: `❌ ${ok.error}`, ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  await gm.startGame();
  return interaction.editReply("🚀 Partie lancée et lobby verrouillé.");
}

async function handleTable(interaction) {
  const gm = GameManager.fromChannel(interaction.client, interaction.channelId);
  if (!gm) return interaction.reply({ content: "❌ Pas un lobby Loup-Garou.", ephemeral: true });
  return interaction.reply({ content: gm.renderTable(), ephemeral: true });
}

async function handleStop(interaction) {
  const gm = GameManager.fromChannel(interaction.client, interaction.channelId);
  if (!gm) return interaction.reply({ content: "❌ Pas un lobby Loup-Garou.", ephemeral: true });
  await gm.stop();
  return interaction.reply({ content: "🛑 Partie nettoyée.", ephemeral: true });
}

// --- /lg help
async function handleHelp(interaction) {
  const txt =
`🆘 **Commandes Loup-Garou**
/lg create — Créer un lobby
/lg join — Rejoindre le lobby (à faire dans le salon du lobby)
/lg leave — Quitter le lobby
/lg kick @joueur — Éjecter un joueur avant le lancement
/lg config — Configurer la partie (joueurs, reveal, voyante si tu veux, rôles…)
/lg start — Démarrer la partie (verrouille le lobby)
/lg table — Afficher l'ordre de table
/lg stop — Arrêter et nettoyer
/lg roles — Liste des rôles et pouvoirs

**Exemples :**
/lg config joueurs:10 roles:"loup=3 simple_villageois=4 voyante=1 sorciere=1 petite_fille=1"
- Rôles uniques (max 1): voyante, voyante_bavarde, sorciere, salvateur, petite_fille, cupidon, ancien, bouc, idiot, chasseur, capitaine, detective, montreur_ours, chien_loup, enfant_sauvage, infect_pere
- Multiples autorisés: loup, simple_villageois (villageois), deux_soeurs, trois_freres
- Les rôles sont envoyés **en MP**.  
- Les Loups ont un salon privé pour discuter la nuit.`;
  return interaction.reply({ content: txt, ephemeral: true });
}

// --- /lg roles
async function handleRoles(interaction) {
  const roles = {
    loup: "Chaque nuit, les Loups se concertent et dévorent un joueur.",
    simple_villageois: "Aucun pouvoir, mais leur nombre fait la force du village.",
    voyante: "Chaque nuit, découvre secrètement le rôle d’un joueur (DM).",
    voyante_bavarde: "Comme la voyante, mais le rôle vu est annoncé publiquement le matin.",
    sorciere: "1 potion de vie + 1 potion de mort, chacune 1x par partie.",
    chasseur: "S’il meurt, il tire sur un joueur de son choix (immédiat).",
    cupidon: "Désigne deux amoureux en début de partie. Si l’un meurt, l’autre meurt de chagrin.",
    petite_fille: "Espionne le salon des Loups (messages relayés sans pseudo). 20% d’être repérée.",
    ancien: "Résiste à une 1ère attaque des Loups. Si le village le tue, les pouvoirs spéciaux sautent (selon variantes).",
    bouc: "Servira de bouc émissaire en cas d’égalité (variante).",
    idiot: "Si voté par le village, survit mais perd son droit de vote.",
    salvateur: "Protège un joueur chaque nuit (pas 2 fois de suite la même cible).",
    capitaine: "Voix qui compte double, et désigne son successeur à sa mort.",
    loup_blanc: "Loup qui peut éliminer un Loup (nuit impaire).",
    corbeau: "Chaque nuit, place +2 voix contre une cible pour le lendemain.",
    montreur_ours: "Chaque matin, indique si au moins un Loup est à côté de lui à la table (on saute les morts).",
    detective: "Peut comparer deux joueurs: même camp ou non (variante).",
    chien_loup: "Villageois qui peut basculer Loup s’il est attaqué.",
    enfant_sauvage: "Choisit un modèle nuit 0; devient Loup si le modèle meurt.",
    infect_pere: "Peut infecter une victime des Loups pour l’ajouter à la meute.",
    deux_soeurs: "Deux soeurs qui communiquent en privé.",
    trois_freres: "Trois frères qui communiquent en privé."
  };

  let desc = "**📜 Rôles & pouvoirs**\n\n";
  for (const [role, info] of Object.entries(roles)) {
    desc += `**${role}** — ${info}\n`;
  }
  desc += `\n**Rôles uniques (max 1)** : voyante, voyante_bavarde, sorciere, salvateur, petite_fille, cupidon, ancien, bouc, idiot, chasseur, capitaine, detective, montreur_ours, chien_loup, enfant_sauvage, infect_pere\n`;
  desc += `**Multiples autorisés** : loup, simple_villageois, deux_soeurs, trois_freres\n`;

  return interaction.reply({ content: desc.slice(0, 2000), ephemeral: true });
}

// --- login
client.login(process.env.TOKEN || client.config.token);

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
    if (sub === "help")   return handleHelp(interaction);  // <— ajouté
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
  const seerMode = interaction.options.getString("voyante");      // classic | chatty | none
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

  const res = gm.setConfig({
    total,
    counts,
    options: {
      compositionVisible,
      reveal,
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
/lg config — Configurer la partie (joueurs, voyante, reveal, rôles…)
/lg start — Démarrer la partie (verrouille le lobby)
/lg table — Afficher l'ordre de table
/lg stop — Arrêter et nettoyer

**Astuce :**
- Fais \`/lg config\` (ex: \`joueurs:7 loup:2 voyante:classic sorciere:1 petite_fille:1\`) puis \`/lg start\`.
- Les rôles sont envoyés **en MP**. Les Loups ont un salon privé.`;
  return interaction.reply({ content: txt, ephemeral: true });
}

// --- login
client.login(process.env.TOKEN || client.config.token);

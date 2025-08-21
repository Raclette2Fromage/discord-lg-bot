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
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.games = new Collection();
client.config = configJson;

client.once("ready", async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  try {
    if (client.config.guildId) {
      await registerGuildCommands(client);
      console.log("✅ Slash commands enregistrées (guild)");
    } else {
      console.log("ℹ️ Aucune guildId fournie dans config.json — enregistrement global non géré ici.");
    }
  } catch (e) {
    console.error("❌ Erreur enregistrement des commandes:", e);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "lg") return;

    const sub = interaction.options.getSubcommand();
    if (sub === "create") return handleCreate(interaction);
    if (sub === "join") return handleJoin(interaction);
    if (sub === "leave") return handleLeave(interaction);
    if (sub === "kick") return handleKick(interaction);
    if (sub === "config") return handleConfig(interaction);
    if (sub === "start") return handleStart(interaction);
    if (sub === "table") return handleTable(interaction);
    if (sub === "compo") return handleCompo(interaction);
    if (sub === "stop") return handleStop(interaction);
    if (sub === "help") return handleHelp(interaction);
    if (sub === "roles") return handleRoles(interaction);
  } catch (e) {
    console.error(e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ Erreur: ${e?.message ?? "inconnue"}`,
        ephemeral: true,
      });
    }
  }
});

// ===== handlers =====
async function handleCreate(interaction) {
  const gm = await GameManager.createLobby(
    interaction.client,
    interaction.guild,
    interaction.user
  );
  await interaction.reply({
    content: `Lobby créé: <#${gm.lobby.id}>`,
    ephemeral: true,
  });
}

async function handleJoin(interaction) {
  const gm = GameManager.fromChannel(
    interaction.client,
    interaction.channelId
  );
  if (!gm)
    return interaction.reply({
      content: "❌ Pas un lobby Loup-Garou.",
      ephemeral: true,
    });
  const res = gm.addPlayer(interaction.user);
  return interaction.reply({ content: res.msg, ephemeral: false });
}

async function handleLeave(interaction) {
  const gm = GameManager.fromChannel(
    interaction.client,
    interaction.channelId
  );
  if (!gm)
    return interaction.reply({
      content: "❌ Pas un lobby Loup-Garou.",
      ephemeral: true,
    });

  const res = gm.removePlayer(interaction.user.id);
  return interaction.reply({ content: res.msg, ephemeral: false });
}

async function handleKick(interaction) {
  const gm = GameManager.fromChannel(
    interaction.client,
    interaction.channelId
  );
  if (!gm)
    return interaction.reply({
      content: "❌ Pas un lobby Loup-Garou.",
      ephemeral: true,
    });
  const target = interaction.options.getUser("user", true);
  const res = gm.kickBeforeStart(target.id);
  return interaction.reply({ content: res.msg, ephemeral: false });
}

async function handleConfig(interaction) {
  const gm = GameManager.fromChannel(
    interaction.client,
    interaction.channelId
  );
  if (!gm)
    return interaction.reply({
      content: "❌ Pas un lobby Loup-Garou.",
      ephemeral: true,
    });

  // Inputs
  const totalIn = interaction.options.getInteger("joueurs", true);
  const compositionVisible = !!interaction.options.getBoolean("compo_visible");
  const reveal = interaction.options.getString("reveal"); // ex: "never"|"on_death"|"at_end"
  const seerMode = interaction.options.getString("voyante"); // "classic" | "bavarde" | null
  const allowSelf = !!interaction.options.getBoolean("cupidon_self");
  const randomCouple = !!interaction.options.getBoolean("cupidon_random");
  const rolesStr = interaction.options.getString("roles") || "";

  // Parse roles "clé=nombre"
  const counts = {};
  for (const chunk of rolesStr.split(/\s+/).filter(Boolean)) {
    const m = chunk.match(/^([a-zA-Z0-9_]+)\s*=\s*(\d{1,2})$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const n = parseInt(m[2], 10);
    if (Number.isFinite(n) && n >= 0) counts[key] = n;
  }

  // --- Contraintes rôles uniques (max 1)
  const uniques = [
    "sorciere",
    "salvateur",
    "petite_fille",
    "cupidon",
    "ancien",
    "bouc",
    "idiot",
    "chasseur",
    "capitaine",
    "voyante",
    "voyante_bavarde",
    "detective",
    "montreur_ours",
    "chien_loup",
    "enfant_sauvage",
    "infect_pere",
  ];
  for (const u of uniques) {
    if ((counts[u] || 0) > 1) counts[u] = 1;
  }

  // --- Exclusivité Voyante vs Voyante bavarde
  if ((counts.voyante || 0) > 0 && (counts.voyante_bavarde || 0) > 0) {
    const mode = seerMode || "classic";
    if (mode === "bavarde") {
      counts.voyante = 0;
      counts.voyante_bavarde = 1;
    } else {
      counts.voyante = 1;
      counts.voyante_bavarde = 0;
    }
  }

  // --- (Optionnel) bornes pour groupes
  if ((counts["deux_soeurs"] || 0) > 2) counts["deux_soeurs"] = 2;
  if ((counts["trois_freres"] || 0) > 3) counts["trois_freres"] = 3;

  // --- Total cohérent
  const sumRoles = Object.values(counts).reduce(
    (a, b) => a + (b || 0),
    0
  );
  let total = Number.isInteger(totalIn) && totalIn > 0 ? totalIn : sumRoles;
  if (total < sumRoles) total = sumRoles;

  // --- Appel GameManager
  const res = gm.setConfig({
    total,
    counts,
    options: {
      compositionVisible,
      reveal,
      seerMode,
      cupidon: { allowSelf, randomCouple },
    },
  });

  // Réponse à l’auteur de la config
  await interaction.reply({
    content: res?.msg ?? "✅ Configuration appliquée.",
    ephemeral: true,
  });

  // Annonce publique si compo visible
  if (compositionVisible && gm.lobby?.send) {
    await gm.lobby.send(gm.renderCompositionSummary());
    await gm.lobby.send("ℹ️ La composition est visible. À tout moment : `/lg compo`.");
  }
}

async function handleStart(interaction) {
  const gm = GameManager.fromChannel(
    interaction.client,
    interaction.channelId
  );
  if (!gm)
    return interaction.reply({
      content: "❌ Pas un lobby Loup-Garou.",
      ephemeral: true,
    });
  const ok = gm.canStart();
  if (!ok.ok)
    return interaction.reply({ content: `❌ ${ok.error}`, ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  await gm.startGame();
  return interaction.editReply("🚀 Partie lancée et lobby verrouillé.");
}

async function handleTable(interaction) {
  const gm = GameManager.fromChannel(
    interaction.client,
    interaction.channelId
  );
  if (!gm)
    return interaction.reply({
      content: "❌ Pas un lobby Loup-Garou.",
      ephemeral: true,
    });
  return interaction.reply({ content: gm.renderTable(), ephemeral: true });
}

async function handleCompo(interaction) {
  const gm = GameManager.fromChannel(
    interaction.client,
    interaction.channelId
  );
  if (!gm)
    return interaction.reply({
      content: "❌ Pas un lobby Loup-Garou.",
      ephemeral: true,
    });

  const visible = !!gm.config?.options?.compositionVisible;
  if (!visible) {
    return interaction.reply({
      content: "👀 La composition est **cachée** pour cette partie.",
      ephemeral: true,
    });
  }

  return interaction.reply({
    content: gm.renderCompositionSummary(),
    ephemeral: false,
  });
}

async function handleStop(interaction) {
  const gm = GameManager.fromChannel(
    interaction.client,
    interaction.channelId
  );
  if (!gm)
    return interaction.reply({
      content: "❌ Pas un lobby Loup-Garou.",
      ephemeral: true,
    });
  await gm.stop();
  return interaction.reply({ content: "🛑 Partie nettoyée.", ephemeral: true });
}

// --- /lg help
async function handleHelp(interaction) {
  const txt = `🆘 **Commandes Loup-Garou**
/lg create — Créer un lobby
/lg join — Rejoindre le lobby (à faire dans le salon du lobby)
/lg leave — Quitter le lobby
/lg kick @joueur — Éjecter un joueur avant le lancement
/lg config — Configurer la partie (joueurs, reveal, voyante si tu veux, rôles…)
/lg start — Démarrer la partie (verrouille le lobby)
/lg table — Afficher l'ordre de table
/lg compo — Afficher la composition (si visible)
/lg stop — Arrêter et nettoyer
/lg roles — Liste des rôles et pouvoirs

**Astuce :**
/lg config joueurs:10 roles:"loup=3 simple_villageois=4 voyante=1 sorciere=1 petite_fille=1"
- Rôles uniques (max 1): voyante, voyante_bavarde, sorciere, salvateur, petite_fille, cupidon, ancien, bouc, idiot, chasseur, capitaine, detective, montreur_ours, chien_loup, enfant_sauvage, infect_pere
- Multiples autorisés: loup, simple_villageois (villageois), deux_soeurs, trois_freres
- Les rôles sont envoyés **en MP**.  
- Les Loups ont un salon privé pour discuter la nuit.`;
  return interaction.reply({ content: txt, ephemeral: true });
}

// --- /lg roles
async function handleRoles(interaction) {
  return interaction.reply({
    content:
      "📖 La liste complète des rôles est disponible ici :\n🔗 https://docs.google.com/document/d/18Pd5fENRE_cKOBwKacRU6RyVD0Du-aqrFPqtTYIaBZ8/edit?tab=t.0",
    ephemeral: true,
  });
}

// --- login
client.login(process.env.TOKEN || client.config.token);

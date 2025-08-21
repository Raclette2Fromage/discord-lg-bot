import { REST, Routes, SlashCommandBuilder } from "discord.js";
import configJson from "../config.json" assert { type: "json" };
import { roleKeysForConfig } from "./game/roles.js";

function buildLGCommand() {
  const roleKeys = roleKeysForConfig();
  const lg = new SlashCommandBuilder()
    .setName("lg")
    .setDescription("Loup-Garou configurable")

    // Lobby
    .addSubcommand(s => s.setName("create").setDescription("Créer un lobby"))
    .addSubcommand(s => s.setName("join").setDescription("Rejoindre le lobby"))
    .addSubcommand(s => s.setName("leave").setDescription("Quitter le lobby"))
    .addSubcommand(s =>
      s.setName("kick").setDescription("Éjecter un joueur avant le lancement")
        .addUserOption(o => o.setName("user").setDescription("Joueur à éjecter").setRequired(true))
    )

    // Config
    .addSubcommand(s => {
      s.setName("config").setDescription("Configurer la partie");
      s.addIntegerOption(o => o.setName("joueurs").setDescription("Nombre total de joueurs").setRequired(true));
      s.addBooleanOption(o => o.setName("compo_visible").setDescription("Annoncer la composition"));
      s.addStringOption(o => o.setName("reveal").setDescription("Révélation des rôles").addChoices(
        { name: "À la mort", value: "on_death" },
        { name: "À la fin", value: "end" },
        { name: "Jamais", value: "never" }
      ));
      s.addStringOption(o => o.setName("voyante").setDescription("Type de Voyante").addChoices(
        { name: "Classique", value: "classic" },
        { name: "Bavarde", value: "chatty" },
        { name: "Aucune", value: "none" }
      ));
      s.addBooleanOption(o => o.setName("cupidon_self").setDescription("Cupidon peut être dans le couple"));
      s.addBooleanOption(o => o.setName("cupidon_random").setDescription("Couple aléatoire"));
      for (const k of roleKeys) {
        s.addIntegerOption(o => o.setName(k).setDescription(`# ${k} (optionnel)`).setMinValue(0));
      }
      return s;
    })

    // Démarrage / infos
    .addSubcommand(s => s.setName("start").setDescription("Démarrer la partie"))
    .addSubcommand(s => s.setName("table").setDescription("Voir l'ordre de table"))
    .addSubcommand(s => s.setName("stop").setDescription("Arrêter/nettoyer"))
    .addSubcommand(s => s.setName("help").setDescription("Afficher l’aide et les commandes"));

  return lg;
}

// 1) Export pour l’appel depuis index.js
export async function registerGuildCommands(client) {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN || configJson.token);
  const body = [buildLGCommand().toJSON()];
  await rest.put(
    Routes.applicationGuildCommands(configJson.clientId, configJson.guildId),
    { body }
  );
  console.log("✅ Guild slash commands enregistrées (via client).");
}

// 2) Auto-exécution si lancé via `npm run register`
if (process.argv[1]?.endsWith("commands.js")) {
  (async () => {
    try {
      const rest = new REST({ version: "10" }).setToken(process.env.TOKEN || configJson.token);
      const body = [buildLGCommand().toJSON()];
      await rest.put(
        Routes.applicationGuildCommands(configJson.clientId, configJson.guildId),
        { body }
      );
      console.log("✅ Guild slash commands enregistrées (via npm run register).");
      process.exit(0);
    } catch (e) {
      console.error("❌ Erreur enregistrement commands:", e);
      process.exit(1);
    }
  })();
}

import { REST, Routes, SlashCommandBuilder } from "discord.js"; 
import configJson from "../config.json" assert { type: "json" };

function buildLGCommand() {
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

    // Config (<= 25 options)
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
      // Option compacte pour la compo des rôles
      s.addStringOption(o => o
        .setName("roles")
        .setDescription("Ex: loup=2 sorciere=1 petite_fille=1 cupidon=1 salvateur=1")
      );
      return s;
    })

    // Démarrage / infos
    .addSubcommand(s => s.setName("start").setDescription("Démarrer la partie"))
    .addSubcommand(s => s.setName("table").setDescription("Voir l'ordre de table"))
    .addSubcommand(s => s.setName("stop").setDescription("Arrêter/nettoyer"))
    .addSubcommand(s => s.setName("help").setDescription("Afficher l’aide et les commandes"))
    .addSubcommand(s => s.setName("roles").setDescription("Lister tous les rôles et leurs pouvoirs")); // ← AJOUTÉ

  return lg;
}

// Export pour index.js
export async function registerGuildCommands(client) {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN || configJson.token);
  const body = [buildLGCommand().toJSON()];
  await rest.put(
    Routes.applicationGuildCommands(configJson.clientId, configJson.guildId),
    { body }
  );
  console.log("✅ Guild slash commands enregistrées.");
}

// Auto-exécution pour `npm run register`
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

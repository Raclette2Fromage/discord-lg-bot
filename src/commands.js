import { REST, Routes, SlashCommandBuilder } from "discord.js";
import configJson from "../config.json" assert { type: "json" };
import { ROLE_CATALOG, roleKeysForConfig } from "./game/roles.js";


export async function registerGuildCommands(client) {
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN || configJson.token);


const roleKeys = roleKeysForConfig();


const lg = new SlashCommandBuilder()
.setName("lg").setDescription("Loup-Garou configurable")
.addSubcommand(s => s.setName("create").setDescription("Créer un lobby"))
.addSubcommand(s => s.setName("join").setDescription("Rejoindre le lobby"))
.addSubcommand(s => s.setName("leave").setDescription("Quitter le lobby"))
.addSubcommand(s =>
s.setName("kick").setDescription("Éjecter un joueur avant le lancement")
.addUserOption(o=>o.setName("user").setDescription("Joueur à éjecter").setRequired(true))
)
.addSubcommand(s => {
s.setName("config").setDescription("Configurer la partie");
s.addIntegerOption(o=>o.setName("joueurs").setDescription("Nombre total de joueurs").setRequired(true));
s.addBooleanOption(o=>o.setName("compo_visible").setDescription("Annoncer la composition"));
s.addStringOption(o=>o.setName("reveal").setDescription("Révélation des rôles")
.addChoices(
{ name: "À la mort", value: "on_death" },
{ name: "À la fin", value: "end" },
{ name: "Jamais", value: "never" }
)
);
s.addStringOption(o=>o.setName("voyante").setDescription("Type de Voyante")
.addChoices(
{ name: "Classique", value: "classic" },
{ name: "Bavarde", value: "chatty" },
{ name: "Aucune", value: "none" }
)
);
s.addBooleanOption(o=>o.setName("cupidon_self").setDescription("Cupidon peut être dans le couple"));
s.addBooleanOption(o=>o.setName("cupidon_random").setDescription("Couple aléatoire"));
for (const k of roleKeys) {
s.addIntegerOption(o => o.setName(k).setDescription(`# ${k} (optionnel)`).setMinValue(0));
}
return s;
})
.addSubcommand(s => s.setName("start").setDescription("Démarrer la partie"))
.addSubcommand(s => s.setName("table").setDescription("Voir l'ordre de table"))
.addSubcommand(s => s.setName("stop").setDescription("Arrêter/nettoyer"));


const body = [lg.toJSON()];
await rest.put(
Routes.applicationGuildCommands(configJson.clientId, configJson.guildId),
{ body }
);
}

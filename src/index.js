import { Client, GatewayIntentBits, Partials, Collection } from "discord.js";
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
const reveal = interaction.options.getString("reveal"); // on_death|end|never
const seerMode = interaction.options.getString("voyante"); // classic|chatty|none
const allowSelf = interaction.options.getBoolean("cupidon_self");
const randomCouple = interaction.options.getBoolean("cupidon_random");


// Rôles: compter options dynamiques
const counts = gm.countsFromInteraction(interaction);


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


client.login(process.env.TOKEN || client.config.token);

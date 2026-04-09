const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('example')
        .setDescription('An example command to demonstrate structure'),
    async execute(interaction) {
        await interaction.reply('This is an example command!');
    }
};
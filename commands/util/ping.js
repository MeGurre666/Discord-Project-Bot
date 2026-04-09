const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency and API response time'),
    
    async execute(interaction) {
        await interaction.deferReply();
        const sent = await interaction.fetchReply();
        
        const wsLatency = interaction.client.ws.ping;
        const apiLatency = sent.createdTimestamp - interaction.createdTimestamp;
        
        const getLatencyQuality = (ms) => {
            if (ms < 100) return { emoji: '🟢', text: 'Excellent' };
            if (ms < 200) return { emoji: '🟡', text: 'Good' };
            if (ms < 400) return { emoji: '🔴', text: 'Fair' };
            return { emoji: '🔴', text: 'Poor' };
        };
        
        const wsQuality = getLatencyQuality(wsLatency);
        const apiQuality = getLatencyQuality(apiLatency);

        const embed = new EmbedBuilder()
            .setColor(wsLatency < 200 ? 0x00ff00 : wsLatency < 400 ? 0xff9900 : 0xff0000)
            .setTitle('🏓 Pong!')
            .addFields(
                { 
                    name: `${wsQuality.emoji} Websocket Latency`, 
                    value: `\`${wsLatency}ms\` - ${wsQuality.text}`, 
                    inline: true 
                },
                { 
                    name: `${apiQuality.emoji} API Latency`, 
                    value: `\`${apiLatency}ms\` - ${apiQuality.text}`, 
                    inline: true 
                }
            )
            .setTimestamp()
            .setFooter({ text: `Requested by ${interaction.user.tag}` });
        
        await interaction.editReply({ embeds: [embed] });
    }
};
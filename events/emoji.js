const { Events } = require('discord.js');
const { syncIndividualEmoji } = require('../utils/sync');
const { wrapEventHandler } = require('../utils/eventHelpers');
const { logEvent } = require('../utils/dbLogger');

async function handleEmojiSync(emoji, eventType) {
    const guild = emoji.guild;
    const emojiId = emoji.id;
    
    logEvent(eventType, {
        guildId: guild.id,
        guildName: guild.name,
        emojiId: emojiId,
        emojiName: emoji.name,
        emojiUrl: emoji.url,
        isAnimated: emoji.animated,
        createdAt: emoji.createdTimestamp
    }).catch(() => {});
    
    await syncIndividualEmoji(guild, emojiId);
}

module.exports = [
    {
        name: Events.GuildEmojiCreate,
        execute: wrapEventHandler('GuildEmojiCreate', (emoji) => handleEmojiSync(emoji, 'GuildEmojiCreate'))
    },
    {
        name: Events.GuildEmojiDelete,
        execute: wrapEventHandler('GuildEmojiDelete', (emoji) => handleEmojiSync(emoji, 'GuildEmojiDelete'))
    },
    {
        name: Events.GuildEmojiUpdate,
        execute: wrapEventHandler('GuildEmojiUpdate', (emoji) => handleEmojiSync(emoji, 'GuildEmojiUpdate'))
    }
];
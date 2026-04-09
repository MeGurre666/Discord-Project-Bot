const { Events } = require('discord.js');
const { syncMessage } = require('../utils/sync');
const { wrapEventHandler } = require('../utils/eventHelpers');
const { SYNC_OPERATIONS } = require('../utils/constants');
const { logEvent } = require('../utils/dbLogger');

module.exports = [
    {
        name: Events.MessageCreate,
        execute: wrapEventHandler('MessageCreate', async (message) => {
            logEvent('MessageCreate', {
                messageId: message.id,
                guildId: message.guildId,
                channelId: message.channelId,
                authorId: message.author.id,
                authorName: message.author.username,
                contentLength: message.content.length,
                hasEmbeds: message.embeds.length > 0,
                hasAttachments: message.attachments.size > 0
            }).catch(() => {});
            
            await syncMessage(message, null, SYNC_OPERATIONS.CREATE);
        })
    },
    {
        name: Events.MessageDelete,
        execute: wrapEventHandler('MessageDelete', async (message) => {
            logEvent('MessageDelete', {
                messageId: message.id,
                guildId: message.guildId,
                channelId: message.channelId,
                authorId: message.author?.id || 'unknown',
                authorName: message.author?.username || 'unknown'
            }).catch(() => {});
            
            await syncMessage(message, null, SYNC_OPERATIONS.DELETE);
        })
    },
    {
        name: Events.MessageUpdate,
        execute: wrapEventHandler('MessageUpdate', async (oldMessage, newMessage) => {
            logEvent('MessageUpdate', {
                messageId: newMessage.id,
                guildId: newMessage.guildId,
                channelId: newMessage.channelId,
                authorId: newMessage.author.id,
                authorName: newMessage.author.username,
                oldContentLength: oldMessage.content.length,
                newContentLength: newMessage.content.length
            }).catch(() => {});
            
            await syncMessage(newMessage, { oldMessage, newMessage }, SYNC_OPERATIONS.UPDATE);
        })
    }
];
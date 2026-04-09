const { Events, AuditLogEvent } = require('discord.js');
const { syncIndividualChannel } = require('../utils/sync');
const { wrapEventHandler } = require('../utils/eventHelpers');
const { logEvent } = require('../utils/dbLogger');

async function handleChannelSync(channel, eventType, changes = null) {
    const guild = channel.guild;
    const channelId = channel.id;
    
    const logData = {
        guildId: guild.id,
        guildName: guild.name,
        channelId: channelId,
        channelName: channel.name,
        channelType: channel.type,
        isNSFW: channel.nsfw || false,
        topic: channel.topic || null,
        position: channel.position || null
    };
    
    if (channel.guild && eventType !== 'ChannelCreate') {
        try {
            const auditLogs = await guild.fetchAuditLogs({ 
                limit: 1,
                type: eventType === 'ChannelDelete' ? AuditLogEvent.ChannelDelete : AuditLogEvent.ChannelUpdate
            });
            const logEntry = auditLogs.entries.first();
            if (logEntry && logEntry.targetId === channelId) {
                logData.executorId = logEntry.executorId;
                logData.executorName = logEntry.executor?.username || 'Unknown';
                logData.reason = logEntry.reason || null;
            }
        } catch (error) {}
    }
    
    if (changes) {
        logData.changes = changes;
    }
    
    logEvent(eventType, logData).catch(() => {});
    
    await syncIndividualChannel(guild, channelId);
}

async function trackChannelChanges(oldChannel, newChannel) {
    const changes = {};
    
    if (oldChannel.name !== newChannel.name) {
        changes.name = {
            old: oldChannel.name,
            new: newChannel.name
        };
    }

    if (oldChannel.topic !== newChannel.topic) {
        changes.topic = {
            old: oldChannel.topic || 'None',
            new: newChannel.topic || 'None'
        };
    }
    
    if (oldChannel.nsfw !== newChannel.nsfw) {
        changes.nsfw = {
            old: oldChannel.nsfw,
            new: newChannel.nsfw
        };
    }
    
    if (oldChannel.permissionOverwrites.cache.size !== newChannel.permissionOverwrites.cache.size) {
        changes.permissionOverwrites = {
            old: oldChannel.permissionOverwrites.cache.size,
            new: newChannel.permissionOverwrites.cache.size
        };
    }
    
    if (oldChannel.position !== newChannel.position) {
        changes.position = {
            old: oldChannel.position,
            new: newChannel.position
        };
    }
    
    if (oldChannel.parentId !== newChannel.parentId) {
        const oldParent = oldChannel.parent?.name || 'None';
        const newParent = newChannel.parent?.name || 'None';
        changes.parent = {
            old: oldParent,
            new: newParent
        };
    }
    
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.slowmode = {
            old: oldChannel.rateLimitPerUser || 0,
            new: newChannel.rateLimitPerUser || 0
        };
    }
    
    return changes;
}

module.exports = [
    {
        name: Events.ChannelCreate,
        execute: wrapEventHandler('ChannelCreate', (channel) => handleChannelSync(channel, 'ChannelCreate'))
    },
    {
        name: Events.ChannelDelete,
        execute: wrapEventHandler('ChannelDelete', (channel) => handleChannelSync(channel, 'ChannelDelete'))
    },
    {
        name: Events.ChannelUpdate,
        execute: wrapEventHandler('ChannelUpdate', async (oldChannel, newChannel) => {
            const changes = await trackChannelChanges(oldChannel, newChannel);
            
            if (Object.keys(changes).length > 0) {
                await handleChannelSync(newChannel, 'ChannelUpdate', changes);
            }
        })
    }
];

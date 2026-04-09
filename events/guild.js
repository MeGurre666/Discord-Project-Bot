const { Events, AuditLogEvent } = require('discord.js');
const { syncIndividualGuild, syncFullGuild } = require('../utils/sync');
const { wrapEventHandler } = require('../utils/eventHelpers');
const { logInfo, logSuccess } = require('../utils/logger');
const { logEvent } = require('../utils/dbLogger');

async function trackGuildChanges(oldGuild, newGuild) {
    const changes = {};
    
    if (oldGuild.name !== newGuild.name) {
        changes.name = {
            old: oldGuild.name,
            new: newGuild.name
        };
    }
    
    if (oldGuild.iconURL() !== newGuild.iconURL()) {
        changes.icon = {
            changed: true
        };
    }

    if (oldGuild.bannerURL() !== newGuild.bannerURL()) {
        changes.banner = {
            changed: true
        };
    }

    if (oldGuild.splashURL() !== newGuild.splashURL()) {
        changes.splash = {
            changed: true
        };
    }

    if (oldGuild.description !== newGuild.description) {
        changes.description = {
            old: oldGuild.description || 'None',
            new: newGuild.description || 'None'
        };
    }

    if (oldGuild.ownerId !== newGuild.ownerId) {
        changes.owner = {
            old: oldGuild.ownerId,
            new: newGuild.ownerId
        };
    }

    if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
        changes.verificationLevel = {
            old: oldGuild.verificationLevel,
            new: newGuild.verificationLevel
        };
    }

    if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) {
        changes.explicitContentFilter = {
            old: oldGuild.explicitContentFilter,
            new: newGuild.explicitContentFilter
        };
    }

    if (oldGuild.defaultMessageNotifications !== newGuild.defaultMessageNotifications) {
        changes.defaultMessageNotifications = {
            old: oldGuild.defaultMessageNotifications,
            new: newGuild.defaultMessageNotifications
        };
    }

    if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
        changes.afkChannel = {
            old: oldGuild.afkChannel?.name || 'None',
            new: newGuild.afkChannel?.name || 'None'
        };
    }

    if (oldGuild.afkTimeout !== newGuild.afkTimeout) {
        changes.afkTimeout = {
            old: oldGuild.afkTimeout,
            new: newGuild.afkTimeout
        };
    }

    if (oldGuild.systemChannelId !== newGuild.systemChannelId) {
        changes.systemChannel = {
            old: oldGuild.systemChannel?.name || 'None',
            new: newGuild.systemChannel?.name || 'None'
        };
    }

    if (oldGuild.rulesChannelId !== newGuild.rulesChannelId) {
        changes.rulesChannel = {
            old: oldGuild.rulesChannel?.name || 'None',
            new: newGuild.rulesChannel?.name || 'None'
        };
    }

    if (oldGuild.publicUpdatesChannelId !== newGuild.publicUpdatesChannelId) {
        changes.publicUpdatesChannel = {
            old: oldGuild.publicUpdatesChannel?.name || 'None',
            new: newGuild.publicUpdatesChannel?.name || 'None'
        };
    }

    if (oldGuild.premiumTier !== newGuild.premiumTier) {
        changes.boostLevel = {
            old: oldGuild.premiumTier,
            new: newGuild.premiumTier
        };
    }
    
    return changes;
}

module.exports = [
    {
        name: Events.GuildCreate,
        execute: wrapEventHandler('GuildCreate', async (guild) => {
            logInfo(`Bot added to guild: ${guild.name} (${guild.id})`);

            logEvent('GuildCreate', {
                guildId: guild.id,
                guildName: guild.name,
                guildOwnerId: guild.ownerId,
                guildMemberCount: guild.memberCount,
                guildCreatedAt: guild.createdTimestamp
            }).catch(() => {});
            
            await syncFullGuild(guild);
            logSuccess(`Fully synced new guild: ${guild.name}`);
        })
    },
    {
        name: Events.GuildDelete,
        execute: wrapEventHandler('GuildDelete', async (guild) => {
            const guildId = guild.id;
            const client = guild.client;
            
            let executorId = null;
            let executorName = null;

            try {
                const auditLogs = await guild.fetchAuditLogs({ 
                    limit: 1,
                    type: AuditLogEvent.GuildUpdate
                });
                const logEntry = auditLogs.entries.first();
                if (logEntry) {
                    executorId = logEntry.executorId;
                    executorName = logEntry.executor?.username || 'Unknown';
                }
            } catch (error) {}

            logEvent('GuildDelete', {
                guildId: guildId,
                guildName: guild.name,
                guildMemberCount: guild.memberCount,
                executorId: executorId,
                executorName: executorName
            }).catch(() => {});
            
            await syncIndividualGuild(client, guildId);
        })
    },
    {
        name: Events.GuildUpdate,
        execute: wrapEventHandler('GuildUpdate', async (oldGuild, newGuild) => {
            const guildId = newGuild.id;
            const client = newGuild.client;
            
            const changes = await trackGuildChanges(oldGuild, newGuild);

            if (Object.keys(changes).length > 0) {
                let executorId = null;
                let executorName = null;

                try {
                    const auditLogs = await newGuild.fetchAuditLogs({ 
                        limit: 1,
                        type: AuditLogEvent.GuildUpdate
                    });
                    const logEntry = auditLogs.entries.first();
                    if (logEntry) {
                        executorId = logEntry.executorId;
                        executorName = logEntry.executor?.username || 'Unknown';
                    }
                } catch (error) {}
                
                logEvent('GuildUpdate', {
                    guildId: guildId,
                    guildName: newGuild.name,
                    guildMemberCount: newGuild.memberCount,
                    changes: changes,
                    executorId: executorId,
                    executorName: executorName
                }).catch(() => {});
            }
            
            await syncIndividualGuild(client, guildId);
        })
    }
];
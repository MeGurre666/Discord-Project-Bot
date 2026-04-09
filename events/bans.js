const { Events, AuditLogEvent } = require('discord.js');
const { syncIndividualBan } = require('../utils/sync');
const { wrapEventHandler } = require('../utils/eventHelpers');
const { logEvent } = require('../utils/dbLogger');
const { logError, logInfo, logWarn } = require('../utils/logger');
const { getState } = require('../utils/config');

const debugEnabled = getState('debug', false);

async function fetchBanExecutor(guild, userId, eventType, retries = 3) {
    let lastError = null;
    
    logInfo(`Attempting to fetch audit logs for ban event: ${eventType} on user ${userId}`, 'bans');
    
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            if (attempt > 0) {
                const delay = 100 * (attempt + 1);
                logInfo(`Retry attempt ${attempt + 1} after ${delay}ms delay`, 'bans');
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            const auditLogType = eventType === 'GuildBanAdd' ? AuditLogEvent.MemberBanAdd : AuditLogEvent.MemberBanRemove;
            const auditLogs = await guild.fetchAuditLogs({ 
                limit: 5,
                type: auditLogType
            });
            
            logInfo(`Fetched ${auditLogs.entries.size} audit log entries`, 'bans');
            
            const banLog = auditLogs.entries.find(entry => entry.targetId === userId);
            
            if (banLog) {
                logInfo(`Found matching audit log entry for user ${userId}`, 'bans');
                return {
                    executorId: banLog.executorId,
                    executorName: banLog.executor?.username || 'Unknown',
                    reason: banLog.reason || null,
                    timestamp: banLog.createdTimestamp
                };
            } else {
                logWarn(`No matching audit log entry found for user ${userId} in attempt ${attempt + 1}`, 'bans');
            }
        } catch (error) {
            lastError = error;
            logError(`Audit log fetch attempt ${attempt + 1} failed`, error, 'bans');
        }
    }
    
    logWarn(`Could not retrieve executor info from audit logs for user ${userId} after ${retries} attempts`, 'bans');
    
    return {
        executorId: null,
        executorName: null,
        reason: null,
        timestamp: null
    };
}

module.exports = [
    {
        name: Events.GuildBanAdd,
        execute: wrapEventHandler('GuildBanAdd', async (ban) => {
            if (debugEnabled) {
                console.log('=== GuildBanAdd Event Fired ===');
            }
            const guild = ban.guild;
            const userId = ban.user.id;
            
            logInfo(`Ban event detected: ${ban.user.username} (${userId}) banned from ${guild.name}`, 'bans');
            
            const { executorId, executorName, reason: auditReason } = await fetchBanExecutor(guild, userId, 'GuildBanAdd');
            
            const finalReason = auditReason || ban.reason || null;
            
            const logData = {
                guildId: guild.id,
                guildName: guild.name,
                userId: userId,
                username: ban.user.username,
                reason: finalReason,
                executorId: executorId,
                executorName: executorName,
                action: 'BAN'
            };
            
            if (debugEnabled) {
                console.log('Ban log data:', JSON.stringify(logData, null, 2));
            }
            
            try {
                await logEvent('GuildBanAdd', logData);
                logInfo(`Successfully logged ban to database`, 'bans');
            } catch (error) {
                logError(`Failed to log ban to database`, error, 'bans');
            }
            
            await syncIndividualBan(guild, userId, finalReason);
        })
    },
    {
        name: Events.GuildBanRemove,
        execute: wrapEventHandler('GuildBanRemove', async (ban) => {
            if (debugEnabled) {
                console.log('=== GuildBanRemove Event Fired ===');
            }
            const guild = ban.guild;
            const userId = ban.user.id;
            
            logInfo(`Unban event detected: ${ban.user.username} (${userId}) unbanned from ${guild.name}`, 'bans');

            const { executorId, executorName } = await fetchBanExecutor(guild, userId, 'GuildBanRemove');
            
            const logData = {
                guildId: guild.id,
                guildName: guild.name,
                userId: userId,
                username: ban.user.username,
                executorId: executorId,
                executorName: executorName,
                action: 'UNBAN'
            };
            
            if (debugEnabled) {
                console.log('Unban log data:', JSON.stringify(logData, null, 2));
            }
            
            try {
                await logEvent('GuildBanRemove', logData);
                logInfo(`Successfully logged unban to database`, 'bans');
            } catch (error) {
                logError(`Failed to log unban to database`, error, 'bans');
            }
            
            await syncIndividualBan(guild, userId, null);
        })
    }
];
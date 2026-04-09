const { Events, AuditLogEvent } = require('discord.js');
const { wrapEventHandler } = require('../utils/eventHelpers');
const { logEvent } = require('../utils/dbLogger');

module.exports = [
    {
        name: Events.GuildAuditLogEntryCreate,
        execute: wrapEventHandler('GuildAuditLogEntryCreate', async (auditLogEntry, guild) => {
            if (auditLogEntry.action === AuditLogEvent.MemberUpdate && auditLogEntry.changes) {
                const changes = auditLogEntry.changes;
                const timeoutChange = changes.find(change => change.key === 'communication_disabled_until');
                
                if (timeoutChange) {
                    const targetId = auditLogEntry.targetId;
                    const executorId = auditLogEntry.executorId;
                    const reason = auditLogEntry.reason || null;
                    
                    const oldTimeout = timeoutChange.old;
                    const newTimeout = timeoutChange.new;
                    
                    if (newTimeout && !oldTimeout) {
                        logEvent('MemberTimeout', {
                            guildId: guild.id,
                            guildName: guild.name,
                            userId: targetId,
                            userName: auditLogEntry.target?.username || 'Unknown',
                            executorId: executorId,
                            executorName: auditLogEntry.executor?.username || 'Unknown',
                            timeoutUntil: newTimeout,
                            reason: reason,
                            action: 'TIMEOUT_ADD'
                        }).catch(() => {});
                    } else if (!newTimeout && oldTimeout) {
                        logEvent('MemberTimeoutRemoved', {
                            guildId: guild.id,
                            guildName: guild.name,
                            userId: targetId,
                            userName: auditLogEntry.target?.username || 'Unknown',
                            executorId: executorId,
                            executorName: auditLogEntry.executor?.username || 'Unknown',
                            reason: reason,
                            action: 'TIMEOUT_REMOVE'
                        }).catch(() => {});
                    }
                }
            }

            if (auditLogEntry.action === AuditLogEvent.MemberKick) {
                const targetId = auditLogEntry.targetId;
                const executorId = auditLogEntry.executorId;
                const reason = auditLogEntry.reason || null;
                
                logEvent('GuildMemberKick', {
                    guildId: guild.id,
                    guildName: guild.name,
                    userId: targetId,
                    userName: auditLogEntry.target?.username || 'Unknown',
                    executorId: executorId,
                    executorName: auditLogEntry.executor?.username || 'Unknown',
                    reason: reason,
                    action: 'KICK'
                }).catch(() => {});
            }
            
            if (auditLogEntry.action === AuditLogEvent.MemberPrune) {
                const executorId = auditLogEntry.executorId;
                const reason = auditLogEntry.reason || null;
                const memberCount = auditLogEntry.extra?.removed || 0;
                
                logEvent('GuildMemberPrune', {
                    guildId: guild.id,
                    guildName: guild.name,
                    executorId: executorId,
                    executorName: auditLogEntry.executor?.username || 'Unknown',
                    membersRemoved: memberCount,
                    reason: reason,
                    action: 'PRUNE'
                }).catch(() => {});
            }
            
            if (auditLogEntry.action === AuditLogEvent.ChannelDelete) {
                const executorId = auditLogEntry.executorId;
                const reason = auditLogEntry.reason || null;
                const channelName = auditLogEntry.extra?.channel?.name || 'Unknown';
                
                logEvent('ChannelDelete', {
                    guildId: guild.id,
                    guildName: guild.name,
                    channelName: channelName,
                    channelId: auditLogEntry.targetId,
                    executorId: executorId,
                    executorName: auditLogEntry.executor?.username || 'Unknown',
                    reason: reason,
                    action: 'DELETE'
                }).catch(() => {});
            }
            
            if (auditLogEntry.action === AuditLogEvent.RoleDelete) {
                const executorId = auditLogEntry.executorId;
                const reason = auditLogEntry.reason || null;
                const roleName = auditLogEntry.extra?.role?.name || 'Unknown';
                
                logEvent('GuildRoleDelete', {
                    guildId: guild.id,
                    guildName: guild.name,
                    roleName: roleName,
                    roleId: auditLogEntry.targetId,
                    executorId: executorId,
                    executorName: auditLogEntry.executor?.username || 'Unknown',
                    reason: reason,
                    action: 'DELETE'
                }).catch(() => {});
            }
        })
    }
];

const { Events, AuditLogEvent } = require('discord.js');
const { syncIndividualRole } = require('../utils/sync');
const { wrapEventHandler } = require('../utils/eventHelpers');
const { logEvent } = require('../utils/dbLogger');

async function handleRoleSync(role, eventType, changes = null) {
    const guild = role.guild;
    const roleId = role.id;

    const logData = {
        guildId: guild.id,
        guildName: guild.name,
        roleId: roleId,
        roleName: role.name,
        roleColor: role.color,
        rolePermissions: role.permissions.bitfield,
        roleHoist: role.hoist || false,
        roleMentionable: role.mentionable || false,
        rolePosition: role.position || null
    };

    if (guild && eventType !== 'GuildRoleCreate') {
        try {
            const auditLogs = await guild.fetchAuditLogs({ 
                limit: 1,
                type: eventType === 'GuildRoleDelete' ? AuditLogEvent.RoleDelete : AuditLogEvent.RoleUpdate
            });
            const logEntry = auditLogs.entries.first();
            if (logEntry && logEntry.targetId === roleId) {
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
    
    await syncIndividualRole(guild, roleId);
}

async function trackRoleChanges(oldRole, newRole) {
    const changes = {};

    if (oldRole.name !== newRole.name) {
        changes.name = {
            old: oldRole.name,
            new: newRole.name
        };
    }

    if (oldRole.color !== newRole.color) {
        changes.color = {
            old: `#${oldRole.color.toString(16).toUpperCase().padStart(6, '0')}`,
            new: `#${newRole.color.toString(16).toUpperCase().padStart(6, '0')}`
        };
    }

    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        const oldPerms = Array.from(oldRole.permissions.toArray());
        const newPerms = Array.from(newRole.permissions.toArray());
        const addedPerms = newPerms.filter(perm => !oldPerms.includes(perm));
        const removedPerms = oldPerms.filter(perm => !newPerms.includes(perm));
        
        if (addedPerms.length > 0 || removedPerms.length > 0) {
            changes.permissions = {
                added: addedPerms,
                removed: removedPerms
            };
        }
    }

    if (oldRole.hoist !== newRole.hoist) {
        changes.hoist = {
            old: oldRole.hoist,
            new: newRole.hoist
        };
    }

    if (oldRole.mentionable !== newRole.mentionable) {
        changes.mentionable = {
            old: oldRole.mentionable,
            new: newRole.mentionable
        };
    }

    if (oldRole.position !== newRole.position) {
        changes.position = {
            old: oldRole.position,
            new: newRole.position
        };
    }

    if (oldRole.iconURL?.() !== newRole.iconURL?.()) {
        changes.icon = {
            changed: true
        };
    }
    
    return changes;
}

module.exports = [
    {
        name: Events.GuildRoleCreate,
        execute: wrapEventHandler('GuildRoleCreate', (role) => handleRoleSync(role, 'GuildRoleCreate'))
    },
    {
        name: Events.GuildRoleDelete,
        execute: wrapEventHandler('GuildRoleDelete', (role) => handleRoleSync(role, 'GuildRoleDelete'))
    },
    {
        name: Events.GuildRoleUpdate,
        execute: wrapEventHandler('GuildRoleUpdate', async (oldRole, newRole) => {
            const changes = await trackRoleChanges(oldRole, newRole);

            if (Object.keys(changes).length > 0) {
                await handleRoleSync(newRole, 'GuildRoleUpdate', changes);
            }
        })
    }
];
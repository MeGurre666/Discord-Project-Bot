const { Events } = require('discord.js');
const { syncIndividualMember, syncIndividualGuild, syncIndividualRole } = require('../utils/sync');
const { wrapEventHandler } = require('../utils/eventHelpers');
const { logEvent } = require('../utils/dbLogger');

module.exports = [
    {
        name: Events.GuildMemberAdd,
        execute: wrapEventHandler('GuildMemberAdd', async (member) => {
            const guild = member.guild;
            const userId = member.user.id;
            
            logEvent('GuildMemberAdd', {
                guildId: guild.id,
                guildName: guild.name,
                userId: userId,
                username: member.user.username,
                joinedAt: member.joinedTimestamp
            }).catch(() => {});
            
            await Promise.all([
                syncIndividualMember(guild, userId),
                syncIndividualGuild(guild.client, guild.id)
            ]);
        })
    },
    {
        name: Events.GuildMemberUpdate,
        execute: wrapEventHandler('GuildMemberUpdate', async (oldMember, newMember) => {
            const guild = newMember.guild;
            const userId = newMember.user.id;
            
            const oldRoles = oldMember.roles.cache.map(role => role.id);
            const newRoles = newMember.roles.cache.map(role => role.id);
            const addedRoles = newRoles.filter(roleId => !oldRoles.includes(roleId));
            const removedRoles = oldRoles.filter(roleId => !newRoles.includes(roleId));

            const changes = {};

            if (addedRoles.length > 0 || removedRoles.length > 0) {
                changes.roles = {
                    added: addedRoles.length,
                    removed: removedRoles.length
                };
            }

            const oldNickname = oldMember.nickname;
            const newNickname = newMember.nickname;
            if (oldNickname !== newNickname) {
                changes.nickname = {
                    old: oldNickname || 'None',
                    new: newNickname || 'None'
                };
            }

            const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
            const newTimeout = newMember.communicationDisabledUntilTimestamp;
            if (oldTimeout !== newTimeout) {
                changes.timeout = {
                    old: oldTimeout || null,
                    new: newTimeout || null,
                    isActive: newTimeout && newTimeout > Date.now()
                };
            }

            const oldAvatarHash = oldMember.avatarID;
            const newAvatarHash = newMember.avatarID;
            if (oldAvatarHash !== newAvatarHash) {
                changes.avatar = {
                    changed: true
                };
            }

            if (Object.keys(changes).length > 0) {
                logEvent('GuildMemberUpdate', {
                    guildId: guild.id,
                    guildName: guild.name,
                    userId: userId,
                    username: newMember.user.username,
                    changes: changes
                }).catch(() => {});
            }
            
            await syncIndividualMember(guild, userId);
            
            const affectedRoles = [...new Set([...addedRoles, ...removedRoles])];
            await Promise.all(affectedRoles.map(roleId => syncIndividualRole(guild, roleId)));
        })
    },
    {
        name: Events.GuildMemberRemove,
        execute: wrapEventHandler('GuildMemberRemove', async (member) => {
            const guild = member.guild;
            const userId = member.user.id;

            logEvent('GuildMemberRemove', {
                guildId: guild.id,
                guildName: guild.name,
                userId: userId,
                username: member.user.username,
                leftAt: Date.now()
            }).catch(() => {});
            
            await Promise.all([
                syncIndividualMember(guild, userId),
                syncIndividualGuild(guild.client, guild.id)
            ]);
        })
    }
];

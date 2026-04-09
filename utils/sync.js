const { insert, updateOne, delete: deleteRecord, deleteOne, bulkWrite, getCollection } = require('./db');
const { logError, logSuccess, logInfo, logWarn } = require('./logger');
const { COLLECTIONS, MESSAGE_TYPES, SYNC_OPERATIONS, SYNC_ACTIONS, DB_OPTIONS } = require('./constants');
const { getBoolean } = require('./config');
const { PermissionFlagsBits } = require('discord.js');

function toUnixTimestamp(value = Date.now()) {
    if (value === null || value === undefined) {
        return null;
    }

    if (value instanceof Date) {
        return value.getTime();
    }

    const parsed = typeof value === 'string' ? Date.parse(value) : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function buildBulkUpsertOperation(filter, document) {
    return {
        updateOne: {
            filter,
            update: { $set: document },
            upsert: true
        }
    };
}

async function executeBulkUpserts(collectionName, bulkOperations, stats, statKey) {
    if (bulkOperations.length === 0) {
        return;
    }

    try {
        const result = await bulkWrite(collectionName, bulkOperations);
        const upsertedCount = result.upsertedCount || 0;
        stats[`${statKey}Inserted`] += upsertedCount;
        stats[`${statKey}Updated`] += Math.max(0, bulkOperations.length - upsertedCount);
    } catch (error) {
        logError(`Failed to execute bulk upserts for ${collectionName}`, error);
        throw error;
    }
}

function createSyncStats() {
    return {
        guildsInserted: 0,
        guildsUpdated: 0,
        guildsDeleted: 0,
        channelsInserted: 0,
        channelsUpdated: 0,
        channelsDeleted: 0,
        rolesInserted: 0,
        rolesUpdated: 0,
        rolesDeleted: 0,
        membersInserted: 0,
        membersUpdated: 0,
        membersDeleted: 0,
        bansInserted: 0,
        bansUpdated: 0,
        bansDeleted: 0,
        emojisInserted: 0,
        emojisUpdated: 0,
        emojisDeleted: 0
    };
}

function logSyncSummary(stats, totalTime) {
    if (!getBoolean('logging.syncSummary', true)) {
        return;
    }

    console.log('\n=== Database Sync Summary ===');
    console.log(`Total Time: ${totalTime}s`);
    console.log(`Guilds - Inserted: ${stats.guildsInserted}, Updated: ${stats.guildsUpdated}, Deleted: ${stats.guildsDeleted}`);
    console.log(`Channels - Inserted: ${stats.channelsInserted}, Updated: ${stats.channelsUpdated}, Deleted: ${stats.channelsDeleted}`);
    console.log(`Roles - Inserted: ${stats.rolesInserted}, Updated: ${stats.rolesUpdated}, Deleted: ${stats.rolesDeleted}`);
    console.log(`Members - Inserted: ${stats.membersInserted}, Updated: ${stats.membersUpdated}, Deleted: ${stats.membersDeleted}`);
    console.log(`Bans - Inserted: ${stats.bansInserted}, Updated: ${stats.bansUpdated}, Deleted: ${stats.bansDeleted}`);
    console.log(`Emojis - Inserted: ${stats.emojisInserted}, Updated: ${stats.emojisUpdated}, Deleted: ${stats.emojisDeleted}`);
    console.log('========================================\n');
}

function createMessageHistoryStats() {
    return {
        guildsScanned: 0,
        channelsScanned: 0,
        channelsSkipped: 0,
        messagesScanned: 0,
        messagesInserted: 0,
        messagesUpdated: 0,
        failedChannels: 0
    };
}

function canReadChannelHistory(channel, botMember) {
    if (!channel?.isTextBased?.() || channel?.isDMBased?.()) {
        return false;
    }

    if (!botMember || !channel.permissionsFor) {
        return true;
    }

    const permissions = channel.permissionsFor(botMember);
    if (!permissions) {
        return false;
    }

    return permissions.has(PermissionFlagsBits.ViewChannel) && permissions.has(PermissionFlagsBits.ReadMessageHistory);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function toNumberOption(value, fallback, min = null, max = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    let normalized = parsed;
    if (min !== null) {
        normalized = Math.max(min, normalized);
    }
    if (max !== null) {
        normalized = Math.min(max, normalized);
    }

    return normalized;
}

function toBooleanOption(value, fallback) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value !== 'string') {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }

    return fallback;
}

function buildHistorySyncOptions(options = {}) {
    return {
        batchLimit: toNumberOption(options.batchLimit, 100, 1, 100),
        pauseMs: toNumberOption(options.pauseMs, 300, 0, 5000),
        channelConcurrency: toNumberOption(options.channelConcurrency, 2, 1, 10),
        useCheckpoint: toBooleanOption(options.useCheckpoint, true)
    };
}

function buildMessageDocument(message) {
    const createdAt = toUnixTimestamp(message.createdAt) || toUnixTimestamp();
    return {
        messageId: message.id,
        channelId: message.channelId,
        guildId: message.guildId,
        authorId: message.author?.id ?? null,
        type: MESSAGE_TYPES.ACTIVE,
        content: message.content,
        attachments: mapMessageAttachments(message.attachments),
        embeds: mapMessageEmbeds(message.embeds),
        createdAt,
        updatedAt: createdAt,
        changes: []
    };
}

async function getChannelMessageSyncState(guildId, channelId) {
    return getCollection(COLLECTIONS.SYNC_STATE).findOne({
        scope: 'channelMessageHistory',
        guildId,
        channelId
    });
}

async function upsertChannelMessageSyncState(guildId, channelId, statePatch = {}) {
    const now = toUnixTimestamp();
    await getCollection(COLLECTIONS.SYNC_STATE).updateOne(
        { scope: 'channelMessageHistory', guildId, channelId },
        {
            $set: {
                ...statePatch,
                scope: 'channelMessageHistory',
                guildId,
                channelId,
                updatedAt: now
            },
            $setOnInsert: {
                createdAt: now
            }
        },
        DB_OPTIONS.UPSERT
    );
}

async function insertMissingMessages(messageCollection, messages, stats) {
    if (!messages || messages.length === 0) {
        return;
    }

    const messageIds = messages.map(msg => msg.id);
    const existing = await messageCollection
        .find({ messageId: { $in: messageIds } }, { projection: { messageId: 1 } })
        .toArray();

    const existingIdSet = new Set(existing.map(doc => doc.messageId));
    const newDocuments = messages
        .filter(msg => !existingIdSet.has(msg.id))
        .map(buildMessageDocument);

    stats.messagesScanned += messages.length;
    stats.messagesUpdated += existingIdSet.size;

    if (newDocuments.length === 0) {
        return;
    }

    const insertResult = await messageCollection.insertMany(newDocuments, { ordered: false });
    stats.messagesInserted += insertResult.insertedCount || newDocuments.length;
}

async function syncChannelMessageHistory(channel, stats, options = {}) {
    const messageCollection = getCollection(COLLECTIONS.MESSAGES);
    const syncOptions = buildHistorySyncOptions(options);
    const { batchLimit, pauseMs, useCheckpoint } = syncOptions;
    const checkpointState = useCheckpoint
        ? await getChannelMessageSyncState(channel.guildId, channel.id)
        : null;
    const checkpointMessageId = checkpointState?.completed ? checkpointState.newestSyncedMessageId : null;

    let before = undefined;
    let newestObservedMessageId = null;
    let reachedCheckpoint = false;

    while (true) {
        const fetchedMessages = await channel.messages.fetch({ limit: batchLimit, before });

        if (!fetchedMessages || fetchedMessages.size === 0) {
            break;
        }

        const messages = Array.from(fetchedMessages.values());
        if (!newestObservedMessageId && messages[0]?.id) {
            newestObservedMessageId = messages[0].id;
        }

        let messagesToInsert = messages;
        if (checkpointMessageId) {
            const checkpointIndex = messages.findIndex(msg => msg.id === checkpointMessageId);
            if (checkpointIndex >= 0) {
                reachedCheckpoint = true;
                messagesToInsert = messages.slice(0, checkpointIndex);
            }
        }

        await insertMissingMessages(messageCollection, messagesToInsert, stats);

        if (reachedCheckpoint) {
            break;
        }

        before = messages[messages.length - 1].id;

        if (fetchedMessages.size < batchLimit) {
            break;
        }

        if (pauseMs > 0) {
            await sleep(pauseMs);
        }
    }

    if (useCheckpoint) {
        await upsertChannelMessageSyncState(channel.guildId, channel.id, {
            completed: true,
            newestSyncedMessageId: newestObservedMessageId || checkpointMessageId || null,
            lastRunAt: toUnixTimestamp()
        });
    }
}

async function syncGuildMessageHistory(guild, options = {}) {
    const stats = createMessageHistoryStats();
    const channels = await guild.channels.fetch();
    const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
    const syncOptions = buildHistorySyncOptions(options);
    const { channelConcurrency } = syncOptions;

    logInfo(`Starting message history sync for guild: ${guild.name} (${guild.id})`);

    const channelQueue = [];
    for (const channel of channels.values()) {
        if (!canReadChannelHistory(channel, botMember)) {
            stats.channelsSkipped += 1;
            continue;
        }

        if (!channel?.messages?.fetch) {
            stats.channelsSkipped += 1;
            continue;
        }

        channelQueue.push(channel);
    }

    let queueIndex = 0;
    const workers = Array.from({ length: Math.min(channelConcurrency, channelQueue.length || 1) }, () => (async () => {
        while (queueIndex < channelQueue.length) {
            const currentIndex = queueIndex;
            queueIndex += 1;
            const channel = channelQueue[currentIndex];

            try {
                stats.channelsScanned += 1;
                await syncChannelMessageHistory(channel, stats, syncOptions);
            } catch (error) {
                stats.failedChannels += 1;
                logWarn(`Failed to sync message history for channel ${channel.name || channel.id} (${channel.id})`, error.message);
            }
        }
    })());

    await Promise.all(workers);

    stats.guildsScanned += 1;
    logInfo(`Completed message history sync for guild ${guild.name}. Channels scanned: ${stats.channelsScanned}, skipped: ${stats.channelsSkipped}, failed: ${stats.failedChannels}, messages scanned: ${stats.messagesScanned}`);
    return stats;
}

async function syncAllGuildMessageHistory(client, options = {}) {
    const allGuilds = await client.guilds.fetch();
    const totals = createMessageHistoryStats();
    const startedAt = Date.now();

    for (const partialGuild of allGuilds.values()) {
        try {
            const guild = await client.guilds.fetch(partialGuild.id);
            const guildStats = await syncGuildMessageHistory(guild, options);
            totals.guildsScanned += guildStats.guildsScanned;
            totals.channelsScanned += guildStats.channelsScanned;
            totals.channelsSkipped += guildStats.channelsSkipped;
            totals.messagesScanned += guildStats.messagesScanned;
            totals.messagesInserted += guildStats.messagesInserted;
            totals.messagesUpdated += guildStats.messagesUpdated;
            totals.failedChannels += guildStats.failedChannels;
        } catch (error) {
            logError(`Failed to sync message history for guild ${partialGuild.id}`, error);
        }
    }

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(2);
    logSuccess(`Message history sync completed in ${elapsedSeconds}s`);
    logInfo(`Message history totals - Guilds: ${totals.guildsScanned}, Channels: ${totals.channelsScanned}, Skipped: ${totals.channelsSkipped}, Failed: ${totals.failedChannels}, Messages scanned: ${totals.messagesScanned}, Inserted: ${totals.messagesInserted}, Updated: ${totals.messagesUpdated}`);
    return totals;
}

async function syncDBToGuilds(client) {
    const startTime = Date.now();
    const guilds = await client.guilds.fetch();
    logInfo(`Starting database sync... (${guilds.size} guilds found)`);
    
    const stats = createSyncStats();
    
    await cleanupStaleGuilds(client, stats);

    const syncPromises = Array.from(guilds.values()).map(async (partialGuild) => {
        try {
            const guild = await client.guilds.fetch(partialGuild.id);
            
            await Promise.all([
                syncGuild(guild, stats),
                syncGuildChannels(guild, stats),
                syncGuildMembers(guild, stats),
                syncGuildRoles(guild, stats),
                syncGuildBans(guild, stats),
                syncGuildEmojis(guild, stats)
            ]);
            
            await Promise.all([
                cleanupStaleChannels(guild, stats),
                cleanupStaleRoles(guild, stats),
                cleanupStaleMembers(guild, stats),
                cleanupStaleBans(guild, stats),
                cleanupStaleEmojis(guild, stats)
            ]);
            
            logSuccess(`Synced guild: ${guild.name}`);
        } catch (error) {
            logError(`Error syncing guild ${partialGuild.id}`, error);
        }
    });

    await Promise.allSettled(syncPromises);
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logSyncSummary(stats, totalTime);
}

async function syncGuild(guild, stats) {
    const guildData = {
        guildId: guild.id,
        name: guild.name,
        icon: guild.iconURL(),
        memberCount: guild.memberCount,
        ownerId: guild.ownerId,
        createdAt: toUnixTimestamp(guild.createdAt),
        updatedAt: toUnixTimestamp()
    };

    const result = await updateOne(COLLECTIONS.GUILDS, { guildId: guild.id }, guildData, DB_OPTIONS.UPSERT);
    stats.guildsInserted += result.upsertedCount || 0;
    stats.guildsUpdated += result.modifiedCount || 0;
}

async function syncGuildChannels(guild, stats) {
    try {
        const channels = await guild.channels.fetch();

        if (channels.size === 0) {
            return;
        }

        const bulkOperations = [];

        for (const [channelId, channel] of channels) {
            const permissionOverwrites = channel.permissionOverwrites.cache.map(overwrite => ({
                id: overwrite.id,
                type: overwrite.type,
                allow: overwrite.allow.bitfield.toString(),
                deny: overwrite.deny.bitfield.toString()
            }));

            const channelData = {
                channelId: channel.id,
                guildId: guild.id,
                name: channel.name,
                type: channel.type,
                position: channel.position,
                permissions: permissionOverwrites,
                parentId: channel.parentId,
                createdAt: toUnixTimestamp(channel.createdAt),
                updatedAt: toUnixTimestamp()
            };

            bulkOperations.push(buildBulkUpsertOperation({ channelId, guildId: guild.id }, channelData));
        }

        await executeBulkUpserts(COLLECTIONS.CHANNELS, bulkOperations, stats, 'channels');
    } catch (error) {
        logError(`Failed to sync channels for guild ${guild.name}`, error);
    }
}

async function syncGuildMembers(guild, stats) {
    try {
        const members = await guild.members.fetch();

        if (members.size === 0) {
            return;
        }

        const bulkOperations = [];

        for (const [memberId, member] of members) {
            const memberData = {
                userId: member.id,
                guildId: guild.id,
                username: member.user.username,
                discriminator: member.user.discriminator,
                nickname: member.nickname,
                roles: member.roles.cache.map(role => role.id),
                joinedAt: toUnixTimestamp(member.joinedAt),
                createdAt: toUnixTimestamp(member.user.createdAt),
                updatedAt: toUnixTimestamp()
            };

            bulkOperations.push(buildBulkUpsertOperation({ userId: memberId, guildId: guild.id }, memberData));
        }

        await executeBulkUpserts(COLLECTIONS.MEMBERS, bulkOperations, stats, 'members');
    } catch (error) {
        logError(`Failed to sync members for guild ${guild.name}`, error);
    }
}

async function syncGuildRoles(guild, stats) {
    try {
        const roles = await guild.roles.fetch();

        if (roles.size === 0) {
            return;
        }

        const bulkOperations = [];

        for (const [roleId, role] of roles) {
            const roleData = {
                roleId: role.id,
                guildId: guild.id,
                name: role.name,
                color: role.color,
                position: role.position,
                users: role.members.map(member => member.id),
                permissions: role.permissions.bitfield.toString(),
                createdAt: toUnixTimestamp(role.createdAt),
                updatedAt: toUnixTimestamp()
            };

            bulkOperations.push(buildBulkUpsertOperation({ roleId, guildId: guild.id }, roleData));
        }

        await executeBulkUpserts(COLLECTIONS.ROLES, bulkOperations, stats, 'roles');
    } catch (error) {
        logError(`Failed to sync roles for guild ${guild.name}`, error);
    }
}

async function syncGuildBans(guild, stats) {
    try {
        const bans = await guild.bans.fetch();

        if (bans.size === 0) {
            return;
        }

        const existingBans = await getCollection(COLLECTIONS.BANS)
            .find({ guildId: guild.id })
            .toArray();
        
        const activeBanMap = new Map(
            existingBans
                .filter(ban => !ban.readOnly && ban.active)
                .map(ban => [ban.userId, ban])
        );

        const bansToInsert = [];
        const bulkOperations = [];

        for (const [userId, ban] of bans) {
            const banData = {
                userId: ban.user.id,
                guildId: guild.id,
                guildName: guild.name,
                active: true,
                readOnly: false,
                bannedBy: null,
                createdAt: toUnixTimestamp(),
                updatedAt: toUnixTimestamp(),
                reason: ban.reason
            };

            const existingBan = activeBanMap.get(userId);

            if (existingBan && !existingBan.readOnly) {
                bulkOperations.push({
                    updateOne: {
                        filter: { 
                            userId, 
                            guildId: guild.id, 
                            readOnly: false,
                            active: true 
                        },
                        update: { 
                            $set: { 
                                active: true,
                                reason: ban.reason,
                                guildName: guild.name,
                                updatedAt: toUnixTimestamp()
                            } 
                        }
                    }
                });
            } else if (!existingBan) {
                bansToInsert.push(banData);
            }
        }
        
        const currentBannedUserIds = new Set(bans.keys());
        const unbannedOperations = existingBans
            .filter(ban => !ban.readOnly && ban.active && !currentBannedUserIds.has(ban.userId))
            .map(ban => ({
                updateOne: {
                    filter: { 
                        userId: ban.userId, 
                        guildId: guild.id, 
                        readOnly: false,
                        active: true
                    },
                    update: { 
                        $set: { 
                            active: false, 
                            readOnly: true, 
                                updatedAt: toUnixTimestamp() 
                        } 
                    }
                }
            }));

        const operations = [];
        if (bansToInsert.length > 0) {
            operations.push(insert(COLLECTIONS.BANS, bansToInsert));
            stats.bansInserted += bansToInsert.length;
        }
        if (bulkOperations.length > 0) {
            operations.push(bulkWrite(COLLECTIONS.BANS, bulkOperations));
            stats.bansUpdated += bulkOperations.length;
        }
        if (unbannedOperations.length > 0) {
            operations.push(bulkWrite(COLLECTIONS.BANS, unbannedOperations));
            stats.bansUpdated += unbannedOperations.length;
        }

        await Promise.all(operations);
    } catch (error) {
        logError(`Failed to sync bans for guild ${guild.name}`, error);
    }
}



async function syncGuildEmojis(guild, stats) {
    try {
        const emojis = await guild.emojis.fetch();
        
        if (emojis.size === 0) {
            return;
        }
        
        const bulkOperations = [];
        
        for (const [emojiId, emoji] of emojis) {
            const emojiData = {
                emojiId: emoji.id,
                guildId: guild.id,
                name: emoji.name,
                animated: emoji.animated,
                imageUrl: emoji.imageURL(),
                createdAt: toUnixTimestamp(emoji.createdAt),
                addedByID: emoji.author?.id || null,
                addedByUsername: emoji.author?.username || null,
                addedByGlobal: emoji.author?.globalName || null,
                updatedAt: toUnixTimestamp()
            };

            bulkOperations.push(buildBulkUpsertOperation({ emojiId, guildId: guild.id }, emojiData));
        }

        await executeBulkUpserts(COLLECTIONS.EMOJIS, bulkOperations, stats, 'emojis');
    } catch (error) {
        logError(`Failed to sync emojis for guild ${guild.name}`, error);
    }
}

async function cleanupStaleGuilds(client, stats) {
    const dbGuilds = await getCollection(COLLECTIONS.GUILDS)
        .find({}, { projection: { guildId: 1 } })
        .toArray();
    const botGuildIds = new Set(client.guilds.cache.keys());

    const staleGuildIds = dbGuilds
        .map(guild => guild.guildId)
        .filter(guildId => !botGuildIds.has(guildId));

    if (staleGuildIds.length === 0) {
        return;
    }

    await Promise.all([
        deleteRecord(COLLECTIONS.CHANNELS, { guildId: { $in: staleGuildIds } }),
        deleteRecord(COLLECTIONS.ROLES, { guildId: { $in: staleGuildIds } }),
        deleteRecord(COLLECTIONS.MEMBERS, { guildId: { $in: staleGuildIds } }),
        deleteRecord(COLLECTIONS.BANS, { guildId: { $in: staleGuildIds } }),
        deleteRecord(COLLECTIONS.EMOJIS, { guildId: { $in: staleGuildIds } }),
        deleteRecord(COLLECTIONS.GUILDS, { guildId: { $in: staleGuildIds } })
    ]);

    stats.guildsDeleted += staleGuildIds.length;
    logInfo(`Cleaned up ${staleGuildIds.length} stale guild(s)`);
}


async function cleanupStaleChannels(guild, stats) {
    const guildChannelIds = Array.from(guild.channels.cache.keys());
    const deleteResult = await deleteRecord(COLLECTIONS.CHANNELS, {
        guildId: guild.id,
        channelId: { $nin: guildChannelIds }
    });
    stats.channelsDeleted += deleteResult.deletedCount || 0;
}

async function cleanupStaleRoles(guild, stats) {
    const guildRoleIds = Array.from(guild.roles.cache.keys());
    const deleteResult = await deleteRecord(COLLECTIONS.ROLES, {
        guildId: guild.id,
        roleId: { $nin: guildRoleIds }
    });
    stats.rolesDeleted += deleteResult.deletedCount || 0;
}

async function cleanupStaleMembers(guild, stats) {
    const guildMemberIds = Array.from(guild.members.cache.keys());
    const deleteResult = await deleteRecord(COLLECTIONS.MEMBERS, {
        guildId: guild.id,
        userId: { $nin: guildMemberIds }
    });
    stats.membersDeleted += deleteResult.deletedCount || 0;
}

async function cleanupStaleBans(guild, stats) {
    const dbBans = await getCollection(COLLECTIONS.BANS)
        .find({ guildId: guild.id, active: true })
        .toArray();
    const guildBans = await guild.bans.fetch();
    const bannedUserIds = new Set(guildBans.keys());
    
    const updatePromises = dbBans
        .filter(dbBan => !bannedUserIds.has(dbBan.userId))
        .map(async (dbBan) => {
            if (dbBan.readOnly === true) {
                await insert(COLLECTIONS.BANS, {
                    userId: dbBan.userId,
                    guildId: guild.id,
                    guildName: guild.name,
                    active: false,
                    readOnly: true,
                    createdAt: toUnixTimestamp(),
                    updatedAt: toUnixTimestamp(),
                    reason: 'Ban removed during sync'
                });
                stats.bansInserted++;
            } else {
                await updateOne(COLLECTIONS.BANS, 
                    { userId: dbBan.userId, guildId: guild.id },
                    { active: false, readOnly: true, updatedAt: toUnixTimestamp() }
                );
                stats.bansUpdated++;
            }
        });
    
    await Promise.all(updatePromises);
}

async function cleanupStaleEmojis(guild, stats) {
    const guildEmojiIds = Array.from(guild.emojis.cache.keys());
    const deleteResult = await deleteRecord(COLLECTIONS.EMOJIS, {
        guildId: guild.id,
        emojiId: { $nin: guildEmojiIds }
    });
    stats.emojisDeleted += deleteResult.deletedCount || 0;
}


async function syncIndividualBan(guild, userId, reason = null) {
    try {
        const ban = await guild.bans.fetch(userId).catch(() => null);
        
        if (ban) {
            const now = toUnixTimestamp();
            const result = await getCollection(COLLECTIONS.BANS).updateOne(
                { userId, guildId: guild.id, readOnly: false, active: true },
                {
                    $set: {
                        active: true,
                        reason: reason || ban.reason,
                        guildName: guild.name,
                        updatedAt: now
                    },
                    $setOnInsert: {
                        userId: ban.user.id,
                        guildId: guild.id,
                        readOnly: false,
                        bannedBy: null,
                        createdAt: now
                    }
                },
                DB_OPTIONS.UPSERT
            );

            return { success: true, action: result.upsertedCount > 0 ? SYNC_ACTIONS.INSERTED : SYNC_ACTIONS.UPDATED };
        } else {
            const result = await updateOne(COLLECTIONS.BANS,
                { userId, guildId: guild.id, readOnly: false, active: true },
                { active: false, readOnly: true, updatedAt: toUnixTimestamp() }
            );

            if (result.matchedCount > 0) {
                return { success: true, action: SYNC_ACTIONS.DEACTIVATED };
            }
            
            return { success: false, message: 'Ban not found in Discord or DB' };
        }
    } catch (error) {
        logError(`Failed to sync individual ban for user ${userId} in guild ${guild.id}`, error);
        return { success: false, error: error.message };
    }
}

async function syncIndividualMember(guild, userId) {
    try {
        const member = await guild.members.fetch(userId).catch(() => null);
        
        if (member) {
            const now = toUnixTimestamp();
            const memberData = {
                userId: member.id,
                guildId: guild.id,
                username: member.user.username,
                discriminator: member.user.discriminator,
                nickname: member.nickname,
                roles: member.roles.cache.map(role => role.id),
                joinedAt: toUnixTimestamp(member.joinedAt),
                updatedAt: now
            };

            const result = await getCollection(COLLECTIONS.MEMBERS).updateOne(
                { userId, guildId: guild.id },
                {
                    $set: memberData,
                    $setOnInsert: {
                        createdAt: toUnixTimestamp(member.user.createdAt)
                    }
                },
                DB_OPTIONS.UPSERT
            );

            return { success: true, action: result.upsertedCount > 0 ? SYNC_ACTIONS.INSERTED : SYNC_ACTIONS.UPDATED };
        } else {
            const deleteResult = await deleteOne(COLLECTIONS.MEMBERS, { userId, guildId: guild.id });

            if (deleteResult.deletedCount > 0) {
                return { success: true, action: SYNC_ACTIONS.DELETED };
            }
            
            return { success: false, message: 'Member not found in Discord or DB' };
        }
    } catch (error) {
        logError(`Failed to sync individual member ${userId} in guild ${guild.id}`, error);
        return { success: false, error: error.message };
    }
}

async function syncIndividualChannel(guild, channelId) {
    try {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        
        if (channel) {
            const now = toUnixTimestamp();
            const permissionOverwrites = channel.permissionOverwrites.cache.map(overwrite => ({
                id: overwrite.id,
                type: overwrite.type,
                allow: overwrite.allow.bitfield.toString(),
                deny: overwrite.deny.bitfield.toString()
            }));

            const channelData = {
                channelId: channel.id,
                guildId: guild.id,
                name: channel.name,
                type: channel.type,
                position: channel.position,
                permissions: permissionOverwrites,
                parentId: channel.parentId,
                updatedAt: now
            };

            const result = await getCollection(COLLECTIONS.CHANNELS).updateOne(
                { channelId, guildId: guild.id },
                {
                    $set: channelData,
                    $setOnInsert: {
                        createdAt: toUnixTimestamp(channel.createdAt)
                    }
                },
                DB_OPTIONS.UPSERT
            );

            return { success: true, action: result.upsertedCount > 0 ? SYNC_ACTIONS.INSERTED : SYNC_ACTIONS.UPDATED };
        } else {
            const deleteResult = await deleteOne(COLLECTIONS.CHANNELS, { channelId, guildId: guild.id });

            if (deleteResult.deletedCount > 0) {
                return { success: true, action: SYNC_ACTIONS.DELETED };
            }
            
            return { success: false, message: 'Channel not found in Discord or DB' };
        }
    } catch (error) {
        logError(`Failed to sync individual channel ${channelId} in guild ${guild.id}`, error);
        return { success: false, error: error.message };
    }
}

async function syncIndividualGuild(client, guildId) {
    try {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        
        if (guild) {
            const now = toUnixTimestamp();
            const guildData = {
                guildId: guild.id,
                name: guild.name,
                icon: guild.iconURL(),
                memberCount: guild.memberCount,
                ownerId: guild.ownerId,
                updatedAt: now
            };

            const result = await getCollection(COLLECTIONS.GUILDS).updateOne(
                { guildId: guild.id },
                {
                    $set: guildData,
                    $setOnInsert: {
                        createdAt: toUnixTimestamp(guild.createdAt)
                    }
                },
                DB_OPTIONS.UPSERT
            );

            return { success: true, action: result.upsertedCount > 0 ? SYNC_ACTIONS.INSERTED : SYNC_ACTIONS.UPDATED };
        } else {
            const deleteResults = await Promise.all([
                deleteRecord(COLLECTIONS.CHANNELS, { guildId }),
                deleteRecord(COLLECTIONS.ROLES, { guildId }),
                deleteRecord(COLLECTIONS.MEMBERS, { guildId }),
                deleteRecord(COLLECTIONS.BANS, { guildId }),
                deleteRecord(COLLECTIONS.EMOJIS, { guildId }),
                deleteOne(COLLECTIONS.GUILDS, { guildId })
            ]);

            if (deleteResults[5].deletedCount > 0) {
                return { success: true, action: SYNC_ACTIONS.DELETED };
            }
            
            return { success: false, message: 'Guild not found in Discord or DB' };
        }
    } catch (error) {
        logError(`Failed to sync individual guild ${guildId}`, error);
        return { success: false, error: error.message };
    }
}

async function syncIndividualEmoji(guild, emojiId) {
    try {
        const emoji = await guild.emojis.fetch(emojiId).catch(() => null);
        
        if (emoji) {
            const now = toUnixTimestamp();
            const emojiData = {
                emojiId: emoji.id,
                guildId: guild.id,
                name: emoji.name,
                animated: emoji.animated,
                imageUrl: emoji.imageURL(),
                createdAt: toUnixTimestamp(emoji.createdAt),
                addedByID: emoji.author?.id || null,
                addedByUsername: emoji.author?.username || null,
                addedByGlobal: emoji.author?.globalName || null,
                updatedAt: now
            };

            const result = await getCollection(COLLECTIONS.EMOJIS).updateOne(
                { emojiId, guildId: guild.id },
                {
                    $set: emojiData,
                    $setOnInsert: {
                        createdAt: toUnixTimestamp(emoji.createdAt)
                    }
                },
                DB_OPTIONS.UPSERT
            );

            return { success: true, action: result.upsertedCount > 0 ? SYNC_ACTIONS.INSERTED : SYNC_ACTIONS.UPDATED };
        } else {
            const deleteResult = await deleteOne(COLLECTIONS.EMOJIS, { emojiId, guildId: guild.id });

            if (deleteResult.deletedCount > 0) {
                return { success: true, action: SYNC_ACTIONS.DELETED };
            }
            
            return { success: false, message: 'Emoji not found in Discord or DB' };
        }
    } catch (error) {
        logError(`Failed to sync individual emoji ${emojiId} in guild ${guild.id}`, error);
        return { success: false, error: error.message };
    }
}

async function syncIndividualRole(guild, roleId) {
    try {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        
        if (role) {
            const now = toUnixTimestamp();
            const roleData = {
                roleId: role.id,
                guildId: guild.id,
                name: role.name,
                color: role.color,
                position: role.position,
                users: role.members.map(member => member.id),
                permissions: role.permissions.bitfield.toString(),
                updatedAt: now
            };

            const result = await getCollection(COLLECTIONS.ROLES).updateOne(
                { roleId, guildId: guild.id },
                {
                    $set: roleData,
                    $setOnInsert: {
                        createdAt: toUnixTimestamp(role.createdAt)
                    }
                },
                DB_OPTIONS.UPSERT
            );

            return { success: true, action: result.upsertedCount > 0 ? SYNC_ACTIONS.INSERTED : SYNC_ACTIONS.UPDATED };
        } else {
            const deleteResult = await deleteOne(COLLECTIONS.ROLES, { roleId, guildId: guild.id });

            if (deleteResult.deletedCount > 0) {
                return { success: true, action: SYNC_ACTIONS.DELETED };
            }
            
            return { success: false, message: 'Role not found in Discord or DB' };
        }
    } catch (error) {
        logError(`Failed to sync individual role ${roleId} in guild ${guild.id}`, error);
        return { success: false, error: error.message };
    }
}


async function syncFullGuild(guild) {
    try {
        logInfo(`Starting full sync for guild: ${guild.name} (${guild.id})`);
        const stats = createSyncStats();
        
        await Promise.all([
            syncGuild(guild, stats),
            syncGuildChannels(guild, stats),
            syncGuildMembers(guild, stats),
            syncGuildRoles(guild, stats),
            syncGuildBans(guild, stats),
            syncGuildEmojis(guild, stats)
        ]);
        
        logSuccess(`Full sync completed for guild: ${guild.name}`);
        logInfo(`  - Channels: ${stats.channelsInserted} inserted, ${stats.channelsUpdated} updated`);
        logInfo(`  - Members: ${stats.membersInserted} inserted, ${stats.membersUpdated} updated`);
        logInfo(`  - Roles: ${stats.rolesInserted} inserted, ${stats.rolesUpdated} updated`);
        logInfo(`  - Bans: ${stats.bansInserted} inserted, ${stats.bansUpdated} updated`);
        logInfo(`  - Emojis: ${stats.emojisInserted} inserted, ${stats.emojisUpdated} updated`);
        
        return { success: true, stats };
    } catch (error) {
        logError(`Failed in full guild sync for ${guild.name} (${guild.id})`, error);
        return { success: false, error: error.message };
    }
}

function mapMessageAttachments(attachments) {
    if (!attachments) {
        return [];
    }

    const attachmentList = Array.isArray(attachments) ? attachments : Array.from(attachments.values());
    return attachmentList.map(att => ({
        id: att.id,
        url: att.url,
        proxyUrl: att.proxyURL,
        filename: att.name,
        size: att.size,
        contentType: att.contentType
    }));
}

function mapMessageEmbeds(embeds) {
    if (!embeds) {
        return [];
    }

    const embedList = Array.isArray(embeds) ? embeds : Array.from(embeds.values());
    return embedList.map(embed => ({
        title: embed.title,
        description: embed.description,
        url: embed.url,
        color: embed.color,
        timestamp: toUnixTimestamp(embed.timestamp)
    }));
}

function toComparableJSON(value) {
    return JSON.stringify(value ?? null);
}

function buildMessageChangeEntry(oldMessage, newMessage) {
    const oldContent = oldMessage?.content ?? null;
    const newContent = newMessage?.content ?? null;
    const oldAttachments = mapMessageAttachments(oldMessage?.attachments);
    const newAttachments = mapMessageAttachments(newMessage?.attachments);
    const oldEmbeds = mapMessageEmbeds(oldMessage?.embeds);
    const newEmbeds = mapMessageEmbeds(newMessage?.embeds);

    const changeEntry = { changedAt: toUnixTimestamp() };

    if (oldContent !== newContent) {
        changeEntry.content = { old: oldContent, new: newContent };
    }

    if (toComparableJSON(oldAttachments) !== toComparableJSON(newAttachments)) {
        changeEntry.attachments = { old: oldAttachments, new: newAttachments };
    }

    if (toComparableJSON(oldEmbeds) !== toComparableJSON(newEmbeds)) {
        changeEntry.embeds = { old: oldEmbeds, new: newEmbeds };
    }

    const hasTrackedChanges = Boolean(changeEntry.content || changeEntry.attachments || changeEntry.embeds);
    return hasTrackedChanges ? changeEntry : null;
}

async function syncMessage(message, changes, type) {
    try {
        const attachments = mapMessageAttachments(message.attachments);
        const embeds = mapMessageEmbeds(message.embeds);
        const messageCollection = getCollection(COLLECTIONS.MESSAGES);

        if (type === SYNC_OPERATIONS.CREATE) {
            const now = toUnixTimestamp(message.createdAt) || toUnixTimestamp();
            await messageCollection.updateOne(
                { messageId: message.id },
                {
                    $set: {
                        channelId: message.channelId,
                        guildId: message.guildId,
                        authorId: message.author?.id ?? null,
                        type: MESSAGE_TYPES.ACTIVE,
                        content: message.content,
                        attachments,
                        embeds,
                        updatedAt: now
                    },
                    $setOnInsert: {
                        messageId: message.id,
                        createdAt: now,
                        changes: []
                    }
                },
                DB_OPTIONS.UPSERT
            );
        } else if (type === SYNC_OPERATIONS.UPDATE) {
            const changeEntry = buildMessageChangeEntry(changes?.oldMessage, changes?.newMessage);
            const updateTime = toUnixTimestamp();

            const updateData = {
                channelId: message.channelId,
                guildId: message.guildId,
                authorId: message.author?.id ?? null,
                type: MESSAGE_TYPES.ACTIVE,
                content: message.content,
                attachments,
                embeds,
                updatedAt: updateTime
            };

            if (changeEntry) {
                await messageCollection.updateOne(
                    { messageId: message.id },
                    [
                        {
                            $set: {
                                ...updateData,
                                messageId: { $ifNull: ['$messageId', message.id] },
                                createdAt: { $ifNull: ['$createdAt', toUnixTimestamp(message.createdAt) || updateTime] },
                                changes: {
                                    $cond: [
                                        { $isArray: '$changes' },
                                        { $concatArrays: ['$changes', [changeEntry]] },
                                        {
                                            $cond: [
                                                { $in: [{ $type: '$changes' }, ['missing', 'null']] },
                                                [changeEntry],
                                                [changeEntry]
                                            ]
                                        }
                                    ]
                                }
                            }
                        }
                    ],
                    DB_OPTIONS.UPSERT
                );
            } else {
                const updateDoc = {
                    $set: updateData,
                    $setOnInsert: {
                        messageId: message.id,
                        createdAt: toUnixTimestamp(message.createdAt) || updateTime
                    }
                };

                await messageCollection.updateOne({ messageId: message.id }, updateDoc, DB_OPTIONS.UPSERT);
            }
        } else if (type === SYNC_OPERATIONS.DELETE) {
            await updateOne(COLLECTIONS.MESSAGES, 
                { messageId: message.id }, 
                { type: MESSAGE_TYPES.DELETED, updatedAt: toUnixTimestamp() }
            );
        }
    } catch (error) {
        logError(`Failed to sync message ${message.id}`, error);
    }
}

module.exports = {
    syncDBToGuilds,
    syncIndividualBan,
    syncIndividualMember,
    syncIndividualChannel,
    syncIndividualGuild,
    syncIndividualEmoji,
    syncIndividualRole,
    syncMessage,
    syncFullGuild,
    syncGuildMessageHistory,
    syncAllGuildMessageHistory
};

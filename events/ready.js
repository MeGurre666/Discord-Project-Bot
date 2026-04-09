const { Events, ActivityType } = require('discord.js');
const { connectDB } = require('../utils/db');
const { syncDBToGuilds, syncAllGuildMessageHistory } = require('../utils/sync');
const { logSuccess, logInfo, logWarn, logError } = require('../utils/logger');
const { getState, getBoolean, getNumber, getString, getObject } = require('../utils/config');

const ALLOWED_ACTIVITY_STATUSES = new Set(['online', 'idle', 'dnd', 'invisible']);

function getMessageHistorySyncOptions() {
    const configOptions = getObject('messageHistory', {});

    return {
        batchLimit: getNumber('messageHistory.batchLimit', configOptions.batchLimit ?? 100, 1, 100),
        pauseMs: getNumber('messageHistory.pauseMs', configOptions.pauseMs ?? 300, 0, 5000),
        channelConcurrency: getNumber('messageHistory.channelConcurrency', configOptions.channelConcurrency ?? 2, 1, 10),
        useCheckpoint: getBoolean('messageHistory.useCheckpoint', configOptions.useCheckpoint ?? true)
    };
}

async function initializeBot(client) {
    logSuccess(`Ready! Logged in as ${client.user.tag}`);

    const configuredActivityText = getString('startup.activity.text', 'Managing the server');
    const configuredActivityType = String(getString('startup.activity.type', 'Watching')).toUpperCase();
    const configuredActivityStatus = String(getString('startup.activity.status', 'online')).toLowerCase();
    const resolvedActivityType = ActivityType[configuredActivityType] ?? ActivityType.Watching;
    const resolvedActivityStatus = ALLOWED_ACTIVITY_STATUSES.has(configuredActivityStatus)
        ? configuredActivityStatus
        : 'online';

    if (resolvedActivityStatus !== configuredActivityStatus) {
        logWarn(`Invalid activity status "${configuredActivityStatus}" in config. Falling back to "online".`, 'ready');
    }

    client.user.setPresence({
        status: resolvedActivityStatus,
        activities: [{ name: configuredActivityText, type: resolvedActivityType }]
    });
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        try {
            await initializeBot(client);
            await connectDB();

            setTimeout(async () => {
                try {
                    if (getState('syncDatabaseOnReady', true)) {
                        logInfo('Starting initial background sync...');
                        await syncDBToGuilds(client);
                    } else {
                        logInfo('Initial database sync disabled by config (states.syncDatabaseOnReady=false)');
                    }

                    if (getState('syncMessageHistory', false)) {
                        logInfo('Starting full message history sync...');
                        await syncAllGuildMessageHistory(client, getMessageHistorySyncOptions());
                    } else {
                        logInfo('Message history sync disabled by config (states.syncMessageHistory=false)');
                    }

                    logSuccess('Initial background sync completed');
                } catch (error) {
                    logError('Initial background sync failed', error);
                }
            }, getNumber('startup.initialSyncDelayMs', 1000, 0, 300000));
        } catch (error) {
            logError('Failed to initialize bot', error);
        }
    }
};

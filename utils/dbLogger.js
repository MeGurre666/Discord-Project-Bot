const { COLLECTIONS, ACTION_TYPES } = require('./constants');
const { logError } = require('./logger');
const { getBoolean, getState } = require('./config');

function shouldLogDbActionToConsole() {
    if (getBoolean('logging.dbActionConsole', false)) {
        return true;
    }

    return getState('debug', false);
}

async function logActionToDatabase(actionType, collection, details = {}, userId = null, reason = null) {
    try {
        const db = require('./db');
        
        const actionLog = {
            timestamp: Date.now(),
            actionType,
            collection,
            details: {
                ...details,
                ...(details.insertedCount !== undefined && { insertedCount: details.insertedCount }),
                ...(details.modifiedCount !== undefined && { modifiedCount: details.modifiedCount }),
                ...(details.deletedCount !== undefined && { deletedCount: details.deletedCount }),
                ...(details.upsertedCount !== undefined && { upsertedCount: details.upsertedCount }),
            },
            userId: userId || 'system',
            reason: reason || null,
            status: 'success'
        };

        if (shouldLogDbActionToConsole()) {
            console.log('[dbLogger] Attempting to insert log:', actionType, collection);
        }
        await db.insert(COLLECTIONS.ACTION_LOGS, actionLog);
        if (shouldLogDbActionToConsole()) {
            console.log('[dbLogger] Successfully inserted log to database');
        }

    } catch (error) {
        console.error('[dbLogger] Error in logActionToDatabase:', error);
        logError('Error in logActionToDatabase', error, 'dbLogger');
        throw error;
    }
}

async function logInsert(collection, data, userId = null, reason = null) {
    if (Array.isArray(data)) {
        await logActionToDatabase(
            ACTION_TYPES.INSERT,
            collection,
            { 
                insertedCount: data.length,
                ids: data.map(d => d._id || d.id).filter(Boolean)
            },
            userId,
            reason
        );
    } else {
        await logActionToDatabase(
            ACTION_TYPES.INSERT,
            collection,
            { 
                insertedCount: 1,
                id: data._id || data.id
            },
            userId,
            reason
        );
    }
}


async function logUpdate(collection, filter, data, modifiedCount = 1, userId = null, reason = null) {
    await logActionToDatabase(
        ACTION_TYPES.UPDATE,
        collection,
        { 
            modifiedCount,
            filter: JSON.stringify(filter).substring(0, 200),
            fields: Object.keys(data)
        },
        userId,
        reason
    );
}

async function logDelete(collection, filter, deletedCount = 1, userId = null, reason = null) {
    await logActionToDatabase(
        ACTION_TYPES.DELETE,
        collection,
        { 
            deletedCount,
            filter: JSON.stringify(filter).substring(0, 200)
        },
        userId,
        reason
    );
}

async function logBulkWrite(collection, operations, results, userId = null, reason = null) {
    await logActionToDatabase(
        ACTION_TYPES.BULK_WRITE,
        collection,
        { 
            operationCount: operations.length,
            insertedCount: results.insertedCount || 0,
            modifiedCount: results.modifiedCount || 0,
            upsertedCount: results.upsertedCount || 0,
            deletedCount: results.deletedCount || 0
        },
        userId,
        reason
    );
}

async function logEvent(eventName, details = {}, userId = null, reason = null) {
    await logActionToDatabase(
        ACTION_TYPES.EVENT,
        'discord_events',
        { 
            eventName,
            ...details
        },
        userId,
        reason
    );
}

async function logSync(collection, operation, details = {}, userId = null, reason = null) {
    await logActionToDatabase(
        ACTION_TYPES.SYNC,
        collection,
        {
            operation,
            ...details
        },
        userId,
        reason
    );
}

async function logCommand(commandName, details = {}, userId = null, reason = null) {
    await logActionToDatabase(
        ACTION_TYPES.COMMAND,
        'commands',
        {
            commandName,
            ...details
        },
        userId,
        reason
    );
}

async function logErrorAction(errorMessage, context = null, details = {}, userId = null) {
    await logActionToDatabase(
        ACTION_TYPES.ERROR,
        context || 'general',
        {
            errorMessage,
            ...details
        },
        userId,
        'Error occurred'
    );
}

async function getActionLogs(filter = {}, limit = 100) {
    try {
        const db = require('./db');
        return await db.query(COLLECTIONS.ACTION_LOGS, {
            filter,
            limit,
            sort: { timestamp: -1 }
        });
    } catch (error) {
        logError('Failed to retrieve action logs', error, 'dbLogger');
        return [];
    }
}

async function getCollectionLogs(collection, limit = 100) {
    return getActionLogs({ collection }, limit);
}

async function getUserLogs(userId, limit = 100) {
    return getActionLogs({ userId }, limit);
}

async function getActionTypeLogsAsync(actionType, limit = 100) {
    return getActionLogs({ actionType }, limit);
}

async function clearOldLogs(daysOld = 30) {
    try {
        const db = require('./db');
        const cutoffTimestamp = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
        
        const result = await db.delete(COLLECTIONS.ACTION_LOGS, { timestamp: { $lt: cutoffTimestamp } });
        
        return result.deletedCount;
    } catch (error) {
        logError(`Failed to clear logs older than ${daysOld} days`, error, 'dbLogger');
        return 0;
    }
}

module.exports = {
    logActionToDatabase,
    logInsert,
    logUpdate,
    logDelete,
    logBulkWrite,
    logEvent,
    logSync,
    logCommand,
    logErrorAction,
    getActionLogs,
    getCollectionLogs,
    getUserLogs,
    getActionTypeLogsAsync,
    clearOldLogs
};

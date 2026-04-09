const { MongoClient } = require('mongodb');
const { logError, logSuccess, logWarn, retryWithBackoff } = require('./logger');
const { DEFAULTS, COLLECTIONS } = require('./constants');

let dbLogger = null;
function getDbLogger() {
    if (!dbLogger) {
        dbLogger = require('./dbLogger');
    }
    return dbLogger;
}

let client = null;
let db = null;
let connectionPromise = null;

function ensureDBConnected() {
    if (!db) {
        throw new Error('Database not connected. Call connectDB() first.');
    }
    return db;
}

function extractDatabaseName(uri) {
    const uriMatch = uri.match(/\/([^/?]+)(\?|$)/);
    if (!uriMatch || !uriMatch[1]) {
        throw new Error('Database name must be specified in MONGODB_URI (e.g., mongodb://localhost:27017/discord_bot)');
    }
    return uriMatch[1];
}


async function connectDB() {
    if (db) {
        return db;
    }

    if (connectionPromise) {
        return connectionPromise;
    }

    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI not found in environment variables');
    }

    connectionPromise = (async () => {
        try {
            client = new MongoClient(process.env.MONGODB_URI, {
                maxPoolSize: 10,
                minPoolSize: 2,
                connectTimeoutMS: 10000,
                socketTimeoutMS: 45000,
            });
            
            await retryWithBackoff(() => client.connect(), 3, 2000);
            
            const dbName = process.env.MONGODB_DATABASE || extractDatabaseName(process.env.MONGODB_URI);
            db = client.db(dbName);
            
            logSuccess(`MongoDB connected to database: ${dbName}`);
            return db;
        } catch (error) {
            logError('MongoDB connection failed', error);
            client = null;
            db = null;
            throw error;
        }
    })();

    try {
        return await connectionPromise;
    } finally {
        connectionPromise = null;
    }
}

async function disconnectDB() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        connectionPromise = null;
        logSuccess('MongoDB disconnected');
    }
}

function getDB() {
    return ensureDBConnected();
}

function getCollection(collectionName) {
    return ensureDBConnected().collection(collectionName);
}

async function query(collection, options = {}) {
    const coll = getCollection(collection);
    const { filter = {}, limit, skip, sort } = options;
    
    let cursor = coll.find(filter);
    if (sort) cursor = cursor.sort(sort);
    if (skip) cursor = cursor.skip(skip);
    if (limit) cursor = cursor.limit(limit);
    
    return cursor.toArray();
}

async function findOne(collection, filter = {}) {
    return getCollection(collection).findOne(filter);
}

async function find(collection, filter = {}) {
    return getCollection(collection).find(filter).toArray();
}

async function insert(collection, data) {
    const coll = getCollection(collection);
    
    if (Array.isArray(data)) {
        if (data.length === 0) {
            return { acknowledged: true, insertedCount: 0, insertedIds: {} };
        }
        const insertResult = await coll.insertMany(data, { ordered: false });

        if (collection !== COLLECTIONS.ACTION_LOGS) {
            getDbLogger().logInsert(collection, data).catch(err => 
                logError('Failed to log insert', err, 'db.insert')
            );
        }
        
        return insertResult;
    } else {
        const insertResult = await coll.insertOne(data);

        if (collection !== COLLECTIONS.ACTION_LOGS) {
            getDbLogger().logInsert(collection, data).catch(err => 
                logError('Failed to log insert', err, 'db.insert')
            );
        }
        
        return insertResult;
    }
}

async function update(collection, filter = {}, data, options = {}) {
    const updateResult = await getCollection(collection).updateMany(filter, { $set: data }, options);

    if (collection !== COLLECTIONS.ACTION_LOGS) {
        getDbLogger().logUpdate(collection, filter, data, updateResult.modifiedCount).catch(err => 
            logError('Failed to log update', err, 'db.update')
        );
    }
    
    return updateResult;
}

async function updateOne(collection, filter = {}, data, options = {}) {
    const updateResult = await getCollection(collection).updateOne(filter, { $set: data }, options);

    if (collection !== COLLECTIONS.ACTION_LOGS) {
        getDbLogger().logUpdate(collection, filter, data, updateResult.modifiedCount).catch(err => 
            logError('Failed to log update', err, 'db.updateOne')
        );
    }
    
    return updateResult;
}

async function updateWithOperators(collection, filter = {}, updateDoc = {}, options = {}) {
    const updateResult = await getCollection(collection).updateMany(filter, updateDoc, options);

    if (collection !== COLLECTIONS.ACTION_LOGS) {
        getDbLogger().logUpdate(collection, filter, updateDoc, updateResult.modifiedCount).catch(err => 
            logError('Failed to log updateWithOperators', err, 'db.updateWithOperators')
        );
    }
    
    return updateResult;
}

async function updateOneWithOperators(collection, filter = {}, updateDoc = {}, options = {}) {
    const updateResult = await getCollection(collection).updateOne(filter, updateDoc, options);

    if (collection !== COLLECTIONS.ACTION_LOGS) {
        getDbLogger().logUpdate(collection, filter, updateDoc, updateResult.modifiedCount).catch(err => 
            logError('Failed to log updateOneWithOperators', err, 'db.updateOneWithOperators')
        );
    }
    
    return updateResult;
}

async function deleteRecord(collection, filter = {}) {
    const deleteResult = await getCollection(collection).deleteMany(filter);

    if (collection !== COLLECTIONS.ACTION_LOGS) {
        getDbLogger().logDelete(collection, filter, deleteResult.deletedCount).catch(err => 
            logError('Failed to log deleteRecord', err, 'db.deleteRecord')
        );
    }
    
    return deleteResult;
}

async function deleteOne(collection, filter = {}) {
    const deleteResult = await getCollection(collection).deleteOne(filter);

    if (collection !== COLLECTIONS.ACTION_LOGS) {
        getDbLogger().logDelete(collection, filter, deleteResult.deletedCount).catch(err => 
            logError('Failed to log deleteOne', err, 'db.deleteOne')
        );
    }
    
    return deleteResult;
}

async function bulkWrite(collection, operations) {
    if (!Array.isArray(operations) || operations.length === 0) {
        return { 
            acknowledged: true, 
            insertedCount: 0, 
            upsertedCount: 0, 
            modifiedCount: 0, 
            deletedCount: 0 
        };
    }
    
    const bulkResult = await getCollection(collection).bulkWrite(operations, { ordered: false });

    if (collection !== COLLECTIONS.ACTION_LOGS) {
        getDbLogger().logBulkWrite(collection, operations, bulkResult).catch(err => 
            logError('Failed to log bulkWrite', err, 'db.bulkWrite')
        );
    }
    
    return bulkResult;
}

module.exports = {
    connectDB,
    disconnectDB,
    getDB,
    getCollection,
    query,
    findOne,
    find,
    insert,
    update,
    updateOne,
    updateWithOperators,
    updateOneWithOperators,
    delete: deleteRecord,
    deleteOne,
    bulkWrite
};

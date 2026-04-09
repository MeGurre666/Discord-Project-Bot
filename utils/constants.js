const COLLECTIONS = {
    GUILDS: 'guilds',
    CHANNELS: 'channels',
    ROLES: 'roles',
    MEMBERS: 'members',
    BANS: 'bans',
    EMOJIS: 'emojis',
    MESSAGES: 'messages',
    ACTION_LOGS: 'action_logs',
    SYNC_STATE: 'sync_state'
};

const MESSAGE_TYPES = {
    ACTIVE: 'active',
    DELETED: 'deleted'
};

const SYNC_OPERATIONS = {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete'
};

const SYNC_ACTIONS = {
    INSERTED: 'inserted',
    UPDATED: 'updated',
    DELETED: 'deleted',
    DEACTIVATED: 'deactivated'
};

const DB_OPTIONS = {
    BULK_WRITE: { ordered: false },
    UPSERT: { upsert: true }
};

const DEFAULTS = {
    BATCH_SIZE: 100
};

const ACTION_TYPES = {
    INSERT: 'INSERT',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    BULK_WRITE: 'BULK_WRITE',
    EVENT: 'EVENT',
    SYNC: 'SYNC',
    COMMAND: 'COMMAND',
    ERROR: 'ERROR'
};

module.exports = {
    COLLECTIONS,
    MESSAGE_TYPES,
    SYNC_OPERATIONS,
    SYNC_ACTIONS,
    DB_OPTIONS,
    DEFAULTS,
    ACTION_TYPES
};

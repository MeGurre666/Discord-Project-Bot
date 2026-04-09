const { logError } = require('./logger');


function wrapEventHandler(eventName, handler) {
    return async (...args) => {
        try {
            await handler(...args);
        } catch (error) {
            logError(`Error in ${eventName} event handler`, error, eventName);
        }
    };
}

function createSyncEventHandler(eventName, syncFunction, getArgs) {
    return {
        name: eventName,
        execute: wrapEventHandler(eventName, async (...eventArgs) => {
            const syncArgs = getArgs ? getArgs(...eventArgs) : eventArgs;
            await syncFunction(...syncArgs);
        })
    };
}

module.exports = {
    wrapEventHandler,
    createSyncEventHandler
};

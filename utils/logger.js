const { getState, toBoolean } = require('./config');

const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG',
    SUCCESS: 'SUCCESS'
};

function formatLogMessage(level, message, context = '') {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` [${context}]` : '';
    return `[${timestamp}] ${level}${contextStr}: ${message}`;
}

function isDebugEnabled() {
    if (process.env.DEBUG !== undefined) {
        return toBoolean(process.env.DEBUG, false);
    }

    return getState('debug', false);
}

function logSuccess(message, context) {
    console.log(formatLogMessage(LOG_LEVELS.SUCCESS, message, context));
}

function logInfo(message, context) {
    console.log(formatLogMessage(LOG_LEVELS.INFO, message, context));
}

function logWarn(message, context) {
    console.warn(formatLogMessage(LOG_LEVELS.WARN, message, context));
}

function logError(message, error, context) {
    console.error(formatLogMessage(LOG_LEVELS.ERROR, message, context));
    if (error) {
        console.error('Error details:', error.message);
        if (isDebugEnabled()) {
            console.error('Stack trace:', error.stack);
        }
    }
}

function withErrorHandling(fn, context = 'unknown') {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            logError(`Error in ${context}`, error);
            throw error;
        }
    };
}

function withSafeExecution(fn, context = 'unknown') {
    return async (...args) => {
        try {
            const result = await fn(...args);
            return { success: true, data: result };
        } catch (error) {
            logError(`Error in ${context}`, error);
            return { success: false, error: error.message };
        }
    };
}

function createEventErrorHandler(eventName, handler) {
    return async (...args) => {
        try {
            await handler(...args);
        } catch (error) {
            logError(`Error in ${eventName} event handler`, error);
        }
    };
}

async function retryWithBackoff(fn, maxRetries = 3, delayMs = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            if (attempt < maxRetries) {
                const delay = delayMs * Math.pow(2, attempt);
                logWarn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError;
}

module.exports = {
    LOG_LEVELS,
    logSuccess,
    logInfo,
    logWarn,
    logError,
    withErrorHandling,
    withSafeExecution,
    createEventErrorHandler,
    retryWithBackoff,
    formatLogMessage
};

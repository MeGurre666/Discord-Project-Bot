const path = require('node:path');

const configPath = path.join(__dirname, '..', 'config.json');

function toBoolean(value, fallback = false) {
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

function getConfig() {
    try {
        // Use require for simple JSON loading and Node cache behavior.
        return require(configPath);
    } catch (error) {
        return {};
    }
}

function getPathValue(source, pathExpression) {
    if (!source || !pathExpression) {
        return undefined;
    }

    const pathSegments = String(pathExpression).split('.').filter(Boolean);
    let currentValue = source;

    for (const segment of pathSegments) {
        if (currentValue === null || currentValue === undefined || typeof currentValue !== 'object') {
            return undefined;
        }
        currentValue = currentValue[segment];
    }

    return currentValue;
}

function getState(stateName, fallback = false) {
    const config = getConfig();
    const stateValue = getPathValue(config, `states.${stateName}`);

    if (stateValue !== undefined) {
        return toBoolean(stateValue, fallback);
    }

    // Backward compatibility with previous key style in config.json.
    if (stateName === 'debug' && config?.Debug !== undefined) {
        return toBoolean(config.Debug, fallback);
    }

    if (stateName === 'syncMessageHistory' && config?.Sync_Message_History !== undefined) {
        return toBoolean(config.Sync_Message_History, fallback);
    }

    return fallback;
}

function getValue(pathExpression, fallback = undefined) {
    const config = getConfig();
    const value = getPathValue(config, pathExpression);
    return value === undefined ? fallback : value;
}

function getBoolean(pathExpression, fallback = false) {
    return toBoolean(getValue(pathExpression, fallback), fallback);
}

function getNumber(pathExpression, fallback, min = null, max = null) {
    const rawValue = getValue(pathExpression, fallback);
    const parsedValue = Number(rawValue);

    if (!Number.isFinite(parsedValue)) {
        return fallback;
    }

    let normalizedValue = parsedValue;
    if (min !== null) {
        normalizedValue = Math.max(min, normalizedValue);
    }
    if (max !== null) {
        normalizedValue = Math.min(max, normalizedValue);
    }

    return normalizedValue;
}

function getString(pathExpression, fallback = '') {
    const value = getValue(pathExpression, fallback);
    return typeof value === 'string' ? value : fallback;
}

function getObject(pathExpression, fallback = {}) {
    const value = getValue(pathExpression, fallback);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    return fallback;
}

module.exports = {
    getConfig,
    getValue,
    getState,
    getBoolean,
    getNumber,
    getString,
    getObject,
    toBoolean
};

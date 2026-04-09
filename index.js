const { ShardingManager } = require('discord.js');
const { getBoolean } = require('./utils/config');
const { checkAndPromptForUpdatesOnStartup } = require('./utils/updater');
const { getNumber, getString } = require('./utils/config');

const quietDotenv = getBoolean('logging.quietDotenv', true);

try {
    require('@dotenvx/dotenvx').config({ quiet: quietDotenv });
} catch (error) {
    if (error?.code === 'ENOENT' && error?.path?.includes('dotenvx-ops')) {
        console.warn('[dotenvx] Radar feature unavailable on Windows - continuing without observability');
    } else {
        throw error;
    }
}

async function start() {
    const updateCheckEnabled = getBoolean('updates.checkOnStartup', true);
    const updateNotifyEnabled = getBoolean('updates.notifyOnUpdate', true);
    const updateBranch = getString('updates.branch', 'main');
    const updateConfirmKeyword = getString('updates.confirmKeyword', 'y');
    const backupEnabled = getBoolean('updates.backups.enabled', true);
    const backupDirectory = getString('updates.backups.directory', 'backups');
    const backupKeepLatest = getNumber('updates.backups.keepLatest', 10, 0, 1000);
    const installDependenciesAfterUpdate = getBoolean('updates.installDependenciesAfterUpdate', true);

    await checkAndPromptForUpdatesOnStartup({
        enabled: updateCheckEnabled,
        notifyOnUpdate: updateNotifyEnabled,
        branch: updateBranch,
        confirmKeyword: updateConfirmKeyword,
        backupEnabled,
        backupDirectory,
        backupKeepLatest,
        installDependenciesAfterUpdate
    });

    const manager = new ShardingManager('./bot.js', {
        token: process.env.TOKEN,
        totalShards: 'auto'
    });

    const debugEnabled = getBoolean('states.debug', false);

    manager.on('shardCreate', (shard) => {
        if (debugEnabled) {
            console.log(`Launched shard ${shard.id}`);
        }
    });

    manager.spawn();
}

start().catch((error) => {
    console.error('[startup] Failed to start sharding manager:', error);
    process.exit(1);
});
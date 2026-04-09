const { ShardingManager } = require('discord.js');
const { checkAndPromptForUpdatesOnStartup } = require('./utils/updater');
const { getBoolean, getNumber, getString } = require('./utils/config');

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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');

function runCommand(command, args, cwd = REPO_ROOT, options = {}) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        ...options
    });

    return {
        ok: result.status === 0,
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || ''
    };
}

function runGit(args) {
    return runCommand('git', args);
}

function commandExists(command) {
    const check = runCommand(command, ['--version']);
    return check.ok;
}

function getBackupArchiveType(archiveName) {
    const lowerName = archiveName.toLowerCase();
    if (lowerName.endsWith('.tar.gz')) {
        return 'tar.gz';
    }
    if (lowerName.endsWith('.tgz')) {
        return 'tgz';
    }
    if (lowerName.endsWith('.zip')) {
        return 'zip';
    }
    return null;
}

function getUnixTimestamp() {
    return Math.floor(Date.now() / 1000);
}

function isGitRepository() {
    const insideWorkTree = runGit(['rev-parse', '--is-inside-work-tree']);
    return insideWorkTree.ok && insideWorkTree.stdout.trim() === 'true';
}

function checkForRemoteUpdate(branchName = 'main') {
    const fetchResult = runGit(['fetch', 'origin', branchName]);
    if (!fetchResult.ok) {
        throw new Error(`git fetch failed: ${fetchResult.stderr.trim() || fetchResult.stdout.trim()}`);
    }

    const localHead = runGit(['rev-parse', 'HEAD']);
    if (!localHead.ok) {
        throw new Error(`Unable to read local HEAD: ${localHead.stderr.trim() || localHead.stdout.trim()}`);
    }

    const remoteHead = runGit(['rev-parse', `origin/${branchName}`]);
    if (!remoteHead.ok) {
        throw new Error(`Unable to read origin/${branchName}: ${remoteHead.stderr.trim() || remoteHead.stdout.trim()}`);
    }

    const localHash = localHead.stdout.trim();
    const remoteHash = remoteHead.stdout.trim();

    return {
        hasUpdate: localHash !== remoteHash,
        localHash,
        remoteHash
    };
}

function hasLocalChanges() {
    const status = runGit(['status', '--porcelain']);
    if (!status.ok) {
        throw new Error(`Unable to check git status: ${status.stderr.trim() || status.stdout.trim()}`);
    }
    return status.stdout.trim().length > 0;
}

function resolveBackupDirectory(backupDirectory = 'backups') {
    return path.isAbsolute(backupDirectory)
        ? backupDirectory
        : path.join(REPO_ROOT, backupDirectory);
}

function pruneOldBackups(backupsDir, keepLatest = 0) {
    if (!Number.isFinite(keepLatest) || keepLatest <= 0) {
        return;
    }

    const backups = fs
        .readdirSync(backupsDir)
        .filter((name) => getBackupArchiveType(name) !== null)
        .map((name) => ({
            name,
            fullPath: path.join(backupsDir, name),
            mtimeMs: fs.statSync(path.join(backupsDir, name)).mtimeMs
        }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const backupsToDelete = backups.slice(keepLatest);
    for (const backup of backupsToDelete) {
        fs.rmSync(backup.fullPath, { force: true });
    }
}

function createFullBackupZip(options = {}) {
    const {
        backupDirectory = 'backups',
        keepLatest = 0
    } = options;

    const backupsDir = resolveBackupDirectory(backupDirectory);
    fs.mkdirSync(backupsDir, { recursive: true });

    const timestamp = getUnixTimestamp();
    const hasZip = process.platform === 'win32' || commandExists('zip');
    const hasTar = process.platform !== 'win32' && commandExists('tar');

    if (!hasZip && !hasTar) {
        throw new Error('Backup failed: neither "zip" nor "tar" command is available');
    }

    const extension = hasZip ? 'zip' : 'tar.gz';
    const backupFileName = `backup-${timestamp}.${extension}`;
    const backupFilePath = path.join(backupsDir, backupFileName);
    const tempBackupFilePath = path.join(os.tmpdir(), `discord-management-bot-backup-${timestamp}.${extension}`);

    if (fs.existsSync(tempBackupFilePath)) {
        fs.unlinkSync(tempBackupFilePath);
    }

    if (process.platform === 'win32') {
        const powershellScript = [
            "$ErrorActionPreference = 'Stop'",
            '$items = Get-ChildItem -LiteralPath . -Force | ForEach-Object { $_.Name }',
            'if (-not $items) { throw "No files to archive" }',
            `Compress-Archive -Path $items -DestinationPath '${tempBackupFilePath.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`
        ].join('; ');

        const backupResult = runCommand(
            'powershell',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', powershellScript],
            REPO_ROOT
        );

        if (!backupResult.ok) {
            throw new Error(`Backup failed: ${backupResult.stderr.trim() || backupResult.stdout.trim()}`);
        }
    }

    if (process.platform !== 'win32') {
        if (hasZip) {
            const zipResult = runCommand('zip', ['-rq', tempBackupFilePath, '.'], REPO_ROOT);
            if (!zipResult.ok) {
                throw new Error(`Backup failed: ${zipResult.stderr.trim() || zipResult.stdout.trim()}`);
            }
        } else {
            const tarResult = runCommand('tar', ['-czf', tempBackupFilePath, '.'], REPO_ROOT);
            if (!tarResult.ok) {
                throw new Error(`Backup failed: ${tarResult.stderr.trim() || tarResult.stdout.trim()}`);
            }
        }
    }

    try {
        fs.renameSync(tempBackupFilePath, backupFilePath);
    } catch (error) {
        // Cross-device moves can fail, so copy+delete as fallback.
        fs.copyFileSync(tempBackupFilePath, backupFilePath);
        fs.unlinkSync(tempBackupFilePath);
    }

    pruneOldBackups(backupsDir, keepLatest);

    return backupFilePath;
}

function promptForUpdateConfirmation(confirmKeyword = 'y') {
    return new Promise((resolve) => {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
            resolve(false);
            return;
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(`Update available. Type "${confirmKeyword}" to backup and install now: `, (answer) => {
            rl.close();
            resolve(String(answer).trim().toLowerCase() === String(confirmKeyword).toLowerCase());
        });
    });
}

function installDependencies() {
    const packageLockPath = path.join(REPO_ROOT, 'package-lock.json');
    const hasPackageLock = fs.existsSync(packageLockPath);

    const npmArgs = hasPackageLock ? ['ci'] : ['install'];
    const npmResult = runCommand('npm', npmArgs, REPO_ROOT, { stdio: 'inherit' });

    if (!npmResult.ok) {
        throw new Error('Dependency install failed.');
    }
}

function applyUpdate(branchName = 'main', options = {}) {
    const {
        installDependenciesAfterUpdate = true
    } = options;

    const stashLabel = `auto-updater-${getUnixTimestamp()}`;
    const hadChanges = hasLocalChanges();
    let stashed = false;

    if (hadChanges) {
        const stashPush = runGit(['stash', 'push', '-u', '-m', stashLabel]);
        if (!stashPush.ok) {
            throw new Error(`Failed to stash local changes: ${stashPush.stderr.trim() || stashPush.stdout.trim()}`);
        }
        stashed = true;
    }

    const pullResult = runGit(['pull', '--ff-only', 'origin', branchName]);
    if (!pullResult.ok) {
        if (stashed) {
            runGit(['stash', 'pop']);
        }
        throw new Error(`git pull failed: ${pullResult.stderr.trim() || pullResult.stdout.trim()}`);
    }

    if (installDependenciesAfterUpdate) {
        installDependencies();
    }

    if (stashed) {
        const stashPop = runGit(['stash', 'pop']);
        if (!stashPop.ok) {
            throw new Error(
                `Update applied, but failed to re-apply local changes. Resolve stash manually. ${stashPop.stderr.trim() || stashPop.stdout.trim()}`
            );
        }
    }
}

async function checkAndPromptForUpdatesOnStartup(options = {}) {
    const {
        enabled = true,
        branch = 'main',
        notifyOnUpdate = true,
        confirmKeyword = 'y',
        backupEnabled = true,
        backupDirectory = 'backups',
        backupKeepLatest = 0,
        installDependenciesAfterUpdate = true
    } = options;

    if (!enabled) {
        return;
    }

    if (!isGitRepository()) {
        if (notifyOnUpdate) {
            console.log('[updater] Skipping update check: not a git repository.');
        }
        return;
    }

    try {
        const updateState = checkForRemoteUpdate(branch);

        if (!updateState.hasUpdate) {
            console.log('[updater] Bot is already up to date.');
            return;
        }

        if (notifyOnUpdate) {
            console.log(`[updater] Update available (${updateState.localHash.slice(0, 7)} -> ${updateState.remoteHash.slice(0, 7)}).`);
        }

        const shouldApply = await promptForUpdateConfirmation(confirmKeyword);
        if (!shouldApply) {
            console.log('[updater] Update skipped by user input.');
            return;
        }

        if (backupEnabled) {
            console.log('[updater] Creating full backup archive before update...');
            const backupPath = createFullBackupZip({
                backupDirectory,
                keepLatest: backupKeepLatest
            });
            console.log(`[updater] Backup created: ${backupPath}`);
        } else {
            console.log('[updater] Backup creation disabled by config (updates.backups.enabled=false).');
        }

        console.log('[updater] Installing latest update...');
        applyUpdate(branch, { installDependenciesAfterUpdate });
        console.log('[updater] Update completed successfully. Restart the bot to apply runtime changes.');
        console.log(`[updater] If you need to restore, run: npm run rollback -- --latest`);
    } catch (error) {
        console.error(`[updater] ${error.message}`);
    }
}

module.exports = {
    checkAndPromptForUpdatesOnStartup
};

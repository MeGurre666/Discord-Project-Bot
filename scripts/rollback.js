#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');
const { getString } = require('../utils/config');

const REPO_ROOT = path.join(__dirname, '..');

function resolveBackupsDir() {
    const configuredDir = getString('updates.backups.directory', 'backups');
    return path.isAbsolute(configuredDir)
        ? configuredDir
        : path.join(REPO_ROOT, configuredDir);
}

const BACKUPS_DIR = resolveBackupsDir();

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

function listBackups() {
    if (!fs.existsSync(BACKUPS_DIR)) {
        return [];
    }

    return fs
        .readdirSync(BACKUPS_DIR)
        .filter((name) => getBackupArchiveType(name) !== null)
        .map((name) => {
            const fullPath = path.join(BACKUPS_DIR, name);
            const stat = fs.statSync(fullPath);
            return {
                name,
                fullPath,
                modifiedMs: stat.mtimeMs
            };
        })
        .sort((a, b) => b.modifiedMs - a.modifiedMs);
}

function parseArgs(argv) {
    const options = {
        latest: false,
        file: null
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];

        if (token === '--latest') {
            options.latest = true;
            continue;
        }

        if (token === '--file') {
            options.file = argv[index + 1] || null;
            index += 1;
        }
    }

    return options;
}

function createReadline() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

function askQuestion(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(String(answer).trim()));
    });
}

async function chooseBackup(backups) {
    if (backups.length === 0) {
        throw new Error('No backup archive files found in backups/.');
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error('Interactive rollback requires a TTY. Use --latest or --file.');
    }

    console.log('Available backups:');
    backups.forEach((backup, index) => {
        console.log(`${index + 1}. ${backup.name}`);
    });

    const rl = createReadline();
    try {
        const answer = await askQuestion(rl, 'Select backup number (default 1): ');
        const selectedIndex = answer === '' ? 1 : Number(answer);

        if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > backups.length) {
            throw new Error('Invalid backup selection.');
        }

        return backups[selectedIndex - 1];
    } finally {
        rl.close();
    }
}

async function confirmRollback(targetFileName) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return true;
    }

    const rl = createReadline();
    try {
        console.log(`You are about to restore from ${targetFileName}.`);
        const answer = await askQuestion(rl, 'Type ROLLBACK to continue: ');
        return answer === 'ROLLBACK';
    } finally {
        rl.close();
    }
}

function restoreFromZip(zipPath) {
    const archiveType = getBackupArchiveType(zipPath);
    if (!archiveType) {
        throw new Error(`Unsupported backup format: ${path.basename(zipPath)}`);
    }

    const restoreTempDir = path.join(os.tmpdir(), `discord-bot-rollback-${Date.now()}`);
    fs.mkdirSync(restoreTempDir, { recursive: true });

    if (process.platform === 'win32') {
        const psScript = [
            "$ErrorActionPreference = 'Stop'",
            `$repo = '${REPO_ROOT.replace(/'/g, "''")}'`,
            `$zip = '${zipPath.replace(/'/g, "''")}'`,
            `$extract = '${restoreTempDir.replace(/'/g, "''")}'`,
            "$exclude = @('backups')",
            'Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force',
            "Get-ChildItem -LiteralPath $repo -Force | Where-Object { $exclude -notcontains $_.Name } | Remove-Item -Recurse -Force",
            "Get-ChildItem -LiteralPath $extract -Force | Where-Object { $_.Name -ne 'backups' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $repo $_.Name) -Recurse -Force }",
            'Remove-Item -LiteralPath $extract -Recurse -Force'
        ].join('; ');

        const result = runCommand('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript]);
        if (!result.ok) {
            throw new Error(`Rollback failed: ${result.stderr.trim() || result.stdout.trim()}`);
        }

        return;
    }

    if (archiveType === 'zip') {
        const unzipCheck = runCommand('unzip', ['-v']);
        if (!unzipCheck.ok) {
            throw new Error('Rollback failed: "unzip" command is required to restore .zip backups on non-Windows systems.');
        }

        const unzipResult = runCommand('unzip', ['-o', zipPath, '-d', restoreTempDir]);
        if (!unzipResult.ok) {
            throw new Error(`Rollback failed: ${unzipResult.stderr.trim() || unzipResult.stdout.trim()}`);
        }
    } else {
        const tarCheck = runCommand('tar', ['--version']);
        if (!tarCheck.ok) {
            throw new Error('Rollback failed: "tar" command is required to restore .tar.gz backups on non-Windows systems.');
        }

        const tarResult = runCommand('tar', ['-xzf', zipPath, '-C', restoreTempDir]);
        if (!tarResult.ok) {
            throw new Error(`Rollback failed: ${tarResult.stderr.trim() || tarResult.stdout.trim()}`);
        }
    }

    for (const entry of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
        if (entry.name === 'backups') {
            continue;
        }

        const targetPath = path.join(REPO_ROOT, entry.name);
        fs.rmSync(targetPath, { recursive: true, force: true });
    }

    for (const entry of fs.readdirSync(restoreTempDir, { withFileTypes: true })) {
        if (entry.name === 'backups') {
            continue;
        }

        const sourcePath = path.join(restoreTempDir, entry.name);
        const destinationPath = path.join(REPO_ROOT, entry.name);
        fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
    }

    fs.rmSync(restoreTempDir, { recursive: true, force: true });
}

async function resolveTargetBackup(options, backups) {
    if (options.file) {
        const resolvedPath = path.isAbsolute(options.file)
            ? options.file
            : path.join(BACKUPS_DIR, options.file);

        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Backup file not found: ${resolvedPath}`);
        }

        return {
            name: path.basename(resolvedPath),
            fullPath: resolvedPath
        };
    }

    if (options.latest) {
        if (backups.length === 0) {
            throw new Error('No backup archive files found in backups/.');
        }
        return backups[0];
    }

    return chooseBackup(backups);
}

async function main() {
    const backups = listBackups();
    const options = parseArgs(process.argv.slice(2));
    const targetBackup = await resolveTargetBackup(options, backups);

    const confirmed = await confirmRollback(targetBackup.name);
    if (!confirmed) {
        console.log('Rollback canceled.');
        process.exit(0);
    }

    console.log(`[rollback] Restoring from ${targetBackup.name}...`);
    restoreFromZip(targetBackup.fullPath);
    console.log('[rollback] Restore completed successfully.');
    console.log('[rollback] Reinstall dependencies if needed: npm install');
}

main().catch((error) => {
    console.error(`[rollback] ${error.message}`);
    process.exit(1);
});

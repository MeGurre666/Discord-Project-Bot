const fs = require('node:fs');
const path = require('node:path');
const { getState, getBoolean, getValue } = require('./utils/config');

const debugEnabled = getState('debug', false);
const startupDetailsEnabled = getBoolean('logging.startupDetails', true);
const quietDotenv = getBoolean('logging.quietDotenv', true);

process.on('uncaughtException', (error) => {
    if (error?.code === 'ENOENT' && error?.path?.includes('dotenvx-ops')) {
        console.warn('[dotenvx] Radar feature unavailable on Windows - continuing without observability');
        return;
    }
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

require('@dotenvx/dotenvx').config({ quiet: quietDotenv });

if (process.env.DEBUG === undefined) {
    process.env.DEBUG = debugEnabled ? 'true' : 'false';
}

const { Client, Collection, GatewayIntentBits, Events, REST, Routes } = require('discord.js');

if (!process.env.TOKEN || !process.env.CLIENT_ID) {
    console.error('ERROR: TOKEN and CLIENT_ID must be set in environment variables');
    process.exit(1);
}

const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.AutoModerationExecution,
        GatewayIntentBits.GuildModeration
    ]
});

client.commands = new Collection();
client.cooldowns = new Collection();

function getJavaScriptFiles(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        return [];
    }

    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...getJavaScriptFiles(fullPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(fullPath);
        }
    }

    return files;
}

function getEnabledCogFolders() {
    const cogsPath = path.join(__dirname, 'cogs');
    if (!fs.existsSync(cogsPath)) {
        return [];
    }

    const allCogs = fs
        .readdirSync(cogsPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);

    const explicitlyEnabled = getValue('cogs.enabled', null);
    const explicitlyDisabled = getValue('cogs.disabled', []);
    const cogsEnabled = getState('loadCogs', true);

    if (!cogsEnabled) {
        return [];
    }

    const enabledSet = Array.isArray(explicitlyEnabled) && explicitlyEnabled.length > 0
        ? new Set(explicitlyEnabled.map(String))
        : new Set(allCogs);
    const disabledSet = new Set(
        Array.isArray(explicitlyDisabled)
            ? explicitlyDisabled.map(String)
            : []
    );

    const selectedCogs = allCogs.filter(cogName => enabledSet.has(cogName) && !disabledSet.has(cogName));

    if (startupDetailsEnabled) {
        if (selectedCogs.length === 0) {
            console.log('[INFO] No cogs selected for loading');
        } else {
            console.log(`[INFO] Enabled cogs: ${selectedCogs.join(', ')}`);
        }
    }

    return selectedCogs;
}

const loadCommands = (enabledCogs = []) => {
    try {
        const commandRoots = [{
            rootType: 'base',
            rootPath: path.join(__dirname, 'commands')
        }];

        for (const cogName of enabledCogs) {
            commandRoots.push({
                rootType: 'cog',
                cogName,
                rootPath: path.join(__dirname, 'cogs', cogName, 'commands')
            });
        }

        let loadedCount = 0;

        for (const commandRoot of commandRoots) {
            if (!fs.existsSync(commandRoot.rootPath)) {
                if (commandRoot.rootType === 'base') {
                    console.warn('[WARNING] Commands folder not found');
                }
                continue;
            }

            const commandFiles = getJavaScriptFiles(commandRoot.rootPath);
            for (const filePath of commandFiles) {
                try {
                    delete require.cache[require.resolve(filePath)];
                    const command = require(filePath);
                    
                    if ('data' in command && 'execute' in command) {
                        if (client.commands.has(command.data.name)) {
                            console.warn(`[WARNING] Duplicate command name "${command.data.name}" from ${filePath} - overriding previous command`);
                        }
                        client.commands.set(command.data.name, command);
                        if (debugEnabled) {
                            const source = commandRoot.rootType === 'cog'
                                ? `cogs/${commandRoot.cogName}`
                                : 'commands';
                            const relativePath = path.relative(__dirname, filePath);
                            console.log(`Loaded command: ${command.data.name} (${source} -> ${relativePath})`);
                        }
                        loadedCount++;
                    } else {
                        console.warn(`[WARNING] Command at ${filePath} missing "data" or "execute" property`);
                    }
                } catch (error) {
                    console.error(`[ERROR] Failed to load command ${filePath}:`, error.message);
                }
            }
        }

        if (startupDetailsEnabled) {
            console.log(`\n[INFO] Successfully loaded ${loadedCount} command(s)\n`);
        }
        return loadedCount;
    } catch (error) {
        console.error('[ERROR] Failed to load commands:', error);
        return 0;
    }
};

const loadEvents = (enabledCogs = []) => {
    try {
        const eventRoots = [{
            rootType: 'base',
            rootPath: path.join(__dirname, 'events')
        }];

        for (const cogName of enabledCogs) {
            eventRoots.push({
                rootType: 'cog',
                cogName,
                rootPath: path.join(__dirname, 'cogs', cogName, 'events')
            });
        }

        let registeredCount = 0;
        const { cooldowns } = client;

        for (const eventRoot of eventRoots) {
            if (!fs.existsSync(eventRoot.rootPath)) {
                if (eventRoot.rootType === 'base') {
                    console.warn('[WARNING] Events folder not found');
                }
                continue;
            }

            const eventFiles = getJavaScriptFiles(eventRoot.rootPath);

            for (const filePath of eventFiles) {
                try {
                    delete require.cache[require.resolve(filePath)];
                    const eventExport = require(filePath);
                    const events = Array.isArray(eventExport) ? eventExport : [eventExport];
                    
                    for (const event of events) {
                        if (!event.name || !event.execute) {
                            console.warn(`[WARNING] Event in ${filePath} missing "name" or "execute" property`);
                            continue;
                        }

                        const listener = (...args) => event.execute(...args, cooldowns);
                        
                        if (event.once) {
                            client.once(event.name, listener);
                        } else {
                            client.on(event.name, listener);
                        }

                        if (debugEnabled) {
                            const source = eventRoot.rootType === 'cog'
                                ? `cogs/${eventRoot.cogName}`
                                : 'events';
                            const relativePath = path.relative(__dirname, filePath);
                            console.log(`Registered event: ${event.name} (${source} -> ${relativePath})`);
                        }
                        registeredCount++;
                    }
                } catch (error) {
                    console.error(`[ERROR] Failed to load event ${filePath}:`, error.message);
                }
            }
        }

        if (startupDetailsEnabled) {
            console.log(`\n[INFO] Successfully registered ${registeredCount} event(s)\n`);
        }
        return registeredCount;
    } catch (error) {
        console.error('[ERROR] Failed to load events:', error);
        return 0;
    }
};


const deployCommands = async () => {
    if (!getState('deployCommandsOnReady', true)) {
        if (startupDetailsEnabled) {
            console.log('[INFO] Command deployment disabled by config (states.deployCommandsOnReady=false)');
        }
        return;
    }

    if (client.commands.size === 0) {
        console.warn('[WARNING] No commands to deploy');
        return;
    }

    const rest = new REST().setToken(token);
    
    try {
        console.log(`[INFO] Deploying ${client.commands.size} application command(s)...`);
        
        const commandData = Array.from(client.commands.values()).map(cmd => cmd.data.toJSON());
        
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commandData }
        );
        
        console.log(`Successfully deployed ${client.commands.size} application command(s)\n`);
    } catch (error) {
        console.error('[ERROR] Failed to deploy commands:', error);
        throw error;
    }
};


const init = async () => {
    try {
        if (startupDetailsEnabled) {
            console.log('[INFO] Starting Bot...\n');
        }

        const enabledCogs = getEnabledCogFolders();
        
        loadCommands(enabledCogs);
        loadEvents(enabledCogs);

        client.once(Events.ClientReady, async () => {
            try {
                await deployCommands();
            } catch (error) {
                console.error('[ERROR] Command deployment failed:', error);
            }
        });

        if (startupDetailsEnabled) {
            console.log('[INFO] Logging in to Discord...');
        }
        await client.login(token);
        
    } catch (error) {
        console.error('[ERROR] Failed to initialize bot:', error);
        process.exit(1);
    }
};

module.exports = { client, init };

if (require.main === module) {
    init();
}
const { Events, MessageFlags } = require('discord.js');
const { logError, logWarn } = require('../utils/logger');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.client._handledInteractions) {
            interaction.client._handledInteractions = new Set();
        }

        const interactionAgeMs = Date.now() - interaction.createdTimestamp;
        if (interactionAgeMs > 2500) {
            logWarn(
                `Late interaction handling detected for ${interaction.commandName || 'interaction'}: ${interactionAgeMs}ms old`
            );
        }

        if (interaction.client._handledInteractions.has(interaction.id)) {
            return;
        }

        interaction.client._handledInteractions.add(interaction.id);

        try {
            if (interaction.isChatInputCommand()) {
                await handleCommandInteraction(interaction);
            } else if (interaction.isAutocomplete()) {
                await handleAutocompleteInteraction(interaction);
            }
        } catch (error) {
            await handleInteractionError(interaction, error);
        } finally {
            interaction.client._handledInteractions.delete(interaction.id);
        }
    }
};

async function handleCommandInteraction(interaction) {
    const command = interaction.client.commands.get(interaction.commandName);
    
    if (!command) {
        logWarn(`No command matching ${interaction.commandName} was found`);
        return interaction.reply({ 
            content: 'An error occurred while executing this command.', 
            flags: MessageFlags.Ephemeral
        });
    }
    
    if (command.guildOnly && !interaction.inGuild()) {
        return interaction.reply({ 
            content: 'This command can only be used in a server.', 
            flags: MessageFlags.Ephemeral
        });
    }
    
    await command.execute(interaction);
}

async function handleAutocompleteInteraction(interaction) {
    const command = interaction.client.commands.get(interaction.commandName);
    
    if (!command) {
        logWarn(`No autocomplete command matching ${interaction.commandName} was found`);
        return interaction.respond([]);
    }
    
    if (!command.autocomplete) {
        logWarn(`Command ${interaction.commandName} does not have autocomplete handler`);
        return interaction.respond([]);
    }
    
    await command.autocomplete(interaction);
}

async function handleInteractionError(interaction, error) {
    logError(`Error executing ${interaction.commandName || 'interaction'}`, error);

    if (error?.code === 10062 || error?.code === 40060) {
        const interactionAgeMs = Date.now() - interaction.createdTimestamp;
        logWarn(
            `Interaction token invalid for ${interaction.commandName || 'interaction'} (age: ${interactionAgeMs}ms, code: ${error.code})`
        );
        return;
    }
    
    const errorMessage = { 
        content: 'There was an error while executing this command!', 
        flags: MessageFlags.Ephemeral
    };
    
    try {
        if (interaction.deferred) {
            await interaction.editReply(errorMessage);
        } else if (interaction.replied) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    } catch (replyError) {
        logError('Failed to send error message to user', replyError);
    }
}
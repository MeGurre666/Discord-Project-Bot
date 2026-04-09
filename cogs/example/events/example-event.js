const { Events } = require('discord.js');

module.exports = [
    {
        name: Events.ClientReady,
        once: true,
        execute: async (ready) => {
            console.log(`Logged in as ${ready.user.tag}!`);
        }
    }
];
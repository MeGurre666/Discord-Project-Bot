**Discord Project Bot** is a pre-built Discord.JS bot that is made for the ease of doing the hard part of a brand new Discord Bot Project. With logging and database logic pre-built into it, ease of creating new commands and function to go together with the rest of the codebase.

## Prerequisites
MongoDB database

Node v18.0+

## Install

``curl -fsSL https://cdn.megurre.cloud/project-bot/install.sh | bash``

You can find the install script [here](./scripts/install.sh)

The bot comes with a /ping command, which can be removed by deleting the ping.js file within the ``/commands/util/`` folder.

## Updates

This Project will be updated by default Auto Updates are disabled, but they can be enabled within the config.json file found [here](config.json)

## Cogs

Create cogs as self-contained feature folders inside `cogs/`.

Folder format:

```text
cogs/
  moderation/
    commands/
      ban.js
      unban.js
    events/
      moderation-log.js
  tickets/
    commands/
      ticket/
        create.js
        close.js
    events/
      ticket-channel.js
```

Notes:
- Every top-level folder in `cogs/` is treated as one cog.
- `commands/` and `events/` are optional per cog.
- Subfolders are supported inside both `commands/` and `events/`.
- Only `.js` files are loaded.

Enable or disable specific cogs in `config.json`:

```json
{
  "states": {
    "loadCogs": true
  },
  "cogs": {
    "enabled": ["moderation", "tickets"],
    "disabled": ["example"]
  }
}
```

### Startup Update Flow

When `updates.checkOnStartup` is enabled, the launcher checks this GitHub repository for updates on startup.

If an update is found, the console prompts:

If an update is found, the console prompts:

`Update available. Type "y" to backup and install now, or "n" to skip (auto-skip in 10s):`

If the user types `y`

It will check your `config.json` file for your configuration, by default it is set to take backups before updating.

If the user types `n`, the update is skipped, and startup continues as normal.

If you don't select `y` or `n` after 10 seconds, it will continue with startup like normal.



### Rollback

If an update causes issues, restore from a backup zip:

`npm run rollback`

This opens an interactive backup picker and restores the selected zip.

Quick options:

- Restore latest backup: `npm run rollback -- --latest`
- Restore specific file: `npm run rollback -- --file backup-1712700000.zip`

Rollback keeps the `backups/` folder and restores everything else from the selected zip.


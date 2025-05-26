require('dotenv').config();

const { Client, IntentsBitField, ActivityType } = require('discord.js');
const fs = require('fs');
const { log_info, log_warn, log_error, log_debug } = require('./utils');

const databaseModule = require('./database');
const textLevelsModule = require('./levels/textlevels');
const voiceLevelsModule = require('./levels/voicelevels');
const economyModule = require('./utils/economy');
const moderationModule = require('./moderative/moderation');
const giveawaysModule = require('./utils/giveaways');
const logsModule = require('./moderative/logs');

let config;
try {
    log_debug('[Main] Attempting to read configuration file...');
    const configFile = fs.readFileSync('./config.json', 'utf8');
    log_debug('[Main] Configuration file read. Attempting to parse JSON...');
    config = JSON.parse(configFile);
    log_info('Configuration loaded successfully from config.json.');
    log_debug('[Main] Configuration JSON parsed successfully.');
} catch (error) {
    log_error(`Could not load or parse config.json. Detailed error: ${error.message}`);
    log_debug(`[Main] Error details during config load: ${error.stack}`);
    log_error('Please ensure config.json exists in container directory. If you accidentally deleted config just copy paste config_default.json. If you\'ve deleted that as well, check https://github.com/ffoksiu/nadiobot/releases');
    process.exit(1);
}

log_debug('[Main] Reading Discord bot token from environment variables...');
const token = process.env.DISCORD_BOT_TOKEN;
if (!token || token === 'YOUR_BOT_TOKEN_GOES_HERE' || token.length < 20) {
    log_error('Discord bot token is missing or invalid in the .env file.');
    log_debug(`[Main] Invalid token found: ${token ? 'Token present but invalid' : 'Token not found'}`);
    log_error('Please check your .env file and ensure discord bot token is correctly set.');
    process.exit(1);
}
log_debug('[Main] Discord bot token validated.');

const activityTypeMap = {
    "Playing": ActivityType.Playing,
    "Streaming": ActivityType.Streaming,
    "Listening": ActivityType.Listening,
    "Watching": ActivityType.Watching,
    "Competing": ActivityType.Competing,
    "Custom": ActivityType.Custom
};
log_debug('[Main] ActivityType map initialized.');

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildPresences
    ],
});
log_debug('[Main] Discord client initialized with specified intents.');

let currentStatusIndex = 0;
const statusIntervalMs = (config.main.status_change_interval_seconds || 10) * 1000;
log_debug(`[Main] Bot status update interval set to ${statusIntervalMs}ms.`);

function updateBotStatus() {
    log_debug(`[Status] Attempting to update bot status. Current index: ${currentStatusIndex}`);
    const statusData = config.main.bot_statuses[currentStatusIndex];

    if (!statusData || !activityTypeMap[statusData.activity_type]) {
        log_warn(`[Status] Invalid status definition at index ${currentStatusIndex} in config.json. Skipping.`);
        log_debug(`[Status] Invalid status data: ${JSON.stringify(statusData)}`);
        currentStatusIndex = (currentStatusIndex + 1) % config.main.bot_statuses.length;
        log_debug(`[Status] New status index: ${currentStatusIndex}`);
        return;
    }

    const activityOptions = { type: activityTypeMap[statusData.activity_type] };
    log_debug(`[Status] Base activity options: ${JSON.stringify(activityOptions)} for activity: ${statusData.activity_name}`);

    if (statusData.activity_type === "Streaming") {
        if (statusData.stream_url) {
            activityOptions.url = statusData.stream_url;
            log_debug(`[Status] Streaming URL set: ${statusData.stream_url}`);
        } else {
            log_warn(`[Status] "Streaming" status at index ${currentStatusIndex} requires "stream_url", but it's missing. Skipping.`);
            log_debug(`[Status] Missing stream_url for streaming status: ${JSON.stringify(statusData)}`);
            currentStatusIndex = (currentStatusIndex + 1) % config.main.bot_statuses.length;
            log_debug(`[Status] New status index after streaming skip: ${currentStatusIndex}`);
            return;
        }
    }
    else if (statusData.stream_url && statusData.activity_type !== "Streaming") {
        log_warn(`[Status] "stream_url" provided for non-streaming status at index ${currentStatusIndex}. It will be ignored.`);
        log_debug(`[Status] stream_url ignored for non-streaming activity: ${statusData.activity_type}`);
    }

    try {
        client.user.setActivity(statusData.activity_name, activityOptions);
        log_info(`[Status] Changed status to: ${statusData.activity_type} - ${statusData.activity_name}`);
        log_debug(`[Status] Successfully set activity: ${statusData.activity_name}, options: ${JSON.stringify(activityOptions)}`);
    } catch (error) {
        log_error(`[Status] Failed to set activity: ${error.message}`);
        log_debug(`[Status] Error setting activity: ${error.stack}`);
    }

    currentStatusIndex = (currentStatusIndex + 1) % config.main.bot_statuses.length;
    log_debug(`[Status] Updated status index to: ${currentStatusIndex}`);
}

client.once('ready', async () => {
    log_info(`${config.main.bot_name || 'Your Bot'} is online! Logged in as ${client.user.tag}`);
    log_debug(`[Main] Client ready event triggered. Bot Name: ${config.main.bot_name || 'Your Bot'}, User Tag: ${client.user.tag}`);
    
    log_debug('[Main] Initial bot status update call.');
    updateBotStatus();
    log_debug('[Main] Setting up interval for bot status updates.');
    setInterval(updateBotStatus, statusIntervalMs);

    const modulesToLoad = [
        { name: 'Database', module: databaseModule, config_section: config.database },
        { name: 'Text Levels', module: textLevelsModule, config_section: config.text_levels },
        { name: 'Voice Levels', module: voiceLevelsModule, config_section: config.voice_levels },
        { name: 'Economy', module: economyModule, config_section: config.economy },
        { name: 'Moderation', module: moderationModule, config_section: config.moderation },
        { name: 'Logs', module: logsModule, config_section: config.logs },
        { name: 'Giveaways', module: giveawaysModule, config_section: config.giveaways }
    ];
    log_debug(`[Main] Modules to load: ${JSON.stringify(modulesToLoad.map(m => m.name))}`);

    for (const moduleInfo of modulesToLoad) {
        log_debug(`[Main] Processing module: ${moduleInfo.name}`);
        if (moduleInfo.config_section && moduleInfo.config_section.enabled) {
            log_debug(`[Main] Module ${moduleInfo.name} is enabled in config. Attempting initialization.`);
            try {
                await moduleInfo.module.init(client, config); 
                log_debug(`[Main] Module ${moduleInfo.name} initialized successfully.`);
            } catch (e) {
                log_error(`[${moduleInfo.name}] Failed to initialize module: ${e.message}`);
                log_debug(`[${moduleInfo.name}] Initialization error stack: ${e.stack}`);
            }
        } else {
            log_info(`[${moduleInfo.name}] Module disabled or configuration section missing. Skipping initialization.`);
            log_debug(`[Main] Module ${moduleInfo.name} skipped. Config section: ${JSON.stringify(moduleInfo.config_section)}`);
        }
    }
    log_debug('[Main] All modules processed.');
});

log_debug('[Main] Attempting to log in the bot...');
client.login(token)
    .then(() => {
        log_debug('[Main] Bot login successful.');
    })
    .catch(error => {
        log_error('Failed to log in the bot. Please check:');
        log_error('1. Is the Discord bot token in .env file correct?');
        log_error('2. Is "PRESENCE_INTENT" enabled in the Discord Developer Portal (Bot section)?');
        log_error('3. Make sure that points above are fulfilled. Otherwise, refer to detailed error below. If nothing helps, consider getting support from frozxic@discord.');
        log_error(`Detailed error: ${error.message}`);
        log_debug(`[Main] Bot login error: ${error.stack}`);
        process.exit(1);
    });

process.on('unhandledRejection', error => {
    log_error(`Unhandled promise rejection: ${error}`);
    log_debug(`[Process] Unhandled rejection details: ${error.stack || 'No stack available'}`);
});

process.on('uncaughtException', error => {
    log_error(`Uncaught exception: ${error}`);
    log_debug(`[Process] Uncaught exception details: ${error.stack}`);
    process.exit(1);
});
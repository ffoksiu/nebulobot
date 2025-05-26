require('dotenv').config();

const { Client, IntentsBitField, ActivityType } = require('discord.js');
const fs = require('fs');
const logger = require('./logger');

const databaseModule = require('./database');
const textLevelsModule = require('./levels/textlevels');
const voiceLevelsModule = require('./levels/voicelevels');
const economyModule = require('./utils/economy');
const moderationModule = require('./moderative/moderation');
const giveawaysModule = require('./utils/giveaways');
const logsModule = require('./moderative/logs');

logger.debug('Starting bot initialization process.');

let config;
try {
    logger.debug('Attempting to read config.json file.');
    const configFile = fs.readFileSync('./config.json', 'utf8');
    logger.debug('Config file read successfully. Parsing JSON.');
    config = JSON.parse(configFile);
    logger.info('Configuration loaded successfully from config.json.');
} catch (error) {
    logger.error(`Could not load or parse config.json: ${error.message}`);
    logger.error('Please ensure config.json exists in container directory. If you accidentally deleted config just copy paste config_default.json. If you\'ve deleted that as well, check https://github.com/ffoksiu/nadiobot/releases');
    process.exit(1);
}

const token = process.env.DISCORD_BOT_TOKEN;
if (!token || token === 'YOUR_BOT_TOKEN_GOES_HERE' || token.length < 20) {
    logger.error('Discord bot token is missing or invalid in the .env file.');
    logger.error('Please check your .env file and ensure discord bot token is correctly set.');
    logger.debug('Token validation failed. Exiting process.');
    process.exit(1);
}
logger.debug('Discord bot token validated successfully.');

const activityTypeMap = {
    "Playing": ActivityType.Playing,
    "Streaming": ActivityType.Streaming,
    "Listening": ActivityType.Listening,
    "Watching": ActivityType.Watching,
    "Competing": ActivityType.Competing,
    "Custom": ActivityType.Custom
};

logger.debug('Initializing Discord.js client with specified intents.');
const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildPresences,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildVoiceStates
    ],
});
logger.debug('Discord.js client initialized.');

let currentStatusIndex = 0;
const statusIntervalMs = (config.main.status_change_interval_seconds || 10) * 1000;
logger.debug(`Status change interval set to ${statusIntervalMs / 1000} seconds.`);

function updateBotStatus() {
    logger.debug('Attempting to update bot status.');
    const statusData = config.main.bot_statuses[currentStatusIndex];

    if (!statusData) {
        logger.warn(`[Status] No status data found for index ${currentStatusIndex}. This might indicate an empty or invalid bot_statuses array.`);
        currentStatusIndex = (currentStatusIndex + 1) % config.main.bot_statuses.length;
        if (config.main.bot_statuses.length === 0) {
            logger.error('[Status] No statuses defined in config.json. Bot will not display any custom status.');
            return;
        }
    }

    if (!activityTypeMap[statusData.activity_type]) {
        logger.warn(`[Status] Invalid activity_type "${statusData.activity_type}" found for status at index ${currentStatusIndex}. Skipping this status.`);
        currentStatusIndex = (currentStatusIndex + 1) % config.main.bot_statuses.length;
        return;
    }

    const activityOptions = { type: activityTypeMap[statusData.activity_type] };
    logger.debug(`[Status] Processing status: Type: ${statusData.activity_type}, Name: ${statusData.activity_name}`);

    if (statusData.activity_type === "Streaming") {
        if (statusData.stream_url) {
            activityOptions.url = statusData.stream_url;
            logger.debug(`[Status] Streaming status with URL: ${statusData.stream_url}`);
        } else {
            logger.warn(`[Status] "Streaming" status at index ${currentStatusIndex} requires "stream_url", but it's missing. Skipping this status.`);
            currentStatusIndex = (currentStatusIndex + 1) % config.main.bot_statuses.length;
            return;
        }
    } else if (statusData.stream_url) {
        logger.warn(`[Status] "stream_url" provided for non-streaming status at index ${currentStatusIndex}. It will be ignored.`);
    }

    client.user.setActivity(statusData.activity_name, activityOptions);
    logger.main(`[Status] Changed status to: ${statusData.activity_type} - ${statusData.activity_name}`);

    currentStatusIndex = (currentStatusIndex + 1) % config.main.bot_statuses.length;
}

client.once('ready', async () => {
    logger.info(`${config.main.bot_name || 'Your Bot'} is online! Logged in as ${client.user.tag}`);
    
    logger.debug('Setting initial bot status.');
    updateBotStatus();
    logger.debug('Starting status rotation interval.');
    setInterval(updateBotStatus, statusIntervalMs);

    logger.debug('Preparing to load modules.');

    let db_pool = null;
    if (config.database && config.database.enabled) {
        logger.debug('Attempting to initialize Database module.');
        db_pool = await databaseModule.init(client, config);
        if (db_pool) {
            logger.debug('Database module initialization completed successfully.');
        } else {
            logger.error('Database module failed to initialize. Dependent modules might not function.');
        }
    } else {
        logger.info('[Database] Module disabled. Skipping database initialization.');
    }
    
    const modulesToLoad = [
        { name: 'Text Levels', module: textLevelsModule, config_section: config.text_levels, logger: logger.tls },
        { name: 'Voice Levels', module: voiceLevelsModule, config_section: config.voice_levels, logger: logger.vls },
        { name: 'Economy', module: economyModule, config_section: config.economy, logger: logger.eco },
        { name: 'Moderation', module: moderationModule, config_section: config.moderation, logger: logger.mod },
        { name: 'Logs', module: logsModule, config_section: config.logs, logger: logger.logs },
        { name: 'Giveaways', module: giveawaysModule, config_section: config.giveaways, logger: logger.give }
    ];

    for (const moduleInfo of modulesToLoad) {
        logger.debug(`Checking initialization for ${moduleInfo.name} module.`);
        if (moduleInfo.config_section && moduleInfo.config_section.enabled) {
            try {
                logger.debug(`Attempting to initialize ${moduleInfo.name} module.`);
                await moduleInfo.module.init(client, config, db_pool); 
                logger.debug(`${moduleInfo.name} module initialization completed.`);
            } catch (e) {
                logger.error(`[${moduleInfo.name}] Failed to initialize module: ${e.message}`);
                logger.debug(`[${moduleInfo.name}] Initialization failed for unknown reason: ${e.stack}`);
            }
        } else {
            logger.info(`[${moduleInfo.name}] Module disabled or configuration section missing. Skipping initialization.`);
            logger.debug(`[${moduleInfo.name}] Module skipped due to config settings.`);
        }
    }
    logger.debug('All modules processing complete.');
});

logger.debug('Attempting to log in Discord client.');
client.login(token)
    .catch(error => {
        logger.error('Failed to log in the bot. Please check:');
        logger.error('1. Is the Discord bot token in .env file correct?');
        logger.error('2. Is "PRESENCE_INTENT" and "MESSAGE_CONTENT_INTENT" enabled in the Discord Developer Portal (Bot section)?');
        logger.error('3. Make sure that points above are fulfilled. Otherwise, refer to detailed error below. If nothing helps, consider getting support from frozxic@discord.');
        logger.error(`Detailed error: ${error.message}`);
        logger.debug('Bot login failed. Exiting process.');
        process.exit(1);
    });

logger.debug('Setting up process error handlers.');
process.on('unhandledRejection', error => {
    logger.error(`Unhandled promise rejection: ${error.stack || error}`);
    logger.debug('Process received unhandled rejection. Logging error.');
});

process.on('uncaughtException', error => {
    logger.error(`Uncaught exception: ${error.stack || error}`);
    logger.debug('Process received uncaught exception. Exiting process.');
    process.exit(1);
});
logger.debug('Bot initialization process finished.');
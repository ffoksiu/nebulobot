require('dotenv').config();

const { Client, IntentsBitField, ActivityType } = require('discord.js');
const fs = require('fs');

let config;
try {
    const configFile = fs.readFileSync('./config.json', 'utf8');
    config = JSON.parse(configFile);
    console.log('Configuration loaded successfully from config.json.');
} catch (error) {
    console.error('ERROR: Could not load or parse config.json:', error.message);
    console.error('Please ensure config.json exists in container directory. If you accidentally deleted config just copy paste config_default.json. If youve deleted that as well, check https://github.com/ffoksiu/nadiobot/releases');
    process.exit(1);
}

const token = process.env.DISCORD_BOT_TOKEN;
if (!token || token === 'YOUR_BOT_TOKEN_GOES_HERE' || token.length < 20) {
    console.error('ERROR: Discord bot token is missing or invalid in the .env file.');
    console.error('Please check your .env file and ensure discord bot token is correctly set.');
    process.exit(1);
}

const activityTypeMap = {
    "Playing": ActivityType.Playing,
    "Streaming": ActivityType.Streaming,
    "Listening": ActivityType.Listening,
    "Watching": ActivityType.Watching,
    "Competing": ActivityType.Competing,
    "Custom": ActivityType.Custom
};

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildPresences
    ],
});

let currentStatusIndex = 0;
const statusIntervalMs = (config.status_change_interval_seconds || 10) * 1000;

function updateBotStatus() {
    const statusData = config.bot_statuses[currentStatusIndex];

    if (!statusData || !activityTypeMap[statusData.activity_type]) {
        console.warn(`[WARNING] Invalid status definition at index ${currentStatusIndex} in config.json. Skipping.`);
        currentStatusIndex = (currentStatusIndex + 1) % config.bot_statuses.length;
        return;
    }

    const activityOptions = { type: activityTypeMap[statusData.activity_type] };

    if (statusData.activity_type === "Streaming") {
        if (statusData.stream_url) {
            activityOptions.url = statusData.stream_url;
        } else {
            console.warn(`[WARNING] "Streaming" status at index ${currentStatusIndex} requires "stream_url", but it's missing. Skipping.`);
            currentStatusIndex = (currentStatusIndex + 1) % config.bot_statuses.length;
            return;
        }
    }
    else if (statusData.stream_url && statusData.activity_type !== "Streaming") {
        console.warn(`[WARNING] "stream_url" provided for non-streaming status at index ${currentStatusIndex}. It will be ignored.`);
    }

    client.user.setActivity(statusData.activity_name, activityOptions);
    console.log(`Changed status to: ${statusData.activity_type} - ${statusData.activity_name}`);

    currentStatusIndex = (currentStatusIndex + 1) % config.bot_statuses.length;
}

client.once('ready', () => {
    console.log(`${config.bot_name || 'Your Bot'} is online! Logged in as ${client.user.tag}`);
    updateBotStatus();
    setInterval(updateBotStatus, statusIntervalMs);
});

client.login(token)
    .catch(error => {
        console.error('ERROR: Failed to log in the bot. Please check:');
        console.error('1. Is the Discord bot token in .env file correct?');
        console.error('2. Is "PRESENCE_INTENT" enabled in the Discord Developer Portal (Bot section)?');
        console.error('3. Make sure that points above are fulfilled. Otherwise, refer to detailed error below. If nothing helps, consider getting support from frozxic@discord.');        console.error('Detailed error:', error.message);
        process.exit(1);
    });

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
    process.exit(1);
});
# NebuloBot - A Versatile Discord Bot


NebuloBot is a modern, modular, and extensible Discord bot designed to bring a wide range of features to your server. From dynamic custom statuses to a comprehensive text leveling system and more, NebuloBot aims to be a powerful companion for your community.

---

## ✨ Features

NebuloBot comes packed with features, with many more planned for future development.

### Core Functionality
*   **Dynamic Statuses:** Your bot will display various activities (Playing, Watching, Listening, Competing, Streaming, or Custom) that rotate automatically at configurable intervals.
*   **Advanced Logging:** Detailed, colored console logs help you monitor bot activity and troubleshoot issues effectively, with module-specific tags for easy identification.

### Integrated Systems
*   **Database Integration:** Designed to connect with a MySQL database for persistent storage, enabling advanced features like user levels and economy.
*   **Text Leveling System (TLS):**
    *   Users gain experience points (XP) for sending messages.
    *   XP required for each level is fully customizable via a mathematical formula.
    *   Customizable cooldowns prevent XP farming.
    *   Automatic level-up announcements in a designated channel, with fully customizable rich embeds (title, content, color, footer, and placeholders for user/level info).

### Modular Extensibility
NebuloBot's architecture allows for easy expansion with more features like:
*   **Voice Leveling System:** Gain XP for time spent in voice channels.
*   **Economy System:** In-server currency, shops, and minigames.
*   **Moderation Tools:** Commands for server moderation (e.g., clearing messages, banning users).
*   **Giveaways System:** Host and manage giveaways directly through the bot.
*   **Advanced Logging:** Detailed logging of server events (e.g., message edits/deletes, member joins/leaves) to dedicated log channels.
These modules are ready for initialization but require further configuration and implementation for their specific features.

---

## 🚀 Getting Started

To get your NebuloBot up and running, follow these steps.

### Prerequisites
*   **Node.js:** Make sure you have [Node.js](https://nodejs.org/en/download/) installed on your machine.
*   **Discord Account:** You need a Discord account to create a bot application.
*   **Bot Application:**
    1.  Go to the [Discord Developer Portal](https://discord.com/developers/applications).
    2.  Click "New Application", give it a name, and create it.
    3.  Navigate to the "Bot" section on the left sidebar. Click "Add Bot".
    4.  **Copy your Bot Token:** This is a secret key. **Do NOT share it with anyone!**
    5.  **Enable Intents:** Under "Privileged Gateway Intents", enable `PRESENCE INTENT`, `GUILD MESSAGES INTENT`, and `MESSAGE CONTENT INTENT`. These are crucial for the bot to function correctly (especially for statuses and text levels). If you plan to use voice levels in the future, enable `GUILD VOICE STATES` too.
    6.  **Invite your Bot:** Go to "OAuth2" -> "URL Generator".
        *   Under "SCOPES", select `bot`.
        *   Under "BOT PERMISSIONS", grant necessary permissions (e.g., `Read Messages/View Channels`, `Send Messages`, `Manage Roles` for future features, `Embed Links`).
        *   Copy the generated URL and open it in your browser to invite the bot to your server.
*   **MySQL Database:** NebuloBot requires a MySQL/MariaDB database server. Ensure you have one set up and note down the host, port, username, password, and desired database name (e.g., `bot_database`).

### Configuration
NebuloBot uses two configuration files: `.env` (for your secret token) and `config.json` (for all other settings).

1.  **`.env` File (Your Bot Token)**
    *   Go to `.env` file.
    *   Add your Discord Bot Token to this file:
        ```ini
        DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN_GOES_HERE
        ```
        **Remember to replace `YOUR_BOT_TOKEN_GOES_HERE` with the actual token you copied from the Discord Developer Portal.** Keep this file private. Do not share this under any circumstances.

2.  **`config.json` File (Bot Settings)**
    *   In the root directory, you'll find a file named `config_default.json` and `config.json`. Config is what's loaded. config_default is used in case your configuration file gets deleted or if you'd like to reset settings fabrically.
    *   **Don't edit config_default.json unless you're sure what you're doing.**
    *   **Important:** `config.json` must NOT contain any comments (lines starting with `//`) Additionally, it is neccessary for you to follow value types (eg integer: `1` is not the same as a string `"1"` and it **may break your config**.)
    *   Open `config.json` and customize the settings within its sections:

    ```json
    {
      "main": {
        "bot_name": "...",
        "status_change_interval_seconds": 10,
        "bot_statuses": [
          { "activity_type": "Playing", "activity_name": "..." },
          { "activity_type": "Streaming", "activity_name": "...", "stream_url": "..." },
          { "activity_type": "Custom", "activity_name": "..." }
        ],
        "command_prefix": "!"
      },
      "database": {
        "enabled": true,
        "type": "mysql",
        "host": "127.0.0.1",
        "port": 3306,
        "user": "root",
        "password": "password",
        "database_name": "bot_database"
      },
      "text_levels": {
        "enabled": true,
        "xp_gain_per_message": 10,
        "xp_cooldown_seconds": 60,
        "level_up_formula": "5 * {level} * {level} + 50 * {level} + 100",
        "level_up_channel_id": null,
        "level_up_embed_title": "🎉 Level Up!",
        "level_up_embed_color": "#00FF00",
        "level_up_embed_content": "Congratulations, {user.name}! You've reached **Level {level}**!",
        "level_up_embed_footer": "User ID: {user.id} | Time: {time}"
      },
      "voice_levels": { "enabled": false },
      "economy": { "enabled": false },
      "moderation": { "enabled": false },
      "logs": { "enabled": false },
      "giveaways": { "enabled": false }
    }
    ```
    *   **`main` section:**
        *   `bot_name`: The name displayed in console logs.
        *   `status_change_interval_seconds`: How often the bot's status changes (in seconds).
        *   `bot_statuses`: A list of statuses.
            *   `activity_type`: Choose from "Playing", "Watching", "Listening", "Competing", "Streaming", "Custom".
            *   `activity_name`: The text displayed with the activity.
            *   `stream_url`: **Required only for "Streaming" type.**
        *   `command_prefix`: The character used to trigger commands (e.g., `!help`).
    *   **`database` section:**
        *   `enabled`: Set to `true` to enable database integration.
        *   `type`: Currently supports `mysql`.
        *   `host`, `port`, `user`, `password`, `database_name`: Your MySQL server connection details. **Ensure the database (`bot_database` by default) exists on your server.**
    *   **`text_levels` section:**
        *   `enabled`: Set to `true` to enable the Text Leveling System.
        *   `xp_gain_per_message`: XP gained for each message.
        *   `xp_cooldown_seconds`: Cooldown (in seconds) before a user can gain XP again from messages.
        *   `level_up_formula`: A mathematical formula to calculate XP needed for the next level. `{level}` is replaced by the target level.
        *   `level_up_channel_id`: The ID of the channel where level-up announcements will be sent. Set to `null` to send in the channel where the user leveled up.
        *   `level_up_embed_title`, `level_up_embed_color`, `level_up_embed_content`, `level_up_embed_footer`: Customize the appearance and text of the level-up message.
            *   **Placeholders:** You can use `{user.name}`, `{user.id}`, `{level}`, and `{time}` within the embed strings.
    *   **Other sections (`voice_levels`, `economy`, `moderation`, `logs`, `giveaways`):** These modules are initialized but require further configuration and implementation for their specific features.

### Running the Bot
Once configured, navigate to your bot's directory in the terminal and run:
```bash
node index.js
```
Your bot should come online and start displaying logs in the console.

---

## 🤝 Support & Contribution
For any issues, questions, or if you'd like to contribute, please contact `frozxic@discord`.

## 📜 License
This project is open-source. Feel free to use it as you wish. 

## 🚀 Future Plans
The bot is planned on being an absolute full-stack:
   * Text & Voice levelling system
   * Economy System
   * Moderation, Logging
   * Fun & Utility Commands
   * Detailed graphs & server statistics
   * Tickets, Reports
   * Radio mode
   * **Full Customization**
   * Database integration
   * API Integrations
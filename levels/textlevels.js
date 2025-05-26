const logger = require('../logger');
const { EmbedBuilder } = require('discord.js');
const cooldowns = new Set();

module.exports = {
    init: async (client, config, db_pool) => {
        logger.tls('Text Levels module initialization requested.');
        if (!config.text_levels || !config.text_levels.enabled) {
            logger.tls('Module disabled in config. Skipping initialization.');
            return;
        }
        if (!db_pool) {
            logger.error('[TLS] Database connection not available. Text Levels module cannot be initialized.');
            return;
        }
        logger.tls('Initializing Text Levels module...');

        const calculate_xp_for_level = (level) => {
            const formula_string = config.text_levels.level_up_formula.replace(/{level}/g, level);
            try {
                const xp = new Function('level', `return ${formula_string};`)(level);
                logger.debug(`[TLS] Calculated XP for level ${level}: ${xp}`);
                return xp;
            } catch (e) {
                logger.error(`[TLS] Error evaluating level up formula "${config.text_levels.level_up_formula}": ${e.message}. Returning Infinity.`);
                return Infinity;
            }
        };

        client.guilds.cache.forEach(async guild => {
            const users_table_name = `textlevels_users_${guild.id}`;
            const phrases_table_name = `textlevels_phrases_${guild.id}`;
            const channels_table_name = `textlevels_channels_${guild.id}`;

            try {
                await db_pool.query(`
                    CREATE TABLE IF NOT EXISTS \`${users_table_name}\` (
                        user_id VARCHAR(20) PRIMARY KEY,
                        xpt INT DEFAULT 0,
                        ovxpt INT DEFAULT 0,
                        tlevel INT DEFAULT 0,
                        ping_on_level_up TINYINT(1) DEFAULT 1
                    );
                `);
                logger.debug(`[TLS] Ensured table '${users_table_name}' exists for guild ${guild.name} (${guild.id}).`);

                await db_pool.query(`
                    CREATE TABLE IF NOT EXISTS \`${phrases_table_name}\` (
                        phrase_id INT AUTO_INCREMENT PRIMARY KEY,
                        phrase_text VARCHAR(255) NOT NULL UNIQUE
                    );
                `);
                logger.debug(`[TLS] Ensured table '${phrases_table_name}' exists for guild ${guild.name} (${guild.id}).`);

                await db_pool.query(`
                    CREATE TABLE IF NOT EXISTS \`${channels_table_name}\` (
                        channel_id VARCHAR(20) PRIMARY KEY,
                        enabled TINYINT(1) DEFAULT 1
                    );
                `);
                logger.debug(`[TLS] Ensured table '${channels_table_name}' exists for guild ${guild.name} (${guild.id}).`);

            } catch (err) {
                logger.error(`[TLS] Failed to create tables for guild ${guild.name} (${guild.id}): ${err.message}`);
            }
        });

        client.on('messageCreate', async message => {
            if (message.author.bot || !message.guild) {
                logger.debug(`[TLS] Ignoring message from bot or outside a guild.`);
                return;
            }

            const cooldown_key = `${message.author.id}-${message.guild.id}`;
            if (cooldowns.has(cooldown_key)) {
                logger.debug(`[TLS] User ${message.author.tag} (${message.author.id}) on cooldown for XP in guild ${message.guild.name}.`);
                return;
            }

            const users_table_name = `textlevels_users_${message.guild.id}`;
            let connection;
            try {
                connection = await db_pool.getConnection();
                logger.debug(`[TLS] Fetched DB connection for user ${message.author.id} in guild ${message.guild.id}.`);

                const [rows] = await connection.query(`SELECT xpt, ovxpt, tlevel, ping_on_level_up FROM \`${users_table_name}\` WHERE user_id = ?`, [message.author.id]);
                let userData = rows[0];

                if (!userData) {
                    logger.debug(`[TLS] User ${message.author.id} not found in DB. Inserting new record.`);
                    await connection.query(`INSERT INTO \`${users_table_name}\` (user_id) VALUES (?)`, [message.author.id]);
                    userData = { xpt: 0, ovxpt: 0, tlevel: 0, ping_on_level_up: 1 };
                }

                userData.xpt += config.text_levels.xp_gain_per_message;
                userData.ovxpt += config.text_levels.xp_gain_per_message;
                logger.debug(`[TLS] User ${message.author.id} XP updated: xpt=${userData.xpt}, ovxpt=${userData.ovxpt}.`);

                const xp_needed_for_next_level = calculate_xp_for_level(userData.tlevel + 1);
                logger.debug(`[TLS] XP needed for Level ${userData.tlevel + 1}: ${xp_needed_for_next_level}. Current XP: ${userData.xpt}.`);

                let leveled_up = false;
                if (userData.xpt >= xp_needed_for_next_level) {
                    userData.tlevel++;
                    userData.xpt = userData.xpt - xp_needed_for_next_level;
                    leveled_up = true;
                    logger.tls(`User ${message.author.tag} (${message.author.id}) leveled up to Level ${userData.tlevel}!`);
                }

                await connection.query(`UPDATE \`${users_table_name}\` SET xpt = ?, ovxpt = ?, tlevel = ? WHERE user_id = ?`, [userData.xpt, userData.ovxpt, userData.tlevel, message.author.id]);
                logger.debug(`[TLS] User ${message.author.id} DB record updated.`);

                if (leveled_up) {
                    const level_up_channel = config.text_levels.level_up_channel_id ?
                        await message.guild.channels.fetch(config.text_levels.level_up_channel_id).catch(() => null) :
                        message.channel;

                    if (level_up_channel) {
                        logger.debug(`[TLS] Sending level up message to channel: ${level_up_channel.name} (${level_up_channel.id}).`);
                        const placeholders = {
                            '{user.name}': message.author.username,
                            '{user.id}': message.author.id,
                            '{level}': userData.tlevel,
                            '{time}': logger.time_get()
                        };

                        let embed_title = config.text_levels.level_up_embed_title;
                        let embed_content = config.text_levels.level_up_embed_content;
                        let embed_footer = config.text_levels.level_up_embed_footer;

                        for (const key in placeholders) {
                            const value = placeholders[key];
                            embed_title = embed_title.replace(new RegExp(key, 'g'), value);
                            embed_content = embed_content.replace(new RegExp(key, 'g'), value);
                            embed_footer = embed_footer.replace(new RegExp(key, 'g'), value);
                        }

                        const embed = new EmbedBuilder()
                            .setTitle(embed_title)
                            .setDescription(embed_content)
                            .setColor(config.text_levels.level_up_embed_color)
                            .setFooter({ text: embed_footer });

                        const ping_prefix = userData.ping_on_level_up ? `${message.author} ` : '';
                        await level_up_channel.send({ content: `${ping_prefix}`, embeds: [embed] });
                        logger.tls(`Level up message sent for ${message.author.tag} to Level ${userData.tlevel}.`);
                    } else {
                        logger.warn(`[TLS] Level up channel not found or accessible for guild ${message.guild.name}.`);
                    }
                }

                cooldowns.add(cooldown_key);
                setTimeout(() => {
                    cooldowns.delete(cooldown_key);
                    logger.debug(`[TLS] Cooldown for ${message.author.id} in guild ${message.guild.id} removed.`);
                }, config.text_levels.xp_cooldown_seconds * 1000);

            } catch (err) {
                logger.error(`[TLS] Error processing message for XP: ${err.message}`);
                logger.debug(`[TLS] Detailed error for message processing: ${err.stack}`);
            } finally {
                if (connection) connection.release();
            }
        });

        logger.tls('Text Levels module initialized and operational.');
    }
};
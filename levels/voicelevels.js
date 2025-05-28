const logger = require('../logger');
const { EmbedBuilder } = require('discord.js');

const activeVoiceUsers = new Map();
let xpGrantingInterval;

module.exports = {
    init: async (client, config, db_pool) => {
        logger.vls('Voice Levels module initialization requested.');
        if (!config.voice_levels || !config.voice_levels.enabled) {
            logger.vls('Module disabled in config. Skipping initialization.');
            return;
        }
        if (!db_pool) {
            logger.error('[VLS] Database connection not available. Voice Levels module cannot be initialized.');
            return;
        }
        logger.vls('Initializing Voice Levels module...');

        const xp_gain_per_second = config.voice_levels.xp_gain_per_second;
        const xp_grant_interval_ms = (config.voice_levels.xp_grant_interval_seconds || 60) * 1000;

        const calculate_xp_for_level = (level) => {
            const formula_string = config.voice_levels.level_up_formula.replace(/{level}/g, level);
            try {
                const xp = new Function('level', `return ${formula_string};`)(level);
                logger.debug(`[VLS] Calculated XP for level ${level}: ${xp}`);
                return xp;
            } catch (e) {
                logger.error(`[VLS] Error evaluating level up formula "${config.voice_levels.level_up_formula}": ${e.message}. Returning Infinity.`);
                return Infinity;
            }
        };

        const updateUserXP = async (userId, guildId, xpToAdd, connection) => {
            const users_table_name = `voicelevels_users_${guildId}`;
            try {
                const [rows] = await connection.query(
                    `SELECT vxpt, ovxpt, vlevel, ping_on_level_up FROM \`${users_table_name}\` WHERE user_id = ?`,
                    [userId]
                );
                let userData = rows[0];

                if (!userData) {
                    logger.debug(`[VLS] User ${userId} not found in DB. Inserting new record.`);
                    await connection.query(`INSERT INTO \`${users_table_name}\` (user_id) VALUES (?)`, [userId]);
                    userData = { vxpt: 0, ovxpt: 0, vlevel: 0, ping_on_level_up: 1 };
                }

                userData.vxpt += xpToAdd;
                userData.ovxpt += xpToAdd;

                const xp_needed_for_next_level = calculate_xp_for_level(userData.vlevel + 1);
                let leveled_up = false;
                if (userData.vxpt >= xp_needed_for_next_level) {
                    userData.vlevel++;
                    userData.vxpt = userData.vxpt - xp_needed_for_next_level;
                    leveled_up = true;
                    logger.vls(`User ${userId} leveled up to Level ${userData.vlevel}!`);
                }

                await connection.query(
                    `UPDATE \`${users_table_name}\` SET vxpt = ?, ovxpt = ?, vlevel = ? WHERE user_id = ?`,
                    [userData.vxpt, userData.ovxpt, userData.vlevel, userId]
                );
                logger.debug(`[VLS] User ${userId} DB record updated: vxpt=${userData.vxpt}, ovxpt=${userData.ovxpt}, vlevel=${userData.vlevel}.`);

                if (leveled_up) {
                    const guild = client.guilds.cache.get(guildId);
                    if (!guild) {
                        logger.warn(`[VLS] Guild ${guildId} not found for level up message.`);
                        return;
                    }

                    const user = await guild.members.fetch(userId).catch(() => null);
                    if (!user) {
                        logger.warn(`[VLS] User ${userId} not found in guild ${guildId} for level up message.`);
                        return;
                    }

                    const level_up_channel = config.voice_levels.level_up_channel_id ?
                        await guild.channels.fetch(config.voice_levels.level_up_channel_id).catch(() => null) :
                        null;

                    if (level_up_channel) {
                        const placeholders = {
                            '{user.name}': user.user.username,
                            '{user.id}': user.user.id,
                            '{level}': userData.vlevel,
                            '{time}': logger.time_get()
                        };

                        let embed_title = config.voice_levels.level_up_embed_title;
                        let embed_content = config.voice_levels.level_up_embed_content;
                        let embed_footer = config.voice_levels.level_up_embed_footer;

                        for (const key in placeholders) {
                            const value = placeholders[key];
                            embed_title = embed_title.replace(new RegExp(key, 'g'), value);
                            embed_content = embed_content.replace(new RegExp(key, 'g'), value);
                            embed_footer = embed_footer.replace(new RegExp(key, 'g'), value);
                        }

                        const embed = new EmbedBuilder()
                            .setTitle(embed_title)
                            .setDescription(embed_content)
                            .setColor(config.voice_levels.level_up_embed_color)
                            .setFooter({ text: embed_footer });

                        const ping_prefix = userData.ping_on_level_up ? `${user} ` : '';
                        await level_up_channel.send({ content: `${ping_prefix}`, embeds: [embed] });
                        logger.vls(`Level up message sent for ${user.user.tag} to Level ${userData.vlevel}.`);
                    } else {
                        logger.warn(`[VLS] Level up channel not found or accessible for guild ${guild.name}.`);
                    }
                }
            } catch (err) {
                logger.error(`[VLS] Error updating user XP for ${userId} in guild ${guildId}: ${err.message}`);
                logger.debug(`[VLS] Detailed error updating user XP: ${err.stack}`);
            }
        };

        const updateChannelXP = async (userId, channelId, guildId, xpToAdd, connection) => {
            const channel_xp_table_name = `voicelevels_channels_${guildId}`;
            try {
                await connection.query(
                    `INSERT INTO \`${channel_xp_table_name}\` (user_id, channel_id, channel_xp) VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE channel_xp = channel_xp + VALUES(channel_xp)`,
                    [userId, channelId, xpToAdd]
                );
                logger.debug(`[VLS] Updated channel XP for user ${userId} in channel ${channelId} by ${xpToAdd}.`);
            } catch (err) {
                logger.error(`[VLS] Error updating channel XP for user ${userId} in channel ${channelId}: ${err.message}`);
                logger.debug(`[VLS] Detailed error updating channel XP: ${err.stack}`);
            }
        };

        const updateColleagueXP = async (user1Id, user2Id, guildId, xpToAdd, connection) => {
            const id1 = user1Id < user2Id ? user1Id : user2Id;
            const id2 = user1Id < user2Id ? user2Id : user1Id;

            const colleague_xp_table_name = `voicelevels_colleagues_${guildId}`;
            try {
                await connection.query(
                    `INSERT INTO \`${colleague_xp_table_name}\` (user1_id, user2_id, colleague_xp) VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE colleague_xp = colleague_xp + VALUES(colleague_xp)`,
                    [id1, id2, xpToAdd]
                );
                logger.debug(`[VLS] Updated colleague XP for pair (${id1}, ${id2}) by ${xpToAdd}.`);
            } catch (err) {
                logger.error(`[VLS] Error updating colleague XP for pair (${id1}, ${id2}): ${err.message}`);
                logger.debug(`[VLS] Detailed error updating colleague XP: ${err.stack}`);
            }
        };

        const isChannelEligibleForXP = async (channelId, guildId, connection) => {
            const channels_config_table_name = `voicelevels_channels_config_${guildId}`;
            try {
                const [rows] = await connection.query(`SELECT enabled FROM \`${channels_config_table_name}\` WHERE channel_id = ?`, [channelId]);
                if (rows.length === 0) {
                    await connection.query(`INSERT INTO \`${channels_config_table_name}\` (channel_id, enabled) VALUES (?, 1)`, [channelId]);
                    return true;
                }
                return rows[0].enabled === 1;
            } catch (err) {
                logger.error(`[VLS] Error checking channel eligibility for ${channelId} in guild ${guildId}: ${err.message}`);
                return false;
            }
        };

        client.guilds.cache.forEach(async guild => {
            const users_table_name = `voicelevels_users_${guild.id}`;
            const channels_config_table_name = `voicelevels_channels_config_${guild.id}`;
            const channel_xp_table_name = `voicelevels_channels_${guild.id}`;
            const colleague_xp_table_name = `voicelevels_colleagues_${guild.id}`;

            let connection;
            try {
                connection = await db_pool.getConnection();

                await connection.query(`
                    CREATE TABLE IF NOT EXISTS \`${users_table_name}\` (
                        user_id VARCHAR(20) PRIMARY KEY,
                        vxpt INT DEFAULT 0,
                        ovxpt INT DEFAULT 0,
                        vlevel INT DEFAULT 0,
                        ping_on_level_up TINYINT(1) DEFAULT 1
                    );
                `);
                logger.debug(`[VLS] Ensured table '${users_table_name}' exists for guild ${guild.name} (${guild.id}).`);

                await connection.query(`
                    CREATE TABLE IF NOT EXISTS \`${channels_config_table_name}\` (
                        channel_id VARCHAR(20) PRIMARY KEY,
                        enabled TINYINT(1) DEFAULT 1
                    );
                `);
                logger.debug(`[VLS] Ensured table '${channels_config_table_name}' exists for guild ${guild.name} (${guild.id}).`);

                await connection.query(`
                    CREATE TABLE IF NOT EXISTS \`${channel_xp_table_name}\` (
                        user_id VARCHAR(20),
                        channel_id VARCHAR(20),
                        channel_xp INT DEFAULT 0,
                        PRIMARY KEY (user_id, channel_id)
                    );
                `);
                logger.debug(`[VLS] Ensured table '${channel_xp_table_name}' exists for guild ${guild.name} (${guild.id}).`);

                await connection.query(`
                    CREATE TABLE IF NOT EXISTS \`${colleague_xp_table_name}\` (
                        user1_id VARCHAR(20),
                        user2_id VARCHAR(20),
                        colleague_xp INT DEFAULT 0,
                        PRIMARY KEY (user1_id, user2_id)
                    );
                `);
                logger.debug(`[VLS] Ensured table '${colleague_xp_table_name}' exists for guild ${guild.name} (${guild.id}).`);

            } catch (err) {
                logger.error(`[VLS] Failed to create tables for guild ${guild.name} (${guild.id}): ${err.message}`);
            } finally {
                if (connection) connection.release();
            }
        });

        const isUserActiveInVoice = (state, guild) => {
            return state.channel && !state.member.user.bot && !state.selfMute && !state.serverMute && !state.selfDeaf && !state.serverDeaf && state.channel.id !== guild.afkChannelId;
        };

        const grantXPAndSave = async (userId, guildId, channelId, lastXPCheckTime, currentTime) => {
            let connection;
            try {
                connection = await db_pool.getConnection();
                const guild = client.guilds.cache.get(guildId);
                const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
                if (!member) {
                    logger.debug(`[VLS] User ${userId} not found in guild ${guildId} during XP grant. Skipping.`);
                    return;
                }

                const elapsedSeconds = (currentTime - lastXPCheckTime) / 1000;
                if (elapsedSeconds <= 0) return;

                const channelEligible = await isChannelEligibleForXP(channelId, guildId, connection);
                if (!channelEligible) {
                    logger.debug(`[VLS] Channel ${channelId} in guild ${guildId} is not eligible. Skipping XP grant.`);
                    return;
                }

                const xpToAdd = Math.floor(elapsedSeconds * xp_gain_per_second);
                if (xpToAdd <= 0) return;

                await updateUserXP(userId, guildId, xpToAdd, connection);
                await updateChannelXP(userId, channelId, guildId, xpToAdd, connection);

                if (member.voice.channel) {
                    const activeMembersInChannel = member.voice.channel.members.filter(m =>
                        m.id !== userId && isUserActiveInVoice({ channel: m.voice.channel, member: m, selfMute: m.voice.selfMute, serverMute: m.voice.serverMute, selfDeaf: m.voice.selfDeaf, serverDeaf: m.voice.serverDeaf }, guild)
                    );

                    for (const colleagueMember of activeMembersInChannel.values()) {
                        const colleagueId = colleagueMember.id;
                        await updateColleagueXP(userId, colleagueId, guildId, xpToAdd, connection);
                    }
                }
                logger.debug(`[VLS] Granted XP for ${userId} in ${guildId} for ${elapsedSeconds.toFixed(2)}s.`);

            } catch (err) {
                logger.error(`[VLS] Critical error during grantXPAndSave for ${userId} in ${guildId}: ${err.message}`);
                logger.debug(`[VLS] Detailed grantXPAndSave error: ${err.stack}`);
            } finally {
                if (connection) connection.release();
            }
        };

        client.on('voiceStateUpdate', async (oldState, newState) => {
            const userId = newState.id;
            const guildId = newState.guild.id;
            const guild = newState.guild;
            const key = `${guildId}-${userId}`;

            if (newState.member && newState.member.user.bot) {
                logger.debug(`[VLS] Ignoring bot ${newState.member.user.tag} (${userId}).`);
                return;
            }

            const isActive = newState.channel && isUserActiveInVoice(newState, guild);

            if (activeVoiceUsers.has(key)) {
                const userData = activeVoiceUsers.get(key);
                if (!isActive || (newState.channel && newState.channel.id !== userData.channelId)) {
                    logger.debug(`[VLS] User ${userId} (${guildId}) leaving/changing/deactivating. Calculating final XP.`);
                    await grantXPAndSave(userId, guildId, userData.channelId, userData.lastXPCheckTime, Date.now());
                    activeVoiceUsers.delete(key);
                    logger.debug(`[VLS] User ${userId} (${guildId}) removed from active voice users map.`);
                }
            }

            if (isActive && !activeVoiceUsers.has(key)) {
                let connection;
                try {
                    connection = await db_pool.getConnection();
                    const channelEligible = await isChannelEligibleForXP(newState.channel.id, guildId, connection);
                    if (channelEligible) {
                        activeVoiceUsers.set(key, {
                            channelId: newState.channel.id,
                            lastXPCheckTime: Date.now()
                        });
                        logger.debug(`[VLS] User ${userId} (${guildId}) added to active voice users map in channel ${newState.channel.name}.`);
                    } else {
                        logger.debug(`[VLS] User ${userId} (${guildId}) joined ineligible channel ${newState.channel.name}. Not adding to active map.`);
                    }
                } catch (err) {
                    logger.error(`[VLS] Error checking channel eligibility for user ${userId} in ${guildId}: ${err.message}`);
                } finally {
                    if (connection) connection.release();
                }
            }
        });

        xpGrantingInterval = setInterval(async () => {
            logger.debug(`[VLS] Running periodic XP grant for ${activeVoiceUsers.size} active voice users.`);
            const currentTime = Date.now();
            const usersToProcess = new Map(activeVoiceUsers);

            for (const [key, userData] of usersToProcess.entries()) {
                const [guildId, userId] = key.split('-');
                const guild = client.guilds.cache.get(guildId);
                const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;

                if (!member || !member.voice.channel || member.voice.channel.id !== userData.channelId || !isUserActiveInVoice({ channel: member.voice.channel, member: member, selfMute: member.voice.selfMute, serverMute: member.voice.serverMute, selfDeaf: member.voice.selfDeaf, serverDeaf: member.voice.serverDeaf }, guild)) {
                    logger.debug(`[VLS] User ${userId} (${guildId}) no longer active during interval check. Removing.`);
                    await grantXPAndSave(userId, guildId, userData.channelId, userData.lastXPCheckTime, currentTime);
                    activeVoiceUsers.delete(key);
                    continue;
                }

                await grantXPAndSave(userId, guildId, userData.channelId, userData.lastXPCheckTime, currentTime);
                userData.lastXPCheckTime = currentTime;
                activeVoiceUsers.set(key, userData);
            }
        }, xp_grant_interval_ms);

        logger.vls('Voice Levels module initialized and operational.');
    },
    shutdown: () => {
        if (xpGrantingInterval) {
            clearInterval(xpGrantingInterval);
            logger.vls('Voice Levels module periodic XP interval cleared.');
        }
    }
};
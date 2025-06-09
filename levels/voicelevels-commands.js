const logger = require('../logger');
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports.commandDefinition = null;
module.exports.commandName = '';

module.exports.init = (config, db_pool) => {
    logger.vls('Voice Levels Commands module initialization requested.');
    const commandConfig = config.voice_levels.command_settings;

    const voiceLevelsCommand = new SlashCommandBuilder()
        .setName(config.commands_deployment.find(cmd => cmd.module_name === 'voice_levels').base_command_name)
        .setDescription(config.commands_deployment.find(cmd => cmd.module_name === 'voice_levels').base_command_description)
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) 
        .addSubcommand(subcommand =>
            subcommand
                .setName(commandConfig.level_subcommand_name)
                .setDescription('Shows your current voice level or another user\'s voice level.')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user whose voice level you want to see.')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName(commandConfig.leaderboard_subcommand_name)
                .setDescription('Shows the voice level leaderboard.')
                .addIntegerOption(option =>
                    option.setName('page')
                        .setDescription('The page number of the leaderboard.')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName(commandConfig.channel_xp_subcommand_name)
                .setDescription('Shows voice XP in a specific channel for a user.')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The voice channel to check XP for.')
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true)
                )
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to check XP for. Defaults to yourself.')
                        .setRequired(false)
                )
        )
        .addSubcommandGroup(group =>
            group
                .setName(commandConfig.colleague_xp_subcommand_name)
                .setDescription('Commands to view voice XP gained with other users.')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName(commandConfig.colleague_xp_pair_subcommand_name)
                        .setDescription('Shows voice XP between two specific users.')
                        .addUserOption(option =>
                            option.setName('user1')
                                .setDescription('The first user.')
                                .setRequired(true)
                        )
                        .addUserOption(option =>
                            option.setName('user2')
                                .setDescription('The second user.')
                                .setRequired(true)
                        )
                )
                .addSubcommand(subcommand =>
                    subcommand
                        .setName(commandConfig.colleague_xp_subcommand_name)
                        .setDescription('Shows your top voice colleagues by XP.')
                        .addUserOption(option =>
                            option.setName('user')
                                .setDescription('The user to see top colleagues for. Defaults to yourself.')
                                .setRequired(false)
                        )
                )
        )
        .addSubcommandGroup(group =>
            group
                .setName(commandConfig.admin_group_name)
                .setDescription('Administrator commands for voice levels.')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName(commandConfig.admin_channel_subcommand_name)
                        .setDescription('Enables or disables voice XP gain for a channel.')
                        .addChannelOption(option =>
                            option.setName('channel')
                                .setDescription('The voice channel to configure.')
                                .addChannelTypes(ChannelType.GuildVoice)
                                .setRequired(true)
                        )
                        .addBooleanOption(option =>
                            option.setName('enabled')
                                .setDescription('Whether to enable or disable XP gain.')
                                .setRequired(true)
                        )
                )
                .addSubcommand(subcommand =>
                    subcommand
                        .setName(commandConfig.admin_toggle_ping_subcommand_name)
                        .setDescription('Toggles level up pings for a user.')
                        .addUserOption(option =>
                            option.setName('user')
                                .setDescription('The user to toggle pings for.')
                                .setRequired(true)
                        )
                )
                .addSubcommand(subcommand =>
                    subcommand
                        .setName(commandConfig.admin_reset_xp_subcommand_name)
                        .setDescription('Resets a user\'s voice XP and level.')
                        .addUserOption(option =>
                            option.setName('user')
                                .setDescription('The user whose XP to reset.')
                                .setRequired(true)
                        )
                )
        );

    module.exports.commandDefinition = voiceLevelsCommand;
    module.exports.commandName = voiceLevelsCommand.name;
    logger.vls(`Voice Levels Commands module initialized. Command name: ${module.exports.commandName}`);
    return module.exports;
};

function replacePlaceholders(text, data) {
    let replacedText = text;
    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            const placeholder = new RegExp(`{${key}}`, 'g');
            replacedText = replacedText.replace(placeholder, data[key]);
        }
    }
    return replacedText;
}

module.exports.handleInteraction = async (interaction, db_pool, config) => {
    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply({ ephemeral: true });

    const { guildId, options } = interaction;
    const commandConfig = config.voice_levels.command_settings;
    const messages = commandConfig.messages;
    const usersTableName = `voicelevels_users_${guildId}`;
    const channelsConfigTableName = `voicelevels_channels_config_${guildId}`;
    const channelXpTableName = `voicelevels_channels_${guildId}`;
    const colleagueXpTableName = `voicelevels_colleagues_${guildId}`;
    let connection;

    try {
        connection = await db_pool.getConnection();

        const calculateXpForLevel = (level) => {
            const formulaString = config.voice_levels.level_up_formula.replace(/{level}/g, level);
            return new Function('level', `return ${formulaString};`)(level);
        };

        const subcommand = options.getSubcommand();
        const subcommandGroup = options.getSubcommandGroup();

        if (subcommandGroup === commandConfig.admin_group_name) {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                await interaction.editReply({ content: messages.not_admin_permission, ephemeral: true });
                return;
            }

            if (subcommand === commandConfig.admin_channel_subcommand_name) {
                const channel = options.getChannel('channel');
                const enabled = options.getBoolean('enabled');

                await connection.query(
                    `INSERT INTO \`${channelsConfigTableName}\` (channel_id, enabled) VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
                    [channel.id, enabled ? 1 : 0]
                );

                const message = enabled ? messages.channel_xp_enabled : messages.channel_xp_disabled;
                await interaction.editReply({ content: message.replace('{channel.name}', channel.name), ephemeral: true });

            } else if (subcommand === commandConfig.admin_toggle_ping_subcommand_name) {
                const user = options.getUser('user');
                const [rows] = await connection.query(`SELECT ping_on_level_up FROM \`${usersTableName}\` WHERE user_id = ?`, [user.id]);
                let newPingState = 1;

                if (rows.length > 0) {
                    newPingState = rows[0].ping_on_level_up === 1 ? 0 : 1;
                    await connection.query(`UPDATE \`${usersTableName}\` SET ping_on_level_up = ? WHERE user_id = ?`, [newPingState, user.id]);
                } else {
                    await connection.query(`INSERT INTO \`${usersTableName}\` (user_id, ping_on_level_up) VALUES (?, ?)`, [user.id, newPingState]);
                }

                const message = newPingState === 1 ? messages.ping_toggled_on : messages.ping_toggled_off;
                await interaction.editReply({ content: message.replace('{user.name}', user.username), ephemeral: true });

            } else if (subcommand === commandConfig.admin_reset_xp_subcommand_name) {
                const user = options.getUser('user');
                await connection.query(`UPDATE \`${usersTableName}\` SET vxpt = 0, ovxpt = 0, vlevel = 0 WHERE user_id = ?`, [user.id]);
                await connection.query(`DELETE FROM \`${channelXpTableName}\` WHERE user_id = ?`, [user.id]);
                await connection.query(`DELETE FROM \`${colleagueXpTableName}\` WHERE user1_id = ? OR user2_id = ?`, [user.id, user.id]);
                await interaction.editReply({ content: messages.xp_reset_success.replace('{user.name}', user.username), ephemeral: true });
            }
            return;
        }

        if (subcommand === commandConfig.level_subcommand_name) {
            const user = options.getUser('user') || interaction.user;
            const [rows] = await connection.query(`SELECT vxpt, vlevel, ovxpt FROM \`${usersTableName}\` WHERE user_id = ?`, [user.id]);

            if (rows.length === 0) {
                await interaction.editReply({ content: messages.user_not_found, ephemeral: true });
                return;
            }

            const userData = rows[0];
            const requiredXp = calculateXpForLevel(userData.vlevel + 1);

            const [rankRows] = await connection.query(
                `SELECT COUNT(*) + 1 AS rank FROM \`${usersTableName}\` WHERE ovxpt > ?`,
                [userData.ovxpt]
            );
            const place = rankRows[0].rank;

            const embedConfig = config.voice_levels.command_embeds.level_info;
            const embedData = {
                'user.id': user.id,
                'user.name': user.username,
                'user.avatar_url': user.displayAvatarURL(),
                'level': userData.vlevel,
                'xp': userData.vxpt,
                'required_xp': requiredXp,
                'ovxpt': userData.ovxpt,
                'place': place,
                'invoker.id': interaction.user.id,
                'time': logger.time_get()
            };

            const levelEmbed = new EmbedBuilder()
                .setTitle(replacePlaceholders(embedConfig.title, embedData))
                .setColor(embedConfig.color)
                .setDescription(replacePlaceholders(embedConfig.description, embedData));

            if (embedConfig.footer_text) {
                levelEmbed.setFooter({
                    text: replacePlaceholders(embedConfig.footer_text, embedData),
                    iconURL: embedConfig.footer_icon_url ? replacePlaceholders(embedConfig.footer_icon_url, embedData) : null
                });
            }

            await interaction.editReply({ embeds: [levelEmbed], ephemeral: true });

        } else if (subcommand === commandConfig.leaderboard_subcommand_name) {
            const page = options.getInteger('page') || 1;
            const limit = 10;
            const offset = (page - 1) * limit;

            const [leaderboardRows] = await connection.query(
                `SELECT user_id, vxpt, vlevel FROM \`${usersTableName}\` ORDER BY ovxpt DESC LIMIT ? OFFSET ?`,
                [limit, offset]
            );

            if (leaderboardRows.length === 0 && page === 1) {
                await interaction.editReply({ content: messages.no_data_found, ephemeral: true });
                return;
            } else if (leaderboardRows.length === 0) {
                await interaction.editReply({ content: messages.no_data_found + ` (Page ${page})`, ephemeral: true });
                return;
            }

            const embedConfig = config.voice_levels.command_embeds.leaderboard;
            const embedData = {
                'page': page,
                'time': logger.time_get()
            };

            const leaderboardEmbed = new EmbedBuilder()
                .setTitle(replacePlaceholders(embedConfig.title, embedData))
                .setColor(embedConfig.color);

            if (embedConfig.footer_text) {
                leaderboardEmbed.setFooter({
                    text: replacePlaceholders(embedConfig.footer_text, embedData),
                    iconURL: embedConfig.footer_icon_url ? replacePlaceholders(embedConfig.footer_icon_url, embedData) : null
                });
            }

            for (let i = 0; i < leaderboardRows.length; i++) {
                const entry = leaderboardRows[i];
                const rank = offset + i + 1;
                const user = await interaction.guild.members.fetch(entry.user_id).catch(() => null);
                const userName = user ? user.user.username : `Unknown User (${entry.user_id})`;
                leaderboardEmbed.addFields({
                    name: replacePlaceholders(messages.leaderboard_entry, {
                        'rank': rank,
                        'user.name': userName,
                        'level': entry.vlevel,
                        'xp': entry.vxpt
                    }),
                    value: '\u200B',
                    inline: false
                });
            }
            await interaction.editReply({ embeds: [leaderboardEmbed], ephemeral: true });
        } else if (subcommand === commandConfig.channel_xp_subcommand_name) {
            const channel = options.getChannel('channel');
            const user = options.getUser('user') || interaction.user;

            const [rows] = await connection.query(
                `SELECT channel_xp FROM \`${channelXpTableName}\` WHERE user_id = ? AND channel_id = ?`,
                [user.id, channel.id]
            );

            const xp = rows.length > 0 ? rows[0].channel_xp : 0;
            const embedConfig = config.voice_levels.command_embeds.channel_xp;
            const embedData = {
                'user.id': user.id,
                'user.name': user.username,
                'user.avatar_url': user.displayAvatarURL(),
                'xp': xp,
                'channel.name': channel.name,
                'invoker.id': interaction.user.id,
                'time': logger.time_get()
            };

            const channelXpEmbed = new EmbedBuilder()
                .setTitle(replacePlaceholders(embedConfig.title, embedData))
                .setColor(embedConfig.color)
                .setDescription(replacePlaceholders(embedConfig.description, embedData));

            if (embedConfig.footer_text) {
                channelXpEmbed.setFooter({
                    text: replacePlaceholders(embedConfig.footer_text, embedData),
                    iconURL: embedConfig.footer_icon_url ? replacePlaceholders(embedConfig.footer_icon_url, embedData) : null
                });
            }
            await interaction.editReply({ embeds: [channelXpEmbed], ephemeral: true });

        } else if (subcommandGroup === commandConfig.colleague_xp_subcommand_name) {
            if (subcommand === commandConfig.colleague_xp_pair_subcommand_name) {
                const user1 = options.getUser('user1');
                const user2 = options.getUser('user2');

                const id1 = user1.id < user2.id ? user1.id : user2.id;
                const id2 = user1.id < user2.id ? user2.id : user1.id;

                const [rows] = await connection.query(
                    `SELECT colleague_xp FROM \`${colleagueXpTableName}\` WHERE user1_id = ? AND user2_id = ?`,
                    [id1, id2]
                );

                const xp = rows.length > 0 ? rows[0].colleague_xp : 0;
                const embedConfig = config.voice_levels.command_embeds.colleague_xp_pair;
                const embedData = {
                    'user1.name': user1.username,
                    'user2.name': user2.username,
                    'xp': xp,
                    'time': logger.time_get()
                };

                const colleaguePairEmbed = new EmbedBuilder()
                    .setTitle(replacePlaceholders(embedConfig.title, embedData))
                    .setColor(embedConfig.color)
                    .setDescription(replacePlaceholders(embedConfig.description, embedData));

                if (embedConfig.footer_text) {
                    colleaguePairEmbed.setFooter({
                        text: replacePlaceholders(embedConfig.footer_text, embedData),
                        iconURL: embedConfig.footer_icon_url ? replacePlaceholders(embedConfig.footer_icon_url, embedData) : null
                    });
                }
                await interaction.editReply({ embeds: [colleaguePairEmbed], ephemeral: true });

            } else if (subcommand === commandConfig.colleague_xp_subcommand_name) {
                const user = options.getUser('user') || interaction.user;
                const limit = 10;

                const [rows] = await connection.query(
                    `SELECT
                        CASE
                            WHEN user1_id = ? THEN user2_id
                            ELSE user1_id
                        END AS colleague_id,
                        colleague_xp
                     FROM \`${colleagueXpTableName}\`
                     WHERE user1_id = ? OR user2_id = ?
                     ORDER BY colleague_xp DESC LIMIT ?`,
                    [user.id, user.id, user.id, limit]
                );

                if (rows.length === 0) {
                    await interaction.editReply({ content: messages.no_data_found, ephemeral: true });
                    return;
                }

                const embedConfig = config.voice_levels.command_embeds.colleague_xp_top;
                const embedData = {
                    'user.id': user.id,
                    'user.name': user.username,
                    'user.avatar_url': user.displayAvatarURL(),
                    'invoker.id': interaction.user.id,
                    'time': logger.time_get()
                };

                const leaderboardEmbed = new EmbedBuilder()
                    .setTitle(replacePlaceholders(embedConfig.title, embedData))
                    .setColor(embedConfig.color);

                if (embedConfig.footer_text) {
                    leaderboardEmbed.setFooter({
                        text: replacePlaceholders(embedConfig.footer_text, embedData),
                        iconURL: embedConfig.footer_icon_url ? replacePlaceholders(embedConfig.footer_icon_url, embedData) : null
                    });
                }

                for (let i = 0; i < rows.length; i++) {
                    const entry = rows[i];
                    const rank = i + 1;
                    const colleagueUser = await interaction.guild.members.fetch(entry.colleague_id).catch(() => null);
                    const colleagueName = colleagueUser ? colleagueUser.user.username : `Unknown User (${entry.colleague_id})`;

                    leaderboardEmbed.addFields({
                        name: replacePlaceholders(messages.colleague_xp_top_entry, {
                            'rank': rank,
                            'colleague.name': colleagueName,
                            'xp': entry.colleague_xp
                        }),
                        value: '\u200B',
                        inline: false
                    });
                }
                await interaction.editReply({ embeds: [leaderboardEmbed], ephemeral: true });
            }
        }

    } catch (error) {
        logger.error(`[VLS-CMD] Error handling voice levels command: ${error.message}`);
        logger.debug(`[VLS-CMD] Stack: ${error.stack}`);
        await interaction.editReply({ content: 'An error occurred while processing your command.', ephemeral: true });
    } finally {
        if (connection) connection.release();
    }
};

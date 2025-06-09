const logger = require('../logger');
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports.commandDefinition = null;
module.exports.commandName = '';

module.exports.init = (config, db_pool) => {
    logger.tls('Text Levels Commands module initialization requested.');
    const commandConfig = config.text_levels.command_settings;

    const textLevelsCommand = new SlashCommandBuilder()
        .setName(config.commands_deployment.find(cmd => cmd.module_name === 'text_levels').base_command_name)
        .setDescription(config.commands_deployment.find(cmd => cmd.module_name === 'text_levels').base_command_description)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName(commandConfig.level_subcommand_name)
                .setDescription('Shows your current text level or another user\'s text level.')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user whose text level you want to see.')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName(commandConfig.leaderboard_subcommand_name)
                .setDescription('Shows the text level leaderboard.')
                .addIntegerOption(option =>
                    option.setName('page')
                        .setDescription('The page number of the leaderboard.')
                        .setRequired(false)
                )
        )
        .addSubcommandGroup(group =>
            group
                .setName(commandConfig.admin_group_name)
                .setDescription('Administrator commands for text levels.')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName(commandConfig.admin_channel_subcommand_name)
                        .setDescription('Enables or disables text XP gain for a channel.')
                        .addChannelOption(option =>
                            option.setName('channel')
                                .setDescription('The text channel to configure.')
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
                        .setDescription('Resets a user\'s text XP and level.')
                        .addUserOption(option =>
                            option.setName('user')
                                .setDescription('The user whose XP to reset.')
                                .setRequired(true)
                        )
                )
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('add_role_reward')
                        .setDescription('Adds a role reward for a specific level.')
                        .addIntegerOption(option =>
                            option.setName('level')
                                .setDescription('The level to assign the role reward to.')
                                .setRequired(true)
                        )
                        .addStringOption(option =>
                            option.setName('role_id')
                                .setDescription('The ID of the role to reward.')
                                .setRequired(true)
                        )
                )
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('remove_role_reward')
                        .setDescription('Removes a role reward from a specific level.')
                        .addIntegerOption(option =>
                            option.setName('level')
                                .setDescription('The level to remove the role reward from.')
                                .setRequired(true)
                        )
                        .addStringOption(option =>
                            option.setName('role_id')
                                .setDescription('The ID of the role to remove.')
                                .setRequired(true)
                        )
                )
        );

    module.exports.commandDefinition = textLevelsCommand;
    module.exports.commandName = textLevelsCommand.name;
    logger.tls(`Text Levels Commands module initialized. Command name: ${module.exports.commandName}`);
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
    const commandConfig = config.text_levels.command_settings;
    const messages = commandConfig.messages;
    const usersTableName = `textlevels_users_${guildId}`;
    const channelsConfigTableName = `textlevels_channels_${guildId}`;
    let connection;

    try {
        logger.debug(`[TLS-CMD] DEBUG: db_pool in handleInteraction: ${db_pool ? 'DEFINED' : 'UNDEFINED'}`);
        connection = await db_pool.getConnection();

        const calculateXpForLevel = (level) => {
            const formulaString = config.text_levels.level_up_formula.replace(/{level}/g, level);
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
                await connection.query(`UPDATE \`${usersTableName}\` SET xpt = 0, ovxpt = 0, tlevel = 0 WHERE user_id = ?`, [user.id]);
                await interaction.editReply({ content: messages.xp_reset_success.replace('{user.name}', user.username), ephemeral: true });
            } else if (subcommand === 'add_role_reward') {
                const level = options.getInteger('level');
                const roleId = options.getString('role_id');

                const newRoleReward = {
                    role_id: roleId,
                    required_level: level
                };

                config.text_levels.role_rewards.level_roles.push(newRoleReward);
                writeConfigToFile(config);

                await interaction.editReply({ content: `Added role reward ${roleId} for level ${level}.`, ephemeral: true });
            } else if (subcommand === 'remove_role_reward') {
                const level = options.getInteger('level');
                const roleId = options.getString('role_id');

                config.text_levels.role_rewards.level_roles = config.text_levels.role_rewards.level_roles.filter(
                    reward => !(reward.role_id === roleId && reward.required_level === level)
                );
                writeConfigToFile(config);

                await interaction.editReply({ content: `Removed role reward ${roleId} for level ${level}.`, ephemeral: true });
            }
            return;
        }

        if (subcommand === commandConfig.level_subcommand_name) {
            const user = options.getUser('user') || interaction.user;
            const [rows] = await connection.query(`SELECT xpt, tlevel, ovxpt FROM \`${usersTableName}\` WHERE user_id = ?`, [user.id]);

            if (rows.length === 0) {
                await interaction.editReply({ content: messages.user_not_found, ephemeral: true });
                return;
            }

            const userData = rows[0];
            const requiredXp = calculateXpForLevel(userData.tlevel + 1);

            const [rankRows] = await connection.query(
                `SELECT COUNT(*) + 1 AS \`rank\` FROM \`${usersTableName}\` WHERE ovxpt > ?`,
                [userData.ovxpt]
            );
            const place = rankRows[0].rank;

            const embedConfig = config.text_levels.command_embeds.level_info;
            const embedData = {
                'user.id': user.id,
                'user.name': user.username,
                'user.avatar_url': user.displayAvatarURL(),
                'level': userData.tlevel,
                'xp': userData.xpt,
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
                `SELECT user_id, xpt, tlevel FROM \`${usersTableName}\` ORDER BY ovxpt DESC LIMIT ? OFFSET ?`,
                [limit, offset]
            );

            if (leaderboardRows.length === 0 && page === 1) {
                await interaction.editReply({ content: messages.no_data_found, ephemeral: true });
                return;
            } else if (leaderboardRows.length === 0) {
                await interaction.editReply({ content: messages.no_data_found + ` (Page ${page})`, ephemeral: true });
                return;
            }

            const embedConfig = config.text_levels.command_embeds.leaderboard;
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

            const fields = [];
            for (let i = 0; i < leaderboardRows.length; i++) {
                const entry = leaderboardRows[i];
                const rank = offset + i + 1;
                const user = await interaction.guild.members.fetch(entry.user_id).catch(() => null);
                const userName = user ? user.user.username : `Unknown User (${entry.user_id})`;
                fields.push({
                    name: replacePlaceholders(messages.leaderboard_entry, {
                        'rank': rank,
                        'user.name': userName,
                        'level': entry.tlevel,
                        'xp': entry.xpt
                    }),
                    value: '\u200B',
                    inline: false
                });
            }
            leaderboardEmbed.addFields(fields);
            await interaction.editReply({ embeds: [leaderboardEmbed], ephemeral: true });
        }

    } catch (error) {
        logger.error(`[TLS-CMD] Error handling text levels command: ${error.message}`);
        logger.debug(`[TLS-CMD] Stack: ${error.stack}`);
        await interaction.editReply({ content: 'An error occurred while processing your command.', ephemeral: true });
    } finally {
        if (connection) connection.release();
    }
};

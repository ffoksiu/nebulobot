const logger = require('../logger');
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Ścieżka do pliku config.json
const CONFIG_FILE_PATH = path.resolve(process.cwd(), 'config.json');

module.exports = {
    commandDefinition: null,
    commandName: '',

    init: (config, db_pool) => {
        logger.admin('Admin Commands module initialization requested.');
        const commandConfig = config.admin.messages;

        const adminCommand = new SlashCommandBuilder()
            .setName(config.commands_deployment.find(cmd => cmd.module_name === 'admin').base_command_name)
            .setDescription(config.commands_deployment.find(cmd => cmd.module_name === 'admin').base_command_description)
            .setDMPermission(false)
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) 
            .addSubcommand(subcommand =>
                subcommand
                    .setName('view')
                    .setDescription('View a specific configuration value.')
                    .addStringOption(option =>
                        option.setName('path')
                            .setDescription('The config path (e.g., main.bot_name, text_levels.enabled)')
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('edit')
                    .setDescription('Edit a specific configuration value.')
                    .addStringOption(option =>
                        option.setName('path')
                            .setDescription('The config path (e.g., main.bot_name, text_levels.enabled)')
                            .setRequired(true)
                    )
                    .addStringOption(option =>
                        option.setName('value')
                            .setDescription('The new value (e.g., "NewBotName", true, 10, {"key":"val"})')
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('reload')
                    .setDescription('Reloads the bot\'s configuration from the config file.')
            );

        this.commandDefinition = adminCommand;
        this.commandName = adminCommand.name;
        logger.admin(`Admin Commands module initialized. Command name: ${this.commandName}`);
    },

    handleInteraction: async (interaction, db_pool, currentConfig) => {
        if (!interaction.isChatInputCommand()) return;

        const adminConfig = currentConfig.admin;
        const messages = adminConfig.messages;

        const hasRolePermission = interaction.member.roles.cache.some(role => adminConfig.config_editor_roles.includes(role.id));
        const hasUserPermission = adminConfig.config_editor_users.includes(interaction.user.id);

        if (!hasRolePermission && !hasUserPermission) {
            await interaction.reply({ content: messages.no_permission, ephemeral: true });
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        const configPath = interaction.options.getString('path');
        const configValue = interaction.options.getString('value');

        const getNestedValue = (obj, pathString) => {
            return pathString.split('.').reduce((acc, part) => acc && acc[part] !== undefined ? acc[part] : undefined, obj);
        };

        const setNestedValue = (obj, pathString, value) => {
            const parts = pathString.split('.');
            let current = obj;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
                    current[parts[i]] = {};
                }
                current = current[parts[i]];
            }
            current[parts[parts.length - 1]] = value;
        };

        if (subcommand === 'view') {
            const value = getNestedValue(currentConfig, configPath);
            if (value !== undefined) {
                let formattedValue = JSON.stringify(value, null, 2);
                await interaction.reply({
                    content: messages.config_view_success
                        .replace('{path}', configPath)
                        .replace('{value}', formattedValue),
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: messages.config_view_not_found.replace('{path}', configPath),
                    ephemeral: true
                });
            }
        } else if (subcommand === 'edit') {
            await interaction.deferReply({ ephemeral: true });
            let parsedValue;
            try {
                parsedValue = JSON.parse(configValue);
            } catch (e) {

                if (configValue.toLowerCase() === 'true') {
                    parsedValue = true;
                } else if (configValue.toLowerCase() === 'false') {
                    parsedValue = false;
                } else if (!isNaN(Number(configValue)) && !isNaN(parseFloat(configValue))) {
                    parsedValue = Number(configValue);
                } else {
                    parsedValue = configValue; 
                }
            }

            try {
                setNestedValue(currentConfig, configPath, parsedValue);
                fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(currentConfig, null, 2), 'utf8');

                const updatedConfigRaw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
                Object.assign(currentConfig, JSON.parse(updatedConfigRaw));

                await interaction.editReply({
                    content: messages.config_edit_success
                        .replace('{path}', configPath)
                        .replace('{value}', JSON.stringify(parsedValue))
                });
                logger.admin(`Config edited: ${configPath} set to ${JSON.stringify(parsedValue)} by ${interaction.user.tag}`);

            } catch (error) {
                logger.error(`[Admin-CMD] Error editing config: ${error.message}`);
                if (error.message.includes('Unexpected token') || error.message.includes('Invalid JSON')) {
                    await interaction.editReply({
                        content: messages.config_edit_fail_parse.replace('{path}', configPath)
                    });
                } else {
                    await interaction.editReply({
                        content: messages.config_edit_fail_write.replace('{error}', error.message)
                    });
                }
            }
        } else if (subcommand === 'reload') {
            await interaction.deferReply({ ephemeral: true });
            try {
                const reloadedConfigRaw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');

                Object.assign(currentConfig, JSON.parse(reloadedConfigRaw));

                await interaction.editReply({ content: messages.config_reload_success });
                logger.admin(`Configuration reloaded by ${interaction.user.tag}`);
            } catch (error) {
                logger.error(`[Admin-CMD] Error reloading config: ${error.message}`);
                await interaction.editReply({
                    content: messages.config_reload_fail.replace('{error}', error.message)
                });
            }
        }
    }
};
const logger = require('../logger');
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports.commandDefinition = null;
module.exports.commandName = '';

module.exports.init = (config, db_pool) => {
    logger.admin('Admin Commands module initialization requested.');
    const adminCmdDeployment = config.commands_deployment.find(cmd => cmd.module_name === 'admin');
    const baseCommandName = adminCmdDeployment ? adminCmdDeployment.base_command_name : 'config';
    const baseCommandDescription = adminCmdDeployment ? adminCmdDeployment.base_command_description : 'Administrator commands for managing bot configuration.';

    const configCommand = new SlashCommandBuilder()
        .setName(baseCommandName)
        .setDescription(baseCommandDescription)
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('reload')
                .setDescription('Reloads the configuration file from disk (updates in-memory config).')
        )
        .addSubcommandGroup(group =>
            group
                .setName('main')
                .setDescription('Configure main bot settings.')
                .addSubcommand(subcommand =>
                    subcommand.setName('menu').setDescription('View and manage main bot settings.')
                )
        )
        .addSubcommandGroup(group =>
            group
                .setName('database')
                .setDescription('Configure database settings.')
                .addSubcommand(subcommand =>
                    subcommand.setName('menu').setDescription('View and manage database settings.')
                )
        )
        .addSubcommandGroup(group =>
            group
                .setName('textlevels')
                .setDescription('Configure text leveling settings.')
                .addSubcommand(subcommand =>
                    subcommand.setName('menu').setDescription('View and manage text level settings.')
                )
        )
        .addSubcommandGroup(group =>
            group
                .setName('voicelevels')
                .setDescription('Configure voice leveling settings.')
                .addSubcommand(subcommand =>
                    subcommand.setName('menu').setDescription('View and manage voice level settings.')
                )
        )
        .addSubcommandGroup(group =>
            group
                .setName('tickets')
                .setDescription('Configure ticket system settings.')
                .addSubcommand(subcommand =>
                    subcommand.setName('menu').setDescription('View and manage ticket system settings.')
                )
        );

    module.exports.commandDefinition = configCommand;
    module.exports.commandName = configCommand.name;
    logger.admin(`Admin Commands module initialized. Command name: ${module.exports.commandName}`);
    return module.exports;
};

module.exports.handleInteraction = async (interaction, db_pool, config) => {
        logger.debug('--- DEBUG: Inside handleInteraction (Admin Commands) ---');
    logger.debug(`Received interaction object: ${interaction ? 'DEFINED' : 'UNDEFINED'}`);
    if (interaction) {
        logger.debug(`Interaction type: ${typeof interaction}`);
        logger.debug(`Interaction isChatInputCommand: ${interaction.isChatInputCommand()}`);
        logger.debug(`Interaction commandName: ${interaction.commandName}`);
        if (interaction.options) { 
            logger.debug(`Interaction subcommandGroup: ${interaction.options.getSubcommandGroup()}`);
        }
    }
    logger.debug('--- END DEBUG: Inside handleInteraction ---');
    if (!interaction.isChatInputCommand()) return;

    const { options } = interaction;
    const subcommand = options.getSubcommand();
    const subcommandGroup = options.getSubcommandGroup();
    const messages = config.admin.messages;

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: messages.no_permission, ephemeral: true });
        return;
    }

    if (subcommand === 'reload') {
        return;
    }

    switch (subcommandGroup) {
        case 'main':
            await sendConfigMenu(interaction, config, 'main', 'Main Bot Settings');
            break;
        case 'database':
            await sendConfigMenu(interaction, config, 'database', 'Database Settings');
            break;
        case 'textlevels':
            await sendConfigMenu(interaction, config, 'text_levels', 'Text Levels Settings');
            break;
        case 'voicelevels':
            await sendConfigMenu(interaction, config, 'voice_levels', 'Voice Levels Settings');
            break;
        case 'tickets':
            await sendTicketsConfigMenu(interaction, config);
            break;
        default:
            await interaction.reply({ content: 'Unknown configuration module.', ephemeral: true });
            break;
    }
};

module.exports.handleConfigInteraction = async (interaction, db_pool, config) => {
    const messages = config.admin.messages;
    const [prefix, module, action, ...args] = interaction.customId.split('_');

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: messages.no_permission, ephemeral: true });
        } else {
            await interaction.reply({ content: messages.no_permission, ephemeral: true });
        }
        return;
    }

    if (interaction.isButton()) {
        switch (`${module}_${action}`) {
            case 'tickets_panel':
                await sendTicketsPanelSetupModal(interaction, config);
                break;
            case 'tickets_responses':
                await sendTicketsResponsesModal(interaction, config);
                break;
            case 'tickets_types':
                await sendTicketTypesMenu(interaction, config);
                break;
            case 'tickets_addtype':
                await sendTicketTypeAddModal(interaction, config);
                break;
            case 'tickets_edittype':
                await handleTicketTypeEditModalSubmit(interaction, config, args[0]);
                break;
            case 'tickets_deletetype':
                await handleTicketTypeDelete(interaction, config, args[0]);
                break;
            case 'tickets_edit_support_roles':
                await sendEditRolesModal(interaction, config, 'support_role_ids');
                break;
            case 'tickets_edit_management_roles':
                await sendEditRolesModal(interaction, config, 'management_role_ids');
                break;
            case 'tickets_edit_admin_ticket_channel_id':
                await sendGenericEditModal(interaction, config, 'tickets', 'admin_ticket_channel_id');
                break;
            case 'tickets_edit_ticket_statuses':
                await sendGenericEditModal(interaction, config, 'tickets', 'ticket_statuses');
                break;
            case 'tickets_backtomain':
                await sendTicketsConfigMenu(interaction, config);
                break;
            default:
                if (action.startsWith('edit_') && args.length === 0) { 
                    const fieldName = action.substring('edit_'.length);
                    await sendGenericEditModal(interaction, config, module, fieldName);
                } else {
                    await interaction.reply({ content: 'Unknown config button action.', ephemeral: true });
                }
                break;
        }
    } else if (interaction.isStringSelectMenu()) {
        if (action === 'edit' && args[0] === 'field') {
            const fieldName = interaction.values[0];
            await sendGenericEditModal(interaction, config, module, fieldName);
        } else {
            await interaction.reply({ content: 'Unknown select menu action.', ephemeral: true });
        }
    } else if (interaction.isModalSubmit()) {
        switch (`${module}_${action}`) {
            case 'tickets_panelsetup':
                await handleTicketsPanelSetupModalSubmit(interaction, config);
                break;
            case 'tickets_responsesedit':
                await handleTicketsResponsesModalSubmit(interaction, config);
                break;
            case 'tickets_typeadd':
                await handleTicketTypeAddModalSubmit(interaction, config);
                break;
            case 'tickets_typeedit':
                await handleTicketTypeEditModalSubmit(interaction, config, args[0]);
                break;
            case 'tickets_editroles': // New case for role editing
                await handleEditRolesModalSubmit(interaction, config, args.join('_'));
                break;
            case 'main_editfield':
            case 'database_editfield':
            case 'text_levels_editfield':
            case 'voice_levels_editfield':
            case 'tickets_editfield': // Added tickets_editfield
                await handleGenericEditModalSubmit(interaction, config, module, args.join('_'));
                break;
            default:
                await interaction.reply({ content: 'Unknown config modal submission.', ephemeral: true });
                break;
        }
    }
};

async function sendConfigMenu(interaction, config, modulePath, title) {
        console.log('--- DEBUG: sendConfigMenu ENTERED ---'); 
    console.log(`DEBUG: interaction passed: ${interaction ? 'DEFINED' : 'UNDEFINED'}`);
    if (!interaction) {
        console.error('CRITICAL ERROR: interaction is UNDEFINED at start of sendConfigMenu!');
        console.error(new Error().stack); 
        return;
    }
    const messages = config.admin.messages;
    const moduleConfig = getNestedProperty(config, modulePath);

    const embed = new EmbedBuilder()
        .setTitle(`⚙️ ${title} Configuration`)
        .setColor('Blurple')
        .setDescription(`Current settings for \`${modulePath}\` module.`);

    let description = '';
    for (const key in moduleConfig) {
        if (Object.prototype.hasOwnProperty.call(moduleConfig, key)) {
            let value = moduleConfig[key];
            if (typeof value === 'object' && value !== null) {
                value = JSON.stringify(value);
                if (value.length > 50) value = value.substring(0, 47) + '...';
            }
            description += `**${key}:** \`${value}\`\n`;
        }
    }
    embed.addFields({ name: 'Current Values', value: description || 'No simple key-value pairs to display.' });

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`config_${modulePath}_edit_field_select`)
        .setPlaceholder('Select a field to edit...')
        .addOptions(
            Object.keys(moduleConfig).map(key => ({
                label: key,
                value: key
            }))
        );

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);

    await (interaction.deferred || interaction.replied ? interaction.editReply.bind(interaction) : interaction.reply.bind(interaction))({
        embeds: [embed],
        components: [selectRow],
        ephemeral: true
    });
}

async function sendGenericEditModal(interaction, config, modulePath, fieldName) {
    const messages = config.admin.messages;
    const modal = new ModalBuilder()
        .setCustomId(`modal_config_${modulePath}_editfield_${fieldName}`)
        .setTitle(`Edit ${modulePath}.${fieldName}`);

    const current_value = getNestedProperty(config, `${modulePath}.${fieldName}`);

    const textInput = new TextInputBuilder()
        .setCustomId('new_value')
        .setLabel(`New value for ${fieldName}`)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setValue(typeof current_value === 'object' ? JSON.stringify(current_value, null, 2) : String(current_value));

    modal.addComponents(new ActionRowBuilder().addComponents(textInput));

    await interaction.showModal(modal);
}

async function handleGenericEditModalSubmit(interaction, config, modulePath, fieldName) {
    const messages = config.admin.messages;
    const newValueString = interaction.fields.getTextInputValue('new_value');

    try {
        let newValue;
        if (newValueString.toLowerCase() === 'true') {
            newValue = true;
        } else if (newValueString.toLowerCase() === 'false') {
            newValue = false;
        } else if (!isNaN(newValueString) && !isNaN(parseFloat(newValueString))) {
            newValue = Number(newValueString);
        } else if (newValueString.startsWith('{') || newValueString.startsWith('[')) {
            try {
                newValue = JSON.parse(newValueString);
            } catch (e) {
                await interaction.reply({ content: messages.config_edit_fail_parse.replace('{path}', `${modulePath}.${fieldName}`), ephemeral: true });
                return;
            }
        } else {
            newValue = newValueString;
        }

        setNestedProperty(config, `${modulePath}.${fieldName}`, newValue);
        writeConfigToFile(config);

        await interaction.reply({ content: messages.config_edit_success.replace('{path}', `${modulePath}.${fieldName}`).replace('{value}', JSON.stringify(newValue)), ephemeral: true });
    } catch (e) {
        logger.error(`Error editing config path ${modulePath}.${fieldName}: ${e.message}`);
        await interaction.reply({ content: messages.config_edit_fail_write.replace('{error}', e.message), ephemeral: true });
    }
}


async function sendTicketsConfigMenu(interaction, config) {
    const ticketsConfig = config.tickets;
    const messages = config.admin.messages;

    const embed = new EmbedBuilder()
        .setTitle('⚙️ Ticket System Configuration')
        .setColor('Blurple')
        .setDescription('Manage various settings for the ticket system.');

    const panelChannel = interaction.guild.channels.cache.get(ticketsConfig.panel_channel_id);
    const ticketCategory = interaction.guild.channels.cache.get(ticketsConfig.ticket_category_id);
    const transcriptsChannel = interaction.guild.channels.cache.get(ticketsConfig.transcripts_channel_id);
    const adminTicketChannel = interaction.guild.channels.cache.get(ticketsConfig.admin_ticket_channel_id);

    embed.addFields(
        { name: 'Panel Setup', value: `Channel: ${panelChannel ? panelChannel.toString() : 'Not Set'}\nCategory: ${ticketCategory ? ticketCategory.name : 'Not Set'}\nTranscripts: ${transcriptsChannel ? transcriptsChannel.toString() : 'Not Set'}`, inline: false },
        { name: 'Channel Naming Template', value: `\`${ticketsConfig.channel_naming_template}\``, inline: true },
        { name: 'Support Roles', value: ticketsConfig.support_role_ids.map(id => `<@&${id}>`).join(', ') || 'None', inline: true },
        { name: 'Management Roles', value: ticketsConfig.management_role_ids.map(id => `<@&${id}>`).join(', ') || 'None', inline: true },
        { name: 'Total Ticket Types', value: `${ticketsConfig.ticket_types.length}`, inline: true },
        { name: 'Close Confirmation Timeout', value: `${ticketsConfig.close_confirmation_timeout_seconds} seconds`, inline: true },
        { name: 'Admin Ticket Channel', value: adminTicketChannel ? adminTicketChannel.toString() : 'Not Set', inline: true }
    );

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('config_tickets_panel')
                .setLabel('Panel Setup')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('config_tickets_responses')
                .setLabel('Edit Responses')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('config_tickets_types')
                .setLabel('Manage Ticket Types')
                .setStyle(ButtonStyle.Primary)
        );
    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('config_tickets_edit_support_roles')
                .setLabel('Edit Support Roles')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('config_tickets_edit_management_roles')
                .setLabel('Edit Management Roles')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('config_tickets_edit_channel_naming_template')
                .setLabel('Edit Naming Template')
                .setStyle(ButtonStyle.Secondary)
        );
    const row3 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('config_tickets_edit_close_confirmation_timeout_seconds')
                .setLabel('Edit Close Timeout')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('config_tickets_edit_admin_ticket_channel_id')
                .setLabel('Edit Admin Ticket Channel')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('config_tickets_edit_ticket_statuses')
                .setLabel('Edit Ticket Statuses')
                .setStyle(ButtonStyle.Secondary)
        );

    await (interaction.deferred || interaction.replied ? interaction.editReply : interaction.reply)({
        embeds: [embed],
        components: [row1, row2, row3],
        ephemeral: true
    });
}

async function sendTicketsPanelSetupModal(interaction, config) {
    const ticketsConfig = config.tickets;
    const modal = new ModalBuilder()
        .setCustomId('modal_config_tickets_panelsetup')
        .setTitle('Ticket Panel Setup');

    const panelChannelIdInput = new TextInputBuilder()
        .setCustomId('panel_channel_id')
        .setLabel('Panel Channel ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(ticketsConfig.panel_channel_id || '');

    const categoryIdInput = new TextInputBuilder()
        .setCustomId('ticket_category_id')
        .setLabel('Ticket Category ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(ticketsConfig.ticket_category_id || '');

    const transcriptsChannelIdInput = new TextInputBuilder()
        .setCustomId('transcripts_channel_id')
        .setLabel('Transcripts Channel ID (Optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(ticketsConfig.transcripts_channel_id || '');

    modal.addComponents(
        new ActionRowBuilder().addComponents(panelChannelIdInput),
        new ActionRowBuilder().addComponents(categoryIdInput),
        new ActionRowBuilder().addComponents(transcriptsChannelIdInput)
    );

    await interaction.showModal(modal);
}

async function handleTicketsPanelSetupModalSubmit(interaction, config) {
    const messages = config.admin.messages;
    const panelChannelId = interaction.fields.getTextInputValue('panel_channel_id');
    const categoryId = interaction.fields.getTextInputValue('ticket_category_id');
    const transcriptsChannelId = interaction.fields.getTextInputValue('transcripts_channel_id');

    try {
        config.tickets.panel_channel_id = panelChannelId;
        config.tickets.ticket_category_id = categoryId;
        config.tickets.transcripts_channel_id = transcriptsChannelId || null;
        writeConfigToFile(config);

        await interaction.reply({ content: 'Ticket panel settings updated. Use `/ticket setup` command to update the panel message itself.', ephemeral: true });
    } catch (e) {
        logger.error(`Error updating ticket panel setup: ${e.message}`);
        await interaction.reply({ content: messages.config_edit_fail_write.replace('{error}', e.message), ephemeral: true });
    }
}

async function sendTicketsResponsesModal(interaction, config) {
    const ticketsConfig = config.tickets;
    const modal = new ModalBuilder()
        .setCustomId('modal_config_tickets_responsesedit')
        .setTitle('Edit Ticket Responses');

    const fields = [
        { id: 'ticket_panel_embed_title', label: 'Panel Embed Title', style: TextInputStyle.Short },
        { id: 'ticket_panel_embed_description', label: 'Panel Embed Description', style: TextInputStyle.Paragraph },
        { id: 'ticket_opened_success', label: 'Ticket Opened Success', style: TextInputStyle.Short },
        { id: 'ticket_already_open', label: 'Ticket Already Open', style: TextInputStyle.Short },
        { id: 'ticket_channel_initial_message_content', label: 'Initial Message Content', style: TextInputStyle.Paragraph },
    ];

    for (const field of fields) {
        const input = new TextInputBuilder()
            .setCustomId(field.id)
            .setLabel(field.label)
            .setStyle(field.style)
            .setRequired(false)
            .setValue(ticketsConfig.messages[field.id] || '');
        modal.addComponents(new ActionRowBuilder().addComponents(input));
    }

    await interaction.showModal(modal);
}

async function handleTicketsResponsesModalSubmit(interaction, config) {
    const messages = config.admin.messages;
    try {
        const fields = [
            'ticket_panel_embed_title', 'ticket_panel_embed_description', 'ticket_opened_success',
            'ticket_already_open', 'ticket_channel_initial_message_content'
        ];
        
        for (const fieldId of fields) {
            const value = interaction.fields.getTextInputValue(fieldId);
            if (value !== null) {
                config.tickets.messages[fieldId] = value;
            }
        }
        writeConfigToFile(config);
        await interaction.reply({ content: 'Ticket response messages updated. Some changes may require bot restart.', ephemeral: true });
    } catch (e) {
        logger.error(`Error updating ticket responses: ${e.message}`);
        await interaction.reply({ content: messages.config_edit_fail_write.replace('{error}', e.message), ephemeral: true });
    }
}

async function sendTicketTypesMenu(interaction, config) {
    const ticketsConfig = config.tickets;
    const messages = config.admin.messages;

    const embed = new EmbedBuilder()
        .setTitle('⚙️ Manage Ticket Types')
        .setColor('Blurple')
        .setDescription('Select a ticket type to edit or add a new one.');

    const buttons = [];
    ticketsConfig.ticket_types.forEach(type => {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`config_tickets_edittype_${type.id}`)
                .setLabel(`${type.name} (${type.id})`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(type.emoji || '📄')
        );
    });

    const actionRows = [];
    let currentRow = new ActionRowBuilder();
    for (const button of buttons) {
        if (currentRow.components.length < 5) {
            currentRow.addComponents(button);
        } else {
            actionRows.push(currentRow);
            currentRow = new ActionRowBuilder().addComponents(button);
        }
    }
    if (currentRow.components.length > 0) {
        actionRows.push(currentRow);
    }

    const addRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('config_tickets_addtype')
                .setLabel('Add New Ticket Type')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('config_tickets_backtomain')
                .setLabel('Back to Tickets Config')
                .setStyle(ButtonStyle.Danger)
        );
    actionRows.push(addRow);

    await (interaction.deferred || interaction.replied ? interaction.editReply : interaction.reply)({
        embeds: [embed],
        components: actionRows,
        ephemeral: true
    });
}

async function sendTicketTypeAddModal(interaction, config) {
    const modal = new ModalBuilder()
        .setCustomId('modal_config_tickets_typeadd')
        .setTitle('Add New Ticket Type');

    const idInput = new TextInputBuilder().setCustomId('id').setLabel('Type ID (Short, Unique)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10);
    const nameInput = new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true);
    const emojiInput = new TextInputBuilder().setCustomId('emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(false);
    const buttonStyleInput = new TextInputBuilder().setCustomId('button_style').setLabel('Button Style (Primary, Secondary, Success, Danger)').setStyle(TextInputStyle.Short).setRequired(true).setValue('Primary');
    const defaultPriorityInput = new TextInputBuilder().setCustomId('default_priority').setLabel('Default Priority (Low, Medium, High, Critical)').setStyle(TextInputStyle.Short).setRequired(true).setValue('Medium');

    modal.addComponents(
        new ActionRowBuilder().addComponents(idInput),
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(emojiInput),
        new ActionRowBuilder().addComponents(buttonStyleInput),
        new ActionRowBuilder().addComponents(defaultPriorityInput)
    );

    await interaction.showModal(modal);
}

async function handleTicketTypeAddModalSubmit(interaction, config) {
    const messages = config.admin.messages;
    const newType = {
        id: interaction.fields.getTextInputValue('id').toUpperCase(),
        name: interaction.fields.getTextInputValue('name'),
        emoji: interaction.fields.getTextInputValue('emoji') || '',
        button_style: interaction.fields.getTextInputValue('button_style'),
        is_restricted: false,
        default_priority: interaction.fields.getTextInputValue('default_priority'),
        modal_fields: []
    };

    if (!['Primary', 'Secondary', 'Success', 'Danger'].includes(newType.button_style)) {
        await interaction.reply({ content: 'Invalid button style. Must be Primary, Secondary, Success, or Danger.', ephemeral: true });
        return;
    }
    if (!['Low', 'Medium', 'High', 'Critical'].includes(newType.default_priority)) {
        await interaction.reply({ content: 'Invalid default priority. Must be Low, Medium, High, or Critical.', ephemeral: true });
        return;
    }
    if (config.tickets.ticket_types.some(type => type.id === newType.id)) {
        await interaction.reply({ content: `Ticket type with ID \`${newType.id}\` already exists.`, ephemeral: true });
        return;
    }

    try {
        config.tickets.ticket_types.push(newType);
        writeConfigToFile(config);
        await interaction.reply({ content: `Ticket type \`${newType.name}\` (${newType.id}) added.`, ephemeral: true });
        await sendTicketTypesMenu(interaction, config);
    } catch (e) {
        logger.error(`Error adding ticket type: ${e.message}`);
        await interaction.reply({ content: messages.config_edit_fail_write.replace('{error}', e.message), ephemeral: true });
    }
}

async function sendTicketTypeEditModal(interaction, config, typeId) {
    const ticketsConfig = config.tickets;
    const typeToEdit = ticketsConfig.ticket_types.find(type => type.id === typeId);

    if (!typeToEdit) {
        await interaction.reply({ content: 'Ticket type not found.', ephemeral: true });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId(`modal_config_tickets_typeedit_${typeId}`)
        .setTitle(`Edit Ticket Type: ${typeToEdit.name}`);

    const nameInput = new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true).setValue(typeToEdit.name);
    const emojiInput = new TextInputBuilder().setCustomId('emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(false).setValue(typeToEdit.emoji || '');
    const buttonStyleInput = new TextInputBuilder().setCustomId('button_style').setLabel('Button Style (Primary, Secondary, Success, Danger)').setStyle(TextInputStyle.Short).setRequired(true).setValue(typeToEdit.button_style);
    const isRestrictedInput = new TextInputBuilder().setCustomId('is_restricted').setLabel('Is Restricted (true/false)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(typeToEdit.is_restricted));
    const defaultPriorityInput = new TextInputBuilder().setCustomId('default_priority').setLabel('Default Priority (Low, Medium, High, Critical)').setStyle(TextInputStyle.Short).setRequired(true).setValue(typeToEdit.default_priority);
    const modalFieldsInput = new TextInputBuilder().setCustomId('modal_fields').setLabel('Modal Fields (JSON array)').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(JSON.stringify(typeToEdit.modal_fields, null, 2));

    modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(emojiInput),
        new ActionRowBuilder().addComponents(buttonStyleInput),
        new ActionRowBuilder().addComponents(isRestrictedInput),
        new ActionRowBuilder().addComponents(defaultPriorityInput),
        new ActionRowBuilder().addComponents(modalFieldsInput)
    );

    await interaction.showModal(modal);
}

async function handleTicketTypeEditModalSubmit(interaction, config, typeId) {
    const messages = config.admin.messages;
    const typeIndex = config.tickets.ticket_types.findIndex(type => type.id === typeId);

    if (typeIndex === -1) {
        await interaction.reply({ content: 'Ticket type not found.', ephemeral: true });
        return;
    }

    try {
        const updatedName = interaction.fields.getTextInputValue('name');
        const updatedEmoji = interaction.fields.getTextInputValue('emoji');
        const updatedButtonStyle = interaction.fields.getTextInputValue('button_style');
        const updatedIsRestricted = interaction.fields.getTextInputValue('is_restricted').toLowerCase() === 'true';
        const updatedDefaultPriority = interaction.fields.getTextInputValue('default_priority');
        const updatedModalFieldsStr = interaction.fields.getTextInputValue('modal_fields');

        if (!['Primary', 'Secondary', 'Success', 'Danger'].includes(updatedButtonStyle)) {
            await interaction.reply({ content: 'Invalid button style. Must be Primary, Secondary, Success, or Danger.', ephemeral: true });
        }
        if (!['Low', 'Medium', 'High', 'Critical'].includes(updatedDefaultPriority)) {
            await interaction.reply({ content: 'Invalid default priority. Must be Low, Medium, High, or Critical.', ephemeral: true });
            return;
        }

        let updatedModalFields = [];
        if (updatedModalFieldsStr) {
            try {
                updatedModalFields = JSON.parse(updatedModalFieldsStr);
            } catch (e) {
                await interaction.reply({ content: 'Invalid JSON for modal fields. Please check syntax.', ephemeral: true });
                return;
            }
        }

        config.tickets.ticket_types[typeIndex] = {
            ...config.tickets.ticket_types[typeIndex],
            name: updatedName,
            emoji: updatedEmoji,
            button_style: updatedButtonStyle,
            is_restricted: updatedIsRestricted,
            default_priority: updatedDefaultPriority,
            modal_fields: updatedModalFields
        };

        writeConfigToFile(config);
        await interaction.reply({ content: `Ticket type \`${updatedName}\` (${typeId}) updated.`, ephemeral: true });
        await sendTicketTypesMenu(interaction, config);
    } catch (e) {
        logger.error(`Error updating ticket type ${typeId}: ${e.message}`);
        await interaction.reply({ content: messages.config_edit_fail_write.replace('{error}', e.message), ephemeral: true });
    }
}

async function handleTicketTypeDelete(interaction, config, typeId) {
    const messages = config.admin.messages;
    const typeIndex = config.tickets.ticket_types.findIndex(type => type.id === typeId);

    if (typeIndex === -1) {
        await interaction.reply({ content: 'Ticket type not found.', ephemeral: true });
        return;
    }

    try {
        const deletedType = config.tickets.ticket_types.splice(typeIndex, 1);
        writeConfigToFile(config);
        await interaction.reply({ content: `Ticket type \`${deletedType[0].name}\` (${typeId}) deleted.`, ephemeral: true });
        await sendTicketTypesMenu(interaction, config);
    } catch (e) {
        logger.error(`Error deleting ticket type ${typeId}: ${e.message}`);
        await interaction.reply({ content: messages.config_edit_fail_write.replace('{error}', e.message), ephemeral: true });
    }
}


function getNestedProperty(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

function setNestedProperty(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]] || typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
}

function writeConfigToFile(config) {
    const configFilePath = path.resolve(process.cwd(), 'config.json');
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf8');
}

async function sendEditRolesModal(interaction, config, fieldName) {
    const messages = config.admin.messages;
    const modal = new ModalBuilder()
        .setCustomId(`modal_config_tickets_editroles_${fieldName}`)
        .setTitle(`Edit Ticket ${fieldName.replace('_', ' ').replace('ids', 'IDs')}`);

    const current_value = getNestedProperty(config.tickets, fieldName);

    const textInput = new TextInputBuilder()
        .setCustomId('new_value')
        .setLabel(`Comma-separated Role IDs for ${fieldName.replace('_', ' ')}`)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue(Array.isArray(current_value) ? current_value.join(', ') : '');

    modal.addComponents(new ActionRowBuilder().addComponents(textInput));

    await interaction.showModal(modal);
}
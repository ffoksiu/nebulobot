const logger = require('../logger');
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField } = require('discord.js'); 
const ticketsModule = require('./tickets'); 

module.exports = {
    commandDefinition: null,
    commandName: '', 

    init: (config, db_pool) => {
        logger.tickets('Tickets Commands module initialization requested.');

        const ticketCommand = new SlashCommandBuilder()
            .setName(config.commands_deployment.find(cmd => cmd.module_name === 'tickets').base_command_name)
            .setDescription(config.commands_deployment.find(cmd => cmd.module_name === 'tickets').base_command_description)
            .setDMPermission(false)
            .addSubcommand(subcommand =>
                subcommand
                    .setName('close')
                    .setDescription('Initiates closing of the current ticket channel. Requires confirmation.')
                    .addStringOption(option =>
                        option.setName('reason')
                            .setDescription('Reason for closing the ticket.')
                            .setRequired(false)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Adds a user to the current ticket channel.')
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('The user to add to the ticket.')
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('remove')
                    .setDescription('Removes a user from the current ticket channel.')
                    .addUserOption(option =>
                        option.setName('user')
                            .setDescription('The user to remove from the ticket.')
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('priority')
                    .setDescription('Sets the priority of the current ticket.')
                    .addStringOption(option =>
                        option.setName('level')
                            .setDescription('The priority level.')
                            .setRequired(true)
                            .addChoices(
                                { name: 'Low', value: 'Low' },
                                { name: 'Medium', value: 'Medium' },
                                { name: 'High', value: 'High' },
                                { name: 'Critical', value: 'Critical' }
                            )
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('status')
                    .setDescription('Sets the status of the current ticket.')
                    .addStringOption(option =>
                        option.setName('new_status')
                            .setDescription('The new status for the ticket.')
                            .setRequired(true)
                            .addChoices(
                                { name: '🟢 Open', value: 'Open' },
                                { name: '🟡 Waiting For Creator', value: 'WaitingForCreator' },
                                { name: '🟠 Awaiting Response', value: 'AwaitingResponse' },
                                { name: '🟣 Escalated', value: 'Escalated' }
                            )
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('claim')
                    .setDescription('Claims the current ticket, indicating you are handling it.')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('unclaim')
                    .setDescription('Unclaims the current ticket, indicating it is no longer being handled by you.')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('info')
                    .setDescription('Shows information about the current ticket.')
            )
            .addSubcommandGroup(group =>
                group
                    .setName('admin')
                    .setDescription('Administrator commands for ticket system setup.')
                    .addSubcommand(subcommand =>
                        subcommand
                            .setName('setup_panel')
                            .setDescription('Sets up the ticket creation panel.')
                            .addChannelOption(option =>
                                option.setName('panel_channel')
                                    .setDescription('The channel where the ticket panel will be.')
                                    .addChannelTypes(ChannelType.GuildText)
                                    .setRequired(true)
                            )
                            .addChannelOption(option =>
                                option.setName('ticket_category')
                                    .setDescription('The category where new ticket channels will be created.')
                                    .addChannelTypes(ChannelType.GuildCategory)
                                    .setRequired(true)
                            )
                            .addChannelOption(option =>
                                option.setName('transcripts_channel')
                                    .setDescription('Channel where ticket transcripts will be sent.')
                                    .addChannelTypes(ChannelType.GuildText)
                                    .setRequired(false)
                            )
                    )
            );

        this.commandDefinition = ticketCommand;
        this.commandName = ticketCommand.name;
        logger.tickets(`Tickets Commands module initialized. Command name: ${this.commandName}`);
        
        return this;
    },

    handleInteraction: async (interaction, db_pool, config) => {
        if (!interaction.isChatInputCommand()) return; 

        const ticketsConfig = config.tickets;
        const messages = ticketsConfig.messages;
        const guildId = interaction.guildId;
        const channelId = interaction.channelId;
        const userId = interaction.user.id;
        const member = interaction.member;

        const isSupport = member.roles.cache.some(role => ticketsConfig.support_role_ids.includes(role.id));
        const isManagement = member.permissions.has(PermissionsBitField.Flags.Administrator) || member.roles.cache.some(role => ticketsConfig.management_role_ids.includes(role.id));
        const isTicketChannel = ticketsModule.activeTickets.has(channelId);
        const ticketData = ticketsModule.activeTickets.get(channelId);
        const isTicketCreator = ticketData && ticketData.userId === userId;

        const subcommand = interaction.options.getSubcommand();
        const subcommandGroup = interaction.options.getSubcommandGroup();

        if (subcommandGroup === 'admin') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await interaction.reply({ content: messages.not_admin_permission, ephemeral: true });
                return;
            }

            if (subcommand === 'setup_panel') {
                const panelChannel = interaction.options.getChannel('panel_channel');
                const ticketCategory = interaction.options.getChannel('ticket_category');
                const transcriptsChannel = interaction.options.getChannel('transcripts_channel');
                
                const result = await ticketsModule.setupTicketPanel(
                    interaction.client,
                    guildId,
                    panelChannel.id,
                    ticketCategory.id,
                    transcriptsChannel ? transcriptsChannel.id : null,
                    db_pool,
                    config
                );

                await interaction.reply({ content: result.message, ephemeral: true });
            }
            return;
        }

        const allowedInTicket = (isSupport || isTicketCreator || isManagement) && isTicketChannel;
        const allowedForStaff = (isSupport || isManagement) && isTicketChannel;

        if (subcommand === 'close') {
            if (!allowedInTicket) {
                await interaction.reply({ content: messages.ticket_no_permission, ephemeral: true });
                return;
            }
            if (!isTicketChannel) {
                await interaction.reply({ content: messages.ticket_not_ticket_channel, ephemeral: true });
                return;
            }

            const reason = interaction.options.getString('reason') || 'No reason provided';
            
            const creator = await interaction.guild.members.fetch(ticketData.userId);

            if (isTicketCreator || isManagement) {
                await interaction.deferReply({ ephemeral: false });
                const result = await ticketsModule.closeTicket(guildId, channelId, userId, reason, db_pool, config); 
                if (result.success) {
                    await interaction.editReply({ content: result.message });
                } else {
                    await interaction.editReply({ content: result.message });
                }
                return;
            }

            const confirmButton = new ButtonBuilder()
                .setCustomId(`close_ticket_confirm_${channelId}`)
                .setLabel(messages.ticket_closed_confirmation_button_label)
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder().addComponents(confirmButton);

            const confirmMessage = await interaction.reply({
                content: messages.ticket_closed_confirmation_prompt
                    .replace('{closer_ping}', interaction.user.toString())
                    .replace('{creator_ping}', creator.toString())
                    .replace('{creator.username}', creator.user.username),
                components: [row],
                ephemeral: false,
                fetchReply: true
            });

            const timeoutId = setTimeout(async () => {
                if (ticketsModule.pendingCloseConfirmations.has(channelId)) {
                    ticketsModule.pendingCloseConfirmations.delete(channelId);
                    try {
                        await confirmMessage.edit({ content: messages.ticket_close_timeout, components: [] });
                    } catch (e) {
                        logger.warn(`[Tickets] Could not edit timeout message for ticket ${channelId}: ${e.message}`);
                    }
                }
            }, config.tickets.close_confirmation_timeout_seconds * 1000);

            ticketsModule.pendingCloseConfirmations.set(channelId, { interaction: confirmMessage, closerId: userId, timeout: timeoutId, reason: reason });
            logger.debug(`[Tickets] Close confirmation initiated for ticket ${channelId} by ${member.user.tag}.`);

        } else if (subcommand === 'add') {
            if (!allowedForStaff) {
                await interaction.reply({ content: messages.ticket_no_permission, ephemeral: true });
                return;
            }
            const userToAdd = interaction.options.getUser('user');
            await interaction.deferReply({ ephemeral: false });

            const result = await ticketsModule.addMemberToTicket(guildId, channelId, userToAdd.id, userId, db_pool, config);
            await interaction.editReply({ content: result.message });

        } else if (subcommand === 'remove') {
            if (!allowedForStaff) {
                await interaction.reply({ content: messages.ticket_no_permission, ephemeral: true });
                return;
            }
            const userToRemove = interaction.options.getUser('user');
            await interaction.deferReply({ ephemeral: false });

            const result = await ticketsModule.removeMemberFromTicket(guildId, channelId, userToRemove.id, userId, db_pool, config);
            await interaction.editReply({ content: result.message });

        } else if (subcommand === 'priority') {
            if (!allowedForStaff) { 
                await interaction.reply({ content: messages.ticket_no_permission, ephemeral: true });
                return;
            }
            const priorityLevel = interaction.options.getString('level');
            await interaction.deferReply({ ephemeral: false });

            const result = await ticketsModule.setTicketPriority(guildId, channelId, priorityLevel, userId, db_pool, config);
            await interaction.editReply({ content: result.message });

        } else if (subcommand === 'status') {
            if (!allowedForStaff) { 
                await interaction.reply({ content: messages.ticket_no_permission, ephemeral: true });
                return;
            }
            const newStatus = interaction.options.getString('new_status');
            await interaction.deferReply({ ephemeral: false });

            const result = await ticketsModule.setTicketStatus(guildId, channelId, newStatus, userId, db_pool, config);
            await interaction.editReply({ content: result.message });

        } else if (subcommand === 'claim') {
            if (!allowedForStaff) {
                await interaction.reply({ content: messages.ticket_no_permission, ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: false });

            const result = await ticketsModule.claimTicket(guildId, channelId, userId, db_pool, config);
            await interaction.editReply({ content: result.message });

        } else if (subcommand === 'unclaim') {
            if (!allowedForStaff) {
                await interaction.reply({ content: messages.ticket_no_permission, ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: false });

            const result = await ticketsModule.unclaimTicket(guildId, channelId, userId, db_pool, config);
            await interaction.editReply({ content: result.message });

        } else if (subcommand === 'info') {
            if (!allowedInTicket) {
                await interaction.reply({ content: messages.ticket_no_permission, ephemeral: true });
                return;
            }
            await interaction.deferReply({ ephemeral: true });

            const result = await ticketsModule.getTicketInfo(guildId, channelId, db_pool, config);
            if (result.success) {
                await interaction.editReply({ embeds: [result.embed] });
            } else {
                await interaction.editReply({ content: result.message });
            }
        }
    }
};
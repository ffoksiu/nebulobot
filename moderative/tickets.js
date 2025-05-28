const logger = require('../logger');
const { ChannelType, PermissionsBitField, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const activeTickets = new Map();
const pendingCloseConfirmations = new Map(); 

function generateHtmlTranscript(ticketData, messages, guild, creator, closer, claimedBy, transcriptMessages) {
    const ticketType = guild.client.config.tickets.ticket_types.find(type => type.id === ticketData.ticket_type_id);
    const statusInfo = guild.client.config.tickets.ticket_statuses[ticketData.status];
    const header = messages.ticket_transcript_header
        .replace('{ticket_id}', ticketData.ticket_id)
        .replace('{ticket_type_name}', ticketType ? ticketType.name : 'Unknown')
        .replace('{creator.username}', creator.user.username)
        .replace('{closer.username}', closer ? closer.user.username : 'N/A')
        .replace('{open_time}', new Date(ticketData.opened_at).toLocaleString())
        .replace('{close_time}', new Date().toLocaleString())
        .replace('{priority}', ticketData.priority)
        .replace('{status_name}', statusInfo ? statusInfo.emoji + ' ' + ticketData.status : ticketData.status)
        .replace('{claimer.username}', claimedBy ? claimedBy.user.username : 'Unclaimed');

    let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Ticket Transcript - ${ticketData.ticket_id}</title>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; background-color: #36393F; color: #DCDEE0; }
            .container { max-width: 800px; margin: 20px auto; background-color: #313338; border-radius: 8px; padding: 20px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2); }
            .header { border-bottom: 1px solid #4F545C; padding-bottom: 10px; margin-bottom: 20px; }
            .message { margin-bottom: 15px; display: flex; }
            .message-avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 10px; }
            .message-content { flex-grow: 1; }
            .message-author { font-weight: bold; color: #5865F2; }
            .message-timestamp { font-size: 0.8em; color: #A3A6AA; margin-left: 10px; }
            .message-text { margin-top: 5px; word-wrap: break-word; }
            pre { background-color: #2F3136; padding: 10px; border-radius: 5px; overflow-x: auto; }
            a { color: #00B0F4; text-decoration: none; }
            a:hover { text-decoration: underline; }
            .embed { border-left: 4px solid #4F545C; background-color: #2F3136; padding: 10px; margin-top: 5px; border-radius: 4px; }
            .embed-title { font-weight: bold; margin-bottom: 5px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>${header}</h1>
            </div>
            <div class="transcript-body">
    `;

    for (const msg of transcriptMessages) {
        const author = msg.author.username;
        const avatar = msg.author.displayAvatarURL({ format: 'png', size: 64 });
        const timestamp = msg.createdAt.toLocaleString();
        const content = msg.content.replace(/</g, '<').replace(/>/g, '>').replace(/\n/g, '<br>');

        htmlContent += `
        <div class="message">
            <img class="message-avatar" src="${avatar}" alt="${author}">
            <div class="message-content">
                <span class="message-author">${author}</span>
                <span class="message-timestamp">${timestamp}</span>
                <div class="message-text">${content}</div>
        `;
        
        if (msg.attachments.size > 0) {
            msg.attachments.forEach(attachment => {
                htmlContent += `<div class="message-text">Attachment: <a href="${attachment.url}" target="_blank">${attachment.name}</a></div>`;
            });
        }
        if (msg.embeds.length > 0) {
            msg.embeds.forEach(embed => {
                htmlContent += `<div class="embed">`;
                if (embed.title) htmlContent += `<div class="embed-title">${embed.title}</div>`;
                if (embed.description) htmlContent += `<div class="message-text">${embed.description}</div>`;
                htmlContent += `</div>`;
            });
        }
        htmlContent += `
            </div>
        </div>
        `;
    }

    htmlContent += `
            </div>
        </div>
    </body>
    </html>
    `;
    return htmlContent;
}


module.exports = {
    activeTickets,
    pendingCloseConfirmations, 

    init: async (client, config, db_pool) => {
        logger.tickets('Tickets module initialization requested.');
        if (!config.tickets || !config.tickets.enabled) {
            logger.tickets('Module disabled in config. Skipping initialization.');
            return;
        }
        if (!db_pool) {
            logger.error('[Tickets] Database connection not available. Tickets module cannot be initialized.');
            return;
        }
        logger.tickets('Initializing Tickets module...');

        client.config = config; 

        const ticketsConfig = config.tickets;

        client.guilds.cache.forEach(async guild => {
            const tickets_config_table_name = `tickets_config_${guild.id}`;
            const tickets_active_table_name = `tickets_active_${guild.id}`;
            
            let connection;
            try {
                connection = await db_pool.getConnection();

                await connection.query(`
                    CREATE TABLE IF NOT EXISTS \`${tickets_config_table_name}\` (
                        guild_id VARCHAR(20) PRIMARY KEY,
                        panel_channel_id VARCHAR(20),
                        panel_message_id VARCHAR(20),
                        ticket_category_id VARCHAR(20),
                        support_role_ids JSON,
                        management_role_ids JSON,
                        transcripts_channel_id VARCHAR(20),
                        channel_naming_template VARCHAR(255)
                    );
                `);
                logger.debug(`[Tickets] Ensured table '${tickets_config_table_name}' exists for guild ${guild.name} (${guild.id}).`);

                await connection.query(`
                    CREATE TABLE IF NOT EXISTS \`${tickets_active_table_name}\` (
                        ticket_id INT AUTO_INCREMENT PRIMARY KEY,
                        channel_id VARCHAR(20) NOT NULL UNIQUE,
                        creator_id VARCHAR(20) NOT NULL,
                        opened_at DATETIME NOT NULL,
                        status VARCHAR(20) NOT NULL DEFAULT 'Open',
                        closed_at DATETIME,
                        priority VARCHAR(20) DEFAULT 'Medium',
                        ticket_type_id VARCHAR(10),
                        modal_data JSON,
                        claimed_by_id VARCHAR(20)
                    );
                `);
                logger.debug(`[Tickets] Ensured table '${tickets_active_table_name}' exists for guild ${guild.name} (${guild.id}).`);

                const [activeRows] = await connection.query(`SELECT channel_id, creator_id, ticket_id, opened_at, priority, ticket_type_id, modal_data, status, claimed_by_id FROM \`${tickets_active_table_name}\` WHERE status != 'Closed'`);
                for (const row of activeRows) {
                    activeTickets.set(row.channel_id, {
                        guildId: guild.id,
                        userId: row.creator_id,
                        ticketId: row.ticket_id,
                        openedAt: new Date(row.opened_at),
                        priority: row.priority,
                        typeId: row.ticket_type_id,
                        modalData: row.modal_data,
                        status: row.status,
                        claimedBy: row.claimed_by_id
                    });
                    logger.debug(`[Tickets] Loaded active ticket ${row.ticket_id} for channel ${row.channel_id} (Status: ${row.status}).`);
                }

            } catch (err) {
                logger.error(`[Tickets] Failed to create tables or load active tickets for guild ${guild.name} (${guild.id}): ${err.message}`);
            } finally {
                if (connection) connection.release();
            }
        });

        client.on('interactionCreate', async interaction => {
            if (!interaction.isButton()) return;

            const guild = interaction.guild;
            const user = interaction.user;
            const member = interaction.member;
            const messages = ticketsConfig.messages;

            const ticketType = ticketsConfig.ticket_types.find(type => `open_ticket_button_${type.id}` === interaction.customId);
            if (ticketType) {
                if (ticketType.is_restricted) {
                    const hasManagementRole = member.roles.cache.some(role => ticketsConfig.management_role_ids.includes(role.id));
                    if (!hasManagementRole) {
                        await interaction.reply({ content: messages.ticket_no_permission, ephemeral: true });
                        return;
                    }
                }

                let connection;
                try {
                    connection = await db_pool.getConnection();
                    const tickets_active_table_name = `tickets_active_${guild.id}`;

                    const [existingTicketRows] = await connection.query(
                        `SELECT channel_id FROM \`${tickets_active_table_name}\` WHERE creator_id = ? AND status != 'Closed'`,
                        [user.id]
                    );
                    if (existingTicketRows.length > 0) {
                        const existingChannel = guild.channels.cache.get(existingTicketRows[0].channel_id);
                        if (existingChannel) {
                            await interaction.reply({ content: messages.ticket_already_open.replace('{channel}', existingChannel.toString()), ephemeral: true });
                            return;
                        } else {
                            await connection.query(`UPDATE \`${tickets_active_table_name}\` SET status = 'Closed' WHERE channel_id = ?`, [existingTicketRows[0].channel_id]);
                        }
                    }

                    const modal = new ModalBuilder()
                        .setCustomId(`ticket_modal_${ticketType.id}`)
                        .setTitle(`${ticketType.name} Ticket`);

                    const textInputs = ticketType.modal_fields.map(field => {
                        return new TextInputBuilder()
                            .setCustomId(field.custom_id)
                            .setLabel(field.label)
                            .setStyle(TextInputStyle[field.style])
                            .setRequired(field.required)
                            .setMinLength(field.min_length || 0)
                            .setMaxLength(field.max_length || 2000);
                    });

                    textInputs.forEach(input => modal.addComponents(new ActionRowBuilder().addComponents(input)));

                    await interaction.showModal(modal);
                    logger.debug(`[Tickets] Modal shown for ticket type ${ticketType.id} to ${user.tag}.`);

                } catch (error) {
                    logger.error(`[Tickets] Error showing modal for ticket type ${ticketType.id}: ${error.message}`);
                    await interaction.reply({ content: 'An error occurred. Please try again later.', ephemeral: true });
                } finally {
                    if (connection) connection.release();
                }
                return;
            }

            if (interaction.customId.startsWith('close_ticket_confirm_')) {
                const ticketChannelId = interaction.customId.replace('close_ticket_confirm_', '');
                const confirmationData = pendingCloseConfirmations.get(ticketChannelId);

                if (!confirmationData || confirmationData.interaction.id !== interaction.message.id) {
                    await interaction.reply({ content: "This close request is no longer valid or has timed out.", ephemeral: true });
                    return;
                }

                const ticketData = activeTickets.get(ticketChannelId);
                if (!ticketData) {
                    await interaction.reply({ content: messages.ticket_not_ticket_channel, ephemeral: true });
                    return;
                }

                const isCreator = ticketData.userId === user.id;
                const isManagement = member.permissions.has(PermissionsBitField.Flags.Administrator) || member.roles.cache.some(role => ticketsConfig.management_role_ids.includes(role.id));

                if (!isCreator && !isManagement) {
                    await interaction.reply({ content: messages.ticket_close_access_denied, ephemeral: true });
                    return;
                }

                const result = await module.exports.closeTicket(guild.id, ticketChannelId, confirmationData.closerId, db_pool, config);
                if (result.success) {
                    await interaction.update({ content: result.message, components: [] });
                } else {
                    await interaction.update({ content: result.message, components: [] });
                }
                clearTimeout(confirmationData.timeout);
                pendingCloseConfirmations.delete(ticketChannelId);
                logger.tickets(`Ticket ${ticketData.ticketId} close confirmed by ${user.tag}.`);
                return;
            }
        });

        client.on('interactionCreate', async interaction => {
            if (!interaction.isModalSubmit()) return;

            const guild = interaction.guild;
            const user = interaction.user;
            const messages = ticketsConfig.messages;

            if (!interaction.customId.startsWith('ticket_modal_')) return;
            const ticketTypeId = interaction.customId.replace('ticket_modal_', '');
            const ticketType = ticketsConfig.ticket_types.find(type => type.id === ticketTypeId);

            if (!ticketType) {
                await interaction.reply({ content: "An invalid ticket type was submitted. Please contact an administrator.", ephemeral: true });
                return;
            }

            let connection;
            try {
                connection = await db_pool.getConnection();
                const tickets_config_table_name = `tickets_config_${guild.id}`;
                const tickets_active_table_name = `tickets_active_${guild.id}`;

                const [configRows] = await connection.query(`SELECT * FROM \`${tickets_config_table_name}\` WHERE guild_id = ?`, [guild.id]);
                const guildConfig = configRows[0];

                if (!guildConfig || !guildConfig.ticket_category_id) {
                    await interaction.reply({ content: "Ticket system not fully configured by an administrator. Please contact server staff.", ephemeral: true });
                    return;
                }

                const modalData = {};
                let modalDataEmbedFields = '';
                for (const field of ticketType.modal_fields) {
                    const value = interaction.fields.getTextInputValue(field.custom_id);
                    modalData[field.custom_id] = value;
                    modalDataEmbedFields += `**${field.label}:**\n${value}\n`;
                }

                const initialStatus = 'Open';
                const statusEmoji = ticketsConfig.ticket_statuses[initialStatus]?.emoji || '';
                const channelNameTemplate = ticketsConfig.channel_naming_template || '{status_emoji}-{type_id}-{username}-{user_id}';
                const channelName = channelNameTemplate
                    .replace('{status_emoji}', statusEmoji)
                    .replace('{type_id}', ticketType.id)
                    .replace('{username}', user.username)
                    .replace('{user_id}', user.id)
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, '-')
                    .replace(/-{2,}/g, '-')
                    .substring(0, 100);

                const ticketChannel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: guildConfig.ticket_category_id,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionsBitField.Flags.ViewChannel],
                        },
                        {
                            id: user.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                        },
                        ...(ticketsConfig.support_role_ids || []).map(roleId => ({
                            id: roleId,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels],
                        })),
                    ],
                });

                const [insertResult] = await connection.query(
                    `INSERT INTO \`${tickets_active_table_name}\` (channel_id, creator_id, opened_at, priority, ticket_type_id, modal_data, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [ticketChannel.id, user.id, new Date(), ticketType.default_priority, ticketType.id, JSON.stringify(modalData), initialStatus]
                );
                const ticketId = insertResult.insertId;

                activeTickets.set(ticketChannel.id, {
                    guildId: guild.id,
                    userId: user.id,
                    ticketId: ticketId,
                    openedAt: new Date(),
                    priority: ticketType.default_priority,
                    typeId: ticketType.id,
                    modalData: modalData,
                    status: initialStatus,
                    claimedBy: null
                });

                const pingRoles = (ticketsConfig.support_role_ids || []).map(roleId => `<@&${roleId}>`).join(' ') + ' ';
                const creatorPing = user.toString();
                const statusName = initialStatus;

                const initialMessageContent = messages.ticket_channel_initial_message_content
                    .replace('{ping_roles}', pingRoles.trim())
                    .replace('{creator_ping}', creatorPing)
                    .replace('{ticket_type_name}', ticketType.name)
                    .replace('{priority}', ticketType.default_priority)
                    .replace('{status_name}', statusName)
                    .replace('{modal_data_embed_fields}', modalDataEmbedFields);

                await ticketChannel.send({
                    content: initialMessageContent,
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(`Ticket ${ticketId} - ${ticketType.name}`)
                            .setDescription(`Hello ${user}, a staff member will be with you shortly.`)
                            .setColor(ticketsConfig.ticket_statuses[initialStatus]?.color || 'Blurple')
                            .setFooter({ text: `Ticket ID: ${ticketId} | Type: ${ticketType.name}` })
                    ]
                });

                await interaction.reply({ content: messages.ticket_opened_success.replace('{channel}', ticketChannel.toString()), ephemeral: true });
                logger.tickets(`Ticket ${ticketId} (${ticketType.id}) opened by ${user.tag} in channel ${ticketChannel.name}.`);

            } catch (error) {
                logger.error(`[Tickets] Error creating ticket from modal for user ${user.id}: ${error.message}`);
                logger.debug(`[Tickets] Stack: ${error.stack}`);
                await interaction.reply({ content: 'An error occurred while processing your ticket. Please try again later.', ephemeral: true });
            } finally {
                if (connection) connection.release();
            }
        });

        client.on('channelDelete', async channel => {
            if (!activeTickets.has(channel.id)) return;

            const ticketData = activeTickets.get(channel.id);
            const guild = client.guilds.cache.get(ticketData.guildId);
            if (!guild) return;

            let connection;
            try {
                connection = await db_pool.getConnection();
                const tickets_active_table_name = `tickets_active_${guild.id}`;
                await connection.query(`UPDATE \`${tickets_active_table_name}\` SET status = 'Closed', closed_at = ? WHERE channel_id = ?`, [new Date(), channel.id]);
                activeTickets.delete(channel.id);
                logger.tickets(`Ticket ${ticketData.ticketId} for channel ${channel.name} marked as closed due to channel deletion.`);
            } catch (error) {
                logger.error(`[Tickets] Error marking ticket ${ticketData.ticketId} as closed on channelDelete: ${error.message}`);
            } finally {
                if (connection) connection.release();
            }
        });

        logger.tickets('Tickets module initialized and operational.');
    },

    closeTicket: async (guildId, channelId, closerId, db_pool, config) => {
        const messages = config.tickets.messages;
        const tickets_active_table_name = `tickets_active_${guildId}`;
        const tickets_config_table_name = `tickets_config_${guildId}`;
        let connection;
        try {
            connection = await db_pool.getConnection();
            const [ticketRows] = await connection.query(`SELECT * FROM \`${tickets_active_table_name}\` WHERE channel_id = ? AND status != 'Closed'`, [channelId]);

            if (ticketRows.length === 0) return { success: false, message: messages.ticket_not_ticket_channel };

            const ticketData = ticketRows[0];
            const guild = await client.guilds.fetch(guildId);
            const ticketChannel = guild.channels.cache.get(channelId);
            const closer = await guild.members.fetch(closerId);
            const creator = await guild.members.fetch(ticketData.creator_id);
            const claimedBy = ticketData.claimed_by_id ? await guild.members.fetch(ticketData.claimed_by_id) : null;
            const ticketType = config.tickets.ticket_types.find(type => type.id === ticketData.ticket_type_id);

            const [configRows] = await connection.query(`SELECT transcripts_channel_id FROM \`${tickets_config_table_name}\` WHERE guild_id = ?`, [guildId]);
            const transcriptsChannelId = configRows[0]?.transcripts_channel_id;
            const transcriptsChannel = transcriptsChannelId ? guild.channels.cache.get(transcriptsChannelId) : null;

            let transcriptContent = '';
            if (ticketChannel) {
                const fetchedMessages = await ticketChannel.messages.fetch({ limit: 200 }); // Fetch more messages for transcript
                const sortedMessages = [...fetchedMessages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
                
                transcriptContent = generateHtmlTranscript(ticketData, messages, guild, creator, closer, claimedBy, sortedMessages);
            }

            if (transcriptsChannel) {
                const attachment = Buffer.from(transcriptContent, 'utf8');
                await transcriptsChannel.send({
                    files: [{ attachment: attachment, name: `ticket-${ticketData.ticket_id}-transcript.html` }],
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(`Ticket #${ticketData.ticket_id} Closed (${ticketType ? ticketType.name : 'Unknown Type'})`)
                            .setDescription(`Created by ${creator.toString()} | Closed by ${closer.toString()}${claimedBy ? ` | Claimed by ${claimedBy.toString()}` : ''}`)
                            .setColor('Green')
                            .setFooter({ text: `Ticket ID: ${ticketData.ticket_id}` })
                    ]
                });
            }

            await connection.query(`UPDATE \`${tickets_active_table_name}\` SET status = 'Closed', closed_at = ?, claimed_by_id = NULL WHERE channel_id = ?`, [new Date(), channelId]);
            activeTickets.delete(channelId);

            if (ticketChannel) await ticketChannel.delete();

            let replyMessage = messages.ticket_closed_success
                .replace('{channel}', `#${ticketChannel.name}`)
                .replace('{closer.username}', closer.user.username);
            if (transcriptsChannel) {
                replyMessage = replyMessage.replace('{transcript_channel}', transcriptsChannel.toString());
            } else {
                replyMessage = messages.ticket_closed_no_transcript
                    .replace('{channel}', `#${ticketChannel.name}`)
                    .replace('{closer.username}', closer.user.username);
            }

            logger.tickets(`Ticket ${ticketData.ticket_id} closed by ${closer.user.tag}.`);
            return { success: true, message: replyMessage };

        } catch (error) {
            logger.error(`[Tickets] Error closing ticket ${channelId}: ${error.message}`);
            return { success: false, message: `An error occurred while closing the ticket: ${error.message}` };
        } finally {
            if (connection) connection.release();
        }
    },

    addMemberToTicket: async (guildId, channelId, userIdToAdd, moderatorId, db_pool, config) => {
        const messages = config.tickets.messages;
        let connection;
        try {
            connection = await db_pool.getConnection();
            const guild = await client.guilds.fetch(guildId);
            const ticketChannel = guild.channels.cache.get(channelId);
            const userToAdd = await guild.members.fetch(userIdToAdd);
            const moderator = await guild.members.fetch(moderatorId);

            if (!ticketChannel) return { success: false, message: messages.ticket_not_ticket_channel };
            if (ticketChannel.permissionsFor(userToAdd).has(PermissionsBitField.Flags.ViewChannel)) {
                return { success: false, message: messages.ticket_member_already_in_ticket.replace('{user}', userToAdd.user.username) };
            }

            await ticketChannel.permissionOverwrites.edit(userToAdd, {
                ViewChannel: true,
                SendMessages: true,
            });
            logger.tickets(`User ${userToAdd.user.tag} added to ticket channel ${channelId} by ${moderator.user.tag}.`);
            return { success: true, message: messages.ticket_add_member_success.replace('{user}', userToAdd.toString()).replace('{moderator}', moderator.user.username) };

        } catch (error) {
            logger.error(`[Tickets] Error adding member to ticket ${channelId}: ${error.message}`);
            return { success: false, message: `An error occurred while adding the member: ${error.message}` };
        } finally {
            if (connection) connection.release();
        }
    },

    removeMemberFromTicket: async (guildId, channelId, userIdToRemove, moderatorId, db_pool, config) => {
        const messages = config.tickets.messages;
        let connection;
        try {
            connection = await db_pool.getConnection();
            const guild = await client.guilds.fetch(guildId);
            const ticketChannel = guild.channels.cache.get(channelId);
            const userToRemove = await guild.members.fetch(userIdToRemove);
            const moderator = await guild.members.fetch(moderatorId);

            if (!ticketChannel) return { success: false, message: messages.ticket_not_ticket_channel };
            if (!ticketChannel.permissionsFor(userToRemove).has(PermissionsBitField.Flags.ViewChannel)) {
                return { success: false, message: messages.ticket_member_not_in_ticket.replace('{user}', userToRemove.user.username) };
            }

            await ticketChannel.permissionOverwrites.delete(userToRemove);
            logger.tickets(`User ${userToRemove.user.tag} removed from ticket channel ${channelId} by ${moderator.user.tag}.`);
            return { success: true, message: messages.ticket_remove_member_success.replace('{user}', userToRemove.toString()).replace('{moderator}', moderator.user.username) };

        } catch (error) {
            logger.error(`[Tickets] Error removing member from ticket ${channelId}: ${error.message}`);
            return { success: false, message: `An error occurred while removing the member: ${error.message}` };
        } finally {
            if (connection) connection.release();
        }
    },

    setTicketPriority: async (guildId, channelId, priority, moderatorId, db_pool, config) => {
        const messages = config.tickets.messages;
        const validPriorities = ['Low', 'Medium', 'High', 'Critical'];
        if (!validPriorities.includes(priority)) {
            return { success: false, message: messages.ticket_priority_invalid };
        }

        const tickets_active_table_name = `tickets_active_${guildId}`;
        let connection;
        try {
            connection = await db_pool.getConnection();
            const [updateResult] = await connection.query(
                `UPDATE \`${tickets_active_table_name}\` SET priority = ? WHERE channel_id = ? AND status != 'Closed'`,
                [priority, channelId]
            );

            if (updateResult.affectedRows === 0) return { success: false, message: messages.ticket_not_ticket_channel };

            const guild = await client.guilds.fetch(guildId);
            const moderator = await guild.members.fetch(moderatorId);
            const ticketChannel = guild.channels.cache.get(channelId);
            logger.tickets(`Ticket ${channelId} priority set to ${priority} by ${moderator.user.tag}.`);
            
            const ticketData = activeTickets.get(channelId);
            if (ticketData) {
                ticketData.priority = priority;
                activeTickets.set(channelId, ticketData);
            }

            return { success: true, message: messages.ticket_priority_set.replace('{priority}', priority).replace('{moderator}', moderator.user.username) };

        } catch (error) {
            logger.error(`[Tickets] Error setting ticket priority for ${channelId}: ${error.message}`);
            return { success: false, message: `An error occurred while setting priority: ${error.message}` };
        } finally {
            if (connection) connection.release();
        }
    },

    setTicketStatus: async (guildId, channelId, newStatus, setterId, db_pool, config) => {
        const messages = config.tickets.messages;
        const validStatuses = Object.keys(config.tickets.ticket_statuses).filter(s => s !== 'Closed'); // Don't allow setting to Closed via this command
        if (!validStatuses.includes(newStatus)) {
            return { success: false, message: messages.ticket_status_invalid };
        }

        const tickets_active_table_name = `tickets_active_${guildId}`;
        let connection;
        try {
            connection = await db_pool.getConnection();
            const [updateResult] = await connection.query(
                `UPDATE \`${tickets_active_table_name}\` SET status = ? WHERE channel_id = ? AND status != 'Closed'`,
                [newStatus, channelId]
            );

            if (updateResult.affectedRows === 0) return { success: false, message: messages.ticket_not_ticket_channel };

            const guild = await client.guilds.fetch(guildId);
            const setter = await guild.members.fetch(setterId);
            const ticketChannel = guild.channels.cache.get(channelId);

            const ticketData = activeTickets.get(channelId);
            if (ticketData) {
                ticketData.status = newStatus;
                activeTickets.set(channelId, ticketData);
            }
            
            const statusEmoji = config.tickets.ticket_statuses[newStatus]?.emoji || '';
            const channelNameTemplate = config.tickets.channel_naming_template || '{status_emoji}-{type_id}-{username}-{user_id}';
            const oldName = ticketChannel.name;
            const newName = channelNameTemplate
                .replace('{status_emoji}', statusEmoji)
                .replace('{type_id}', ticketData.typeId)
                .replace('{username}', ticketChannel.name.split('-').pop()) // simplified way to get username part
                .replace('{user_id}', ticketData.userId)
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '-')
                .replace(/-{2,}/g, '-')
                .substring(0, 100);
            
            if (newName !== oldName) {
                await ticketChannel.setName(newName);
            }

            logger.tickets(`Ticket ${channelId} status set to ${newStatus} by ${setter.user.tag}.`);
            return { success: true, message: messages.ticket_status_set.replace('{status_name}', newStatus).replace('{setter.username}', setter.user.username) };

        } catch (error) {
            logger.error(`[Tickets] Error setting ticket status for ${channelId}: ${error.message}`);
            return { success: false, message: `An error occurred while setting status: ${error.message}` };
        } finally {
            if (connection) connection.release();
        }
    },

    claimTicket: async (guildId, channelId, claimerId, db_pool, config) => {
        const messages = config.tickets.messages;
        const tickets_active_table_name = `tickets_active_${guildId}`;
        let connection;
        try {
            connection = await db_pool.getConnection();
            const [ticketRows] = await connection.query(`SELECT claimed_by_id FROM \`${tickets_active_table_name}\` WHERE channel_id = ? AND status != 'Closed'`, [channelId]);

            if (ticketRows.length === 0) return { success: false, message: messages.ticket_not_ticket_channel };
            if (ticketRows[0].claimed_by_id) {
                const existingClaimer = await guild.members.fetch(ticketRows[0].claimed_by_id);
                return { success: false, message: messages.ticket_already_claimed.replace('{claimer.username}', existingClaimer.user.username) };
            }

            await connection.query(
                `UPDATE \`${tickets_active_table_name}\` SET claimed_by_id = ? WHERE channel_id = ?`,
                [claimerId, channelId]
            );

            const guild = await client.guilds.fetch(guildId);
            const claimer = await guild.members.fetch(claimerId);
            const ticketChannel = guild.channels.cache.get(channelId);
            
            const ticketData = activeTickets.get(channelId);
            if (ticketData) {
                ticketData.claimedBy = claimerId;
                activeTickets.set(channelId, ticketData);
            }

            logger.tickets(`Ticket ${channelId} claimed by ${claimer.user.tag}.`);
            return { success: true, message: messages.ticket_claimed.replace('{claimer.username}', claimer.user.username) };

        } catch (error) {
            logger.error(`[Tickets] Error claiming ticket ${channelId}: ${error.message}`);
            return { success: false, message: `An error occurred while claiming the ticket: ${error.message}` };
        } finally {
            if (connection) connection.release();
        }
    },

    unclaimTicket: async (guildId, channelId, unclaimerId, db_pool, config) => {
        const messages = config.tickets.messages;
        const tickets_active_table_name = `tickets_active_${guildId}`;
        let connection;
        try {
            connection = await db_pool.getConnection();
            const [ticketRows] = await connection.query(`SELECT claimed_by_id FROM \`${tickets_active_table_name}\` WHERE channel_id = ? AND status != 'Closed'`, [channelId]);

            if (ticketRows.length === 0) return { success: false, message: messages.ticket_not_ticket_channel };
            if (!ticketRows[0].claimed_by_id) {
                return { success: false, message: messages.ticket_not_claimed };
            }

            await connection.query(
                `UPDATE \`${tickets_active_table_name}\` SET claimed_by_id = NULL WHERE channel_id = ?`,
                [channelId]
            );

            const guild = await client.guilds.fetch(guildId);
            const unclaimer = await guild.members.fetch(unclaimerId);
            const ticketChannel = guild.channels.cache.get(channelId);

            const ticketData = activeTickets.get(channelId);
            if (ticketData) {
                ticketData.claimedBy = null;
                activeTickets.set(channelId, ticketData);
            }

            logger.tickets(`Ticket ${channelId} unclaimed by ${unclaimer.user.tag}.`);
            return { success: true, message: messages.ticket_unclaimed.replace('{unclaimer.username}', unclaimer.user.username) };

        } catch (error) {
            logger.error(`[Tickets] Error unclaiming ticket ${channelId}: ${error.message}`);
            return { success: false, message: `An error occurred while unclaiming the ticket: ${error.message}` };
        } finally {
            if (connection) connection.release();
        }
    },

    getTicketInfo: async (guildId, channelId, db_pool, config) => {
        const messages = config.tickets.messages;
        const tickets_active_table_name = `tickets_active_${guildId}`;
        let connection;
        try {
            connection = await db_pool.getConnection();
            const [ticketRows] = await connection.query(`SELECT * FROM \`${tickets_active_table_name}\` WHERE channel_id = ?`, [channelId]);

            if (ticketRows.length === 0) return { success: false, message: messages.ticket_not_ticket_channel };

            const ticketData = ticketRows[0];
            const guild = await client.guilds.fetch(guildId);
            const creator = await guild.members.fetch(ticketData.creator_id);
            const ticketChannel = guild.channels.cache.get(channelId);
            const ticketType = config.tickets.ticket_types.find(type => type.id === ticketData.ticket_type_id);
            const claimedBy = ticketData.claimed_by_id ? await guild.members.fetch(ticketData.claimed_by_id) : null;
            const statusInfo = config.tickets.ticket_statuses[ticketData.status];
            const statusName = statusInfo ? `${statusInfo.emoji} ${ticketData.status}` : ticketData.status;


            const modalDataFields = ticketData.modal_data ?
                Object.entries(ticketData.modal_data)
                      .map(([key, value]) => {
                          const fieldConfig = ticketType?.modal_fields.find(f => f.custom_id === key);
                          const label = fieldConfig ? fieldConfig.label : key;
                          return `**${label}:**\n${value}`;
                      }).join('\n')
                : 'No additional details.';

            const embed = new EmbedBuilder()
                .setTitle(messages.ticket_info_embed_title.replace('{ticket_id}', ticketData.ticket_id))
                .setDescription(messages.ticket_info_embed_description
                    .replace('{creator.username}', creator.user.username)
                    .replace('{ticket_type_name}', ticketType ? ticketType.name : 'Unknown')
                    .replace('{status_name}', statusName)
                    .replace('{priority}', ticketData.priority)
                    .replace('{claimer.username}', claimedBy ? claimedBy.user.username : 'N/A')
                    .replace('{open_time}', new Date(ticketData.opened_at).toLocaleString())
                    .replace('{channel}', ticketChannel.toString())
                )
                .addFields({ name: 'Submission Details', value: modalDataFields })
                .setColor(statusInfo?.color || 'Blue')
                .setFooter({ text: `Ticket ID: ${ticketData.ticket_id} | Type: ${ticketType ? ticketType.name : 'Unknown'}` });

            return { success: true, embed: embed };

        } catch (error) {
            logger.error(`[Tickets] Error getting ticket info for ${channelId}: ${error.message}`);
            return { success: false, message: `An error occurred while fetching ticket info: ${error.message}` };
        } finally {
            if (connection) connection.release();
        }
    },

    setupTicketPanel: async (guildId, panelChannelId, categoryId, transcriptsChannelId, db_pool, config) => {
        const messages = config.tickets.messages;
        const tickets_config_table_name = `tickets_config_${guildId}`;
        let connection;
        try {
            connection = await db_pool.getConnection();
            const guild = await client.guilds.fetch(guildId);
            const panelChannel = guild.channels.cache.get(panelChannelId);
            if (!panelChannel || panelChannel.type !== ChannelType.GuildText) {
                return { success: false, message: "Invalid panel channel provided. Must be a text channel." };
            }
            const categoryChannel = guild.channels.cache.get(categoryId);
            if (!categoryChannel || categoryChannel.type !== ChannelType.GuildCategory) {
                return { success: false, message: "Invalid category channel provided. Must be a category." };
            }
            if (transcriptsChannelId) {
                 const transChannel = guild.channels.cache.get(transcriptsChannelId);
                 if (!transChannel || transChannel.type !== ChannelType.GuildText) {
                    return { success: false, message: "Invalid transcripts channel provided. Must be a text channel." };
                 }
            }

            await connection.query(
                `INSERT INTO \`${tickets_config_table_name}\` (guild_id, panel_channel_id, ticket_category_id, support_role_ids, management_role_ids, transcripts_channel_id, channel_naming_template)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE panel_channel_id = VALUES(panel_channel_id), ticket_category_id = VALUES(ticket_category_id), support_role_ids = VALUES(support_role_ids), management_role_ids = VALUES(management_role_ids), transcripts_channel_id = VALUES(transcripts_channel_id), channel_naming_template = VALUES(channel_naming_template)`,
                [
                    guildId,
                    panelChannelId,
                    categoryId,
                    JSON.stringify(config.tickets.support_role_ids || []),
                    JSON.stringify(config.tickets.management_role_ids || []),
                    transcriptsChannelId,
                    config.tickets.channel_naming_template
                ]
            );

            const actionRows = [];
            let currentRow = new ActionRowBuilder();

            for (const ticketType of config.tickets.ticket_types) {
                const button = new ButtonBuilder()
                    .setCustomId(`open_ticket_button_${ticketType.id}`)
                    .setLabel(ticketType.name)
                    .setStyle(ButtonStyle[ticketType.button_style])
                    .setEmoji(ticketType.emoji);

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

            const panelEmbed = new EmbedBuilder()
                .setTitle(messages.ticket_panel_embed_title)
                .setDescription(messages.ticket_panel_embed_description)
                .setColor('Green');

            const [configRows] = await connection.query(`SELECT panel_message_id FROM \`${tickets_config_table_name}\` WHERE guild_id = ?`, [guildId]);
            const existingPanelMessageId = configRows[0]?.panel_message_id;

            let panelMessage;
            if (existingPanelMessageId) {
                try {
                    panelMessage = await panelChannel.messages.fetch(existingPanelMessageId);
                    await panelMessage.edit({ embeds: [panelEmbed], components: actionRows });
                    logger.tickets(`Updated existing ticket panel in ${panelChannel.name}.`);
                } catch (e) {
                    logger.warn(`[Tickets] Could not find existing panel message ${existingPanelMessageId}. Sending a new one.`);
                    panelMessage = await panelChannel.send({ embeds: [panelEmbed], components: actionRows });
                }
            } else {
                panelMessage = await panelChannel.send({ embeds: [panelEmbed], components: actionRows });
            }

            await connection.query(`UPDATE \`${tickets_config_table_name}\` SET panel_message_id = ? WHERE guild_id = ?`, [panelMessage.id, guildId]);

            logger.tickets(`Ticket panel set up for guild ${guild.name} in ${panelChannel.name}.`);
            return { success: true, message: messages.setup_panel_success.replace('{channel}', panelChannel.toString()) };

        } catch (error) {
            logger.error(`[Tickets] Error setting up ticket panel for guild ${guildId}: ${error.message}`);
            return { success: false, message: `An error occurred while setting up the ticket panel: ${error.message}` };
        } finally {
            if (connection) connection.release();
        }
    },
    
    shutdown: () => {
        logger.tickets('Tickets module shutdown initiated.');
        for (const [channelId, data] of pendingCloseConfirmations.entries()) {
            clearTimeout(data.timeout);
            pendingCloseConfirmations.delete(channelId);
            logger.debug(`Cleared pending close confirmation for ticket ${channelId}.`);
        }
        logger.tickets('Tickets module shutdown complete.');
    }
};
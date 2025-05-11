module.exports = {
    name: 'guildDelete',
    execute(client, guild, ...args) {
        const helpers = args[args.length - 1];
        const { config, log, isProtectedServer, removedServers, saveRemovedServers } = helpers;
        
        log(`Guild remove event: ${guild.name} (${guild.id})`, 'debug');
        
        // Check if this is already in our guildMemberRemove handler (kick)
        // If the bot was kicked, the BotKick handler would have already processed it
        // This prevents duplicate notifications for the same event
        if (removedServers[guild.id] && removedServers[guild.id].reason === 'kicked') {
            log(`Already processed this server removal as a kick`, 'debug', guild.id);
            return;
        }
        
        // Now we know this is a genuine guild leave event (server deleted or bot left)
        log(`Bot removed from server: ${guild.name} (${guild.id})`, 'warning');
        
        // Check if this server is in our protected list
        const isProtected = isProtectedServer(guild.id);
        
        if (isProtected) {
            log(`⚠️ WARNING: BOT REMOVED FROM PROTECTED SERVER: ${guild.name} (${guild.id})`, 'critical');
            
            // Track this server in the removed servers list
            removedServers[guild.id] = {
                name: guild.name,
                id: guild.id,
                timestamp: Date.now(),
                reason: 'left',
                wasProtected: true,
                memberCount: guild.memberCount,
                ownerTag: guild.ownerId
            };
            
            // Persist the removed servers list
            saveRemovedServers(helpers);
            
            // Send notification to owners
            notifyOwnersAboutServerRemoval(client, guild, helpers);
        } else {
            // Not a protected server, just log it
            log(`Bot removed from non-protected server: ${guild.name}`, 'info');
            
            // Still track it but mark as non-protected
            removedServers[guild.id] = {
                name: guild.name,
                id: guild.id,
                timestamp: Date.now(),
                reason: 'left',
                wasProtected: false
            };
            
            // Persist the removed servers list
            saveRemovedServers(helpers);
        }
    }
};

/**
 * Send notifications to all owners that the bot was removed from a protected server
 * @param {Client} client - Discord client
 * @param {Guild} guild - The guild the bot was removed from
 * @param {Object} helpers - Helper functions
 */
async function notifyOwnersAboutServerRemoval(client, guild, helpers) {
    const { config, log } = helpers;
    
    // Construct a detailed message
    const message = [
        `⚠️ **ALERT: Bot Removed from Protected Server** ⚠️`,
        ``,
        `The bot was removed from server: **${guild.name}** (ID: ${guild.id})`,
        `This was not detected as a kick, so either:`,
        `• The server was deleted`,
        `• The bot left the server`,
        `• The bot's token was used elsewhere`,
        ``,
        `Server Info:`,
        `• Members: ${guild.memberCount}`,
        `• Owner ID: ${guild.ownerId}`,
        ``,
        `This server was configured as protected in your config.yaml!`,
        `Please investigate this issue immediately.`
    ].join('\n');
    
    // Try to notify all owners
    let anyNotificationSuccessful = false;
    
    for (const ownerId of config.ownerIds) {
        try {
            const owner = await client.users.fetch(ownerId).catch(() => null);
            if (!owner) continue;
            
            await owner.send(message);
            log(`Successfully notified owner ${owner.tag} about removal from ${guild.name}`, 'info');
            anyNotificationSuccessful = true;
        } catch (error) {
            // Don't log individual errors to avoid spam
        }
    }
    
    // If we couldn't notify any owners via DM, make sure it's logged prominently
    if (!anyNotificationSuccessful) {
        console.log(`\n\n⚠️ CRITICAL ALERT: Bot removed from protected server ${guild.name} (${guild.id}) but couldn't notify any owners!\n\n`);
    }
    
    // Also send to webhook if configured
    const webhookUrl = config.logWebhook;
    if (webhookUrl && webhookUrl.length > 8) {
        try {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content: `⚠️ **ALERT: Bot Removed from Protected Server** ⚠️`,
                    embeds: [{
                        title: 'Bot Removed from Protected Server',
                        description: `The bot was removed from **${guild.name}** (ID: ${guild.id})`,
                        color: 0xff0000, // Red
                        fields: [
                            {
                                name: 'Server Name',
                                value: guild.name,
                                inline: true
                            },
                            {
                                name: 'Server ID',
                                value: guild.id,
                                inline: true
                            },
                            {
                                name: 'Removal Type',
                                value: 'Server left/deleted (not a kick)',
                                inline: false
                            },
                            {
                                name: 'Member Count',
                                value: guild.memberCount.toString(),
                                inline: true
                            },
                            {
                                name: 'Owner ID',
                                value: guild.ownerId,
                                inline: true
                            }
                        ],
                        footer: {
                            text: 'This server was configured as protected in your config.yaml'
                        }
                    }],
                    username: 'Discord Antinuke Alert',
                    avatar_url: 'https://i.imgur.com/NN9S8J7.png' // Shield icon
                })
            });
        } catch (error) {
            // If webhook fails, just continue - we've already logged the error
        }
    }
}
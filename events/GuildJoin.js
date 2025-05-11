module.exports = {
    name: 'guildCreate',
    execute(client, guild, ...args) {
        const helpers = args[args.length - 1];
        const { config, log, isProtectedServer, removedServers, saveRemovedServers } = helpers;
        
        // First, check if this guild is in our protected list
        const isProtected = isProtectedServer(guild.id);
        
        // Check if this was a server we were previously removed from
        if (removedServers[guild.id]) {
            const removedData = removedServers[guild.id];
            const wasProtected = removedData.wasProtected === true;
            const timeAgo = Math.floor((Date.now() - removedData.timestamp) / (1000 * 60)); // Minutes ago
            const reason = removedData.reason || 'unknown reason';
            
            // Create different messages depending on whether it was a protected server
            if (wasProtected) {
                log(`🔄 REJOINED PROTECTED SERVER: ${guild.name} (${guild.id})`, 'success');
                log(`Bot was previously ${reason} ${timeAgo} minutes ago`, 'info');
                
                // Notify owners about regaining access to a protected server
                notifyOwnersAboutRejoin(client, guild, removedData, helpers);
            } else {
                log(`Rejoined previously left server: ${guild.name} (${guild.id})`, 'info');
                log(`Bot was previously ${reason} ${timeAgo} minutes ago`, 'debug');
            }
            
            // Remove from the tracked list since we're back
            delete removedServers[guild.id];
            saveRemovedServers(helpers);
        } else {
            // Normal server join
            if (isProtected) {
                log(`Joined protected server: ${guild.name} (${guild.id})`, 'success');
            } else {
                log(`Joined server: ${guild.name} (${guild.id})`, 'info');
            }
        }
        
        // If this is a protected server, log the member count and channel count
        if (isProtected) {
            log(`Server info - Members: ${guild.memberCount}, Channels: ${guild.channels.cache.size}, Roles: ${guild.roles.cache.size}`, 'info', guild.id);
            
            // Cache this server's data to improve protection capabilities
            helpers.cacheGuild(guild);
            
            // Check our permissions and role hierarchy in this server
            const hierarchyHandler = client.handlers.get('hierarchy');
            if (hierarchyHandler) {
                hierarchyHandler.checkBotHierarchy(guild, false); // Don't be silent
            }
            
            const permissionHandler = client.handlers.get('permission');
            if (permissionHandler) {
                permissionHandler.checkBotPermissionsAndHierarchy(guild);
            }
        }
    }
};

/**
 * Send notifications to all owners that the bot has regained access to a previously removed server
 * @param {Client} client - Discord client
 * @param {Guild} guild - The guild the bot has rejoined
 * @param {Object} removedData - Data about when the server was removed
 * @param {Object} helpers - Helper functions
 */
async function notifyOwnersAboutRejoin(client, guild, removedData, helpers) {
    const { config, log } = helpers;
    
    // Get time difference in a human-readable format
    const timeDiff = getTimeDifferenceText(removedData.timestamp);
    
    // Construct a detailed message
    const message = [
        `🔄 **ALERT: Bot Regained Access to Protected Server** 🔄`,
        ``,
        `The bot has rejoined server: **${guild.name}** (ID: ${guild.id})`,
        `Previously ${removedData.reason} ${timeDiff} ago.`,
        ``,
        `Server Info:`,
        `• Members: ${guild.memberCount}`,
        `• Channels: ${guild.channels.cache.size}`,
        `• Roles: ${guild.roles.cache.size}`,
        ``,
        `Please verify that your server security is intact and check for any suspicious activity.`
    ].join('\n');
    
    // Try to notify all owners
    let anyNotificationSuccessful = false;
    
    for (const ownerId of config.ownerIds) {
        try {
            const owner = await client.users.fetch(ownerId).catch(() => null);
            if (!owner) continue;
            
            await owner.send(message);
            log(`Successfully notified owner ${owner.tag} about rejoining ${guild.name}`, 'info');
            anyNotificationSuccessful = true;
        } catch (error) {
            // Don't log individual errors to avoid spam
        }
    }
    
    // If we couldn't notify any owners via DM, make sure it's logged prominently
    if (!anyNotificationSuccessful) {
        console.log(`\n\n🔄 ALERT: Bot rejoined previously removed server ${guild.name} (${guild.id}) but couldn't notify any owners!\n\n`);
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
                    content: `🔄 **ALERT: Bot Regained Access to Protected Server** 🔄`,
                    embeds: [{
                        title: 'Bot Rejoined Protected Server',
                        description: `The bot has regained access to **${guild.name}** (ID: ${guild.id})`,
                        color: 0x3498db, // Blue
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
                                name: 'Previously Removed',
                                value: `${removedData.reason} ${timeDiff} ago`,
                                inline: false
                            },
                            {
                                name: 'Current Member Count',
                                value: guild.memberCount.toString(),
                                inline: true
                            },
                            {
                                name: 'Channel Count',
                                value: guild.channels.cache.size.toString(),
                                inline: true
                            }
                        ],
                        footer: {
                            text: 'Please verify server security is intact'
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

/**
 * Get a human-readable time difference text
 * @param {number} timestamp - The timestamp to compare against current time
 * @returns {string} Human-readable time difference
 */
function getTimeDifferenceText(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    // Less than a minute
    if (diff < 60000) {
        return 'less than a minute';
    }
    
    // Minutes
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
    
    // Hours
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours} hour${hours > 1 ? 's' : ''}`;
    }
    
    // Days
    const days = Math.floor(diff / 86400000);
    return `${days} day${days > 1 ? 's' : ''}`;
}
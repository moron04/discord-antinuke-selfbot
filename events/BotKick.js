module.exports = {
    name: 'guildMemberRemove',
    execute(client, member, ...args) {
        const helpers = args[args.length - 1];
        const { config, log, isProtectedServer, removedServers, saveRemovedServers } = helpers;
        
        // Only process events for the selfbot user
        if (member.id !== client.user.id) return;
        
        const { guild } = member;
        log(`Bot was removed from server: ${guild.name} (${guild.id})`, 'warning');
        
        // Check if this server is in our protected list
        const isProtected = isProtectedServer(guild.id);
        
        if (isProtected) {
            log(`⚠️ WARNING: BOT KICKED FROM PROTECTED SERVER: ${guild.name} (${guild.id})`, 'critical');
            
            // Track this server in the removed servers list
            removedServers[guild.id] = {
                name: guild.name,
                id: guild.id,
                timestamp: Date.now(),
                reason: 'kicked',
                wasProtected: true,
                memberCount: guild.memberCount,
                ownerTag: guild.ownerId
            };
            
            // Persist the removed servers list
            saveRemovedServers(helpers);
            
            // Check audit logs to try to determine who kicked the bot
            checkAuditLogsForKicker(client, guild, helpers)
                .then(kicker => {
                    // Update the removed server entry with kicker info if found
                    if (kicker) {
                        removedServers[guild.id].kickedBy = {
                            id: kicker.id,
                            tag: kicker.tag
                        };
                        saveRemovedServers(helpers);
                    }
                    
                    // Send notification to owners
                    notifyOwnersAboutKick(client, guild, kicker, helpers);
                })
                .catch(error => {
                    log(`Failed to check audit logs: ${error.message}`, 'error', guild.id);
                    // Send notification without kicker info
                    notifyOwnersAboutKick(client, guild, null, helpers);
                });
        } else {
            // Not a protected server, just log it
            log(`Bot was kicked from non-protected server: ${guild.name}`, 'info');
            
            // Still track it but mark as non-protected
            removedServers[guild.id] = {
                name: guild.name,
                id: guild.id,
                timestamp: Date.now(),
                reason: 'kicked',
                wasProtected: false
            };
            
            // Persist the removed servers list
            saveRemovedServers(helpers);
        }
    }
};

/**
 * Check audit logs to determine who kicked the bot
 * @param {Client} client - Discord client
 * @param {Guild} guild - The guild the bot was kicked from
 * @param {Object} helpers - Helper functions
 */
async function checkAuditLogsForKicker(client, guild, helpers) {
    const { log } = helpers;
    
    try {
        // We need to fetch the guild since we no longer have access to it
        const guildObj = client.guilds.cache.get(guild.id);
        if (!guildObj) {
            log(`Cannot fetch audit logs for ${guild.name}: No longer have access`, 'warning');
            return null;
        }
        
        // Fetch audit logs
        const auditLogs = await guildObj.fetchAuditLogs({
            limit: 5,
            type: 'MEMBER_KICK'
        });
        
        // Look for a kick action against the bot in the last minute
        const now = Date.now();
        const kickEntry = auditLogs.entries.find(entry => 
            entry.target.id === client.user.id && 
            now - entry.createdTimestamp < 60000 // Within the last minute
        );
        
        if (kickEntry) {
            const kicker = kickEntry.executor;
            log(`Identified kicker: ${kicker.tag} (${kicker.id})`, 'info', guild.id);
            return kicker;
        }
        
        log(`Could not identify who kicked the bot from ${guild.name}`, 'warning', guild.id);
        return null;
    } catch (error) {
        log(`Error checking audit logs: ${error.message}`, 'error', guild.id);
        return null;
    }
}

/**
 * Send notifications to all owners that the bot was kicked from a protected server
 * @param {Client} client - Discord client
 * @param {Guild} guild - The guild the bot was kicked from
 * @param {User|null} kicker - The user who kicked the bot, if known
 * @param {Object} helpers - Helper functions
 */
async function notifyOwnersAboutKick(client, guild, kicker, helpers) {
    const { config, log } = helpers;
    
    // Construct a detailed message
    const message = [
        `⚠️ **ALERT: Bot Kicked from Protected Server** ⚠️`,
        ``,
        `The bot was kicked from server: **${guild.name}** (ID: ${guild.id})`,
        kicker ? `Kicked by: **${kicker.tag}** (ID: ${kicker.id})` : `Unable to identify who kicked the bot.`,
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
            log(`Successfully notified owner ${owner.tag} about kick from ${guild.name}`, 'info');
            anyNotificationSuccessful = true;
        } catch (error) {
            // Don't log individual errors to avoid spam
        }
    }
    
    // If we couldn't notify any owners via DM, make sure it's logged prominently
    if (!anyNotificationSuccessful) {
        console.log(`\n\n⚠️ CRITICAL ALERT: Bot kicked from protected server ${guild.name} (${guild.id}) but couldn't notify any owners!\n\n`);
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
                    content: `⚠️ **ALERT: Bot Kicked from Protected Server** ⚠️`,
                    embeds: [{
                        title: 'Bot Kicked from Protected Server',
                        description: `The bot was kicked from **${guild.name}** (ID: ${guild.id})`,
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
                                name: 'Kicked By',
                                value: kicker ? `${kicker.tag} (${kicker.id})` : 'Unknown',
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
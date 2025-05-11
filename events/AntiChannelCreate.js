module.exports = {
    name: 'channelCreate',
    execute(client, channel, ...args) {
        const helpers = args[args.length - 1];
        const { config, log, isWhitelisted, isServerOwner, isProtectedServer, recordAction, takeAction, recentActions } = helpers;
        
        // Skip if not in a guild (DM channel) or not in a protected server
        if (!channel.guild || !isProtectedServer(channel.guild.id)) return;
        
        log(`Channel created: ${channel.name} (${channel.id})`, 'info', channel.guild.id);
        
        // Debug the threshold to ensure we're using the right value
        const threshold = config.thresholds.channelCreations;
        log(`Current channel creation threshold: ${threshold}`, 'info', channel.guild.id);
        
        // Get audit logs to determine who created the channel
        channel.guild.fetchAuditLogs({ type: 'CHANNEL_CREATE', limit: 1 }).then(async (audit) => {
            const entry = audit.entries.first();
            
            // Skip if no audit entry was found or if it's too old (more than 5 seconds)
            if (!entry || (Date.now() - entry.createdTimestamp) > 5000) return;
            
            const { executor } = entry;
            
            // Skip if the executor is the bot itself, whitelisted, or the server owner
            if (executor.id === client.user.id || 
                isWhitelisted(executor.id) || 
                isServerOwner(executor.id, channel.guild.id)) {
                log(`Channel creation by trusted user: ${executor.tag} (${executor.id})`, 'info', channel.guild.id);
                return;
            }
            
            // Use the recordAction function to track this action and check thresholds
            const thresholdExceeded = recordAction('channelCreations', executor.id, channel.guild.id);
            
            // For debugging purposes, let's log the current count
            const now = Date.now();
            const recentActionsCount = recentActions.channelCreations[channel.guild.id]?.filter(
                action => action.userId === executor.id && (now - action.timestamp) < config.thresholds.timeWindow
            ).length || 0;
            
            log(`User ${executor.tag} has created ${recentActionsCount}/${threshold} channels in the time window`, 'info', channel.guild.id);
            
            // Check if threshold is exceeded
            if (thresholdExceeded) {
                log(`Channel creation threshold exceeded by ${executor.tag} (${executor.id}) - ${recentActionsCount}/${threshold}`, 'warning', channel.guild.id);
                
                // Take action against the user
                await takeAction(executor.id, channel.guild.id, 'Mass channel creation');
                
                // Delete the created channel
                try {
                    await channel.delete(`Antinuke: Mass channel creation detected`);
                    log(`Deleted suspicious channel: ${channel.name}`, 'success', channel.guild.id);
                } catch (error) {
                    log(`Error deleting suspicious channel: ${error.message}`, 'error', channel.guild.id);
                }
            }
        }).catch((error) => {
            log(`Error processing channel creation: ${error.message}`, 'error', channel.guild.id);
        });
    }
};
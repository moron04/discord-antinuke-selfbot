module.exports = {
    name: 'channelDelete',
    execute(client, channel, ...args) {
        const helpers = args[args.length - 1];
        const { config, log, isWhitelisted, isServerOwner, isProtectedServer, recordAction, takeAction, recoverChannel, recentActions } = helpers;
        
        // Skip if not in a guild (DM channel) or not in a protected server
        if (!channel.guild || !isProtectedServer(channel.guild.id)) return;
        
        log(`Channel deleted: ${channel.name} (${channel.id})`, 'warning', channel.guild.id);
        
        // Get audit logs to determine who deleted the channel
        channel.guild.fetchAuditLogs({ type: 'CHANNEL_DELETE', limit: 1 }).then(async (audit) => {
            const entry = audit.entries.first();
            
            // Skip if no audit entry was found or if it's too old (more than 5 seconds)
            if (!entry || (Date.now() - entry.createdTimestamp) > 5000) return;
            
            const { executor } = entry;
            
            // Skip if the executor is the bot itself
            if (executor.id === client.user.id) {
                log(`Channel deletion by self (${executor.tag})`, 'info', channel.guild.id);
                return;
            }
            
            // Skip if the user is whitelisted
            if (isWhitelisted(executor.id, channel.guild.id)) {
                log(`Channel deletion by whitelisted user: ${executor.tag} (${executor.id})`, 'info', channel.guild.id);
                return;
            }
            
            // Skip if the user is the server owner
            if (isServerOwner(executor.id, channel.guild.id)) {
                log(`Channel deletion by server owner: ${executor.tag} (${executor.id})`, 'info', channel.guild.id);
                return;
            }
            
            // Debug the threshold to ensure we're using the right value
            const threshold = config.thresholds.channelDeletions;
            log(`Current channel deletion threshold: ${threshold}`, 'info', channel.guild.id);
            
            // Record this action and check if threshold exceeded
            const thresholdExceeded = recordAction('channelDeletions', executor.id, channel.guild.id);
            
            // For debugging purposes, let's log the current count
            const now = Date.now();
            const recentActionsCount = recentActions.channelDeletions[channel.guild.id]?.filter(
                action => action.userId === executor.id && (now - action.timestamp) < config.thresholds.timeWindow
            ).length || 0;
            
            log(`User ${executor.tag} has deleted ${recentActionsCount}/${threshold} channels in the time window`, 'info', channel.guild.id);

            // Always try to recover the channel immediately if auto-recovery is enabled
            // This happens regardless of threshold
            if (config.antinuke_settings?.auto_recovery && config.antinuke_settings?.recover_channels) {
                log(`Immediate channel recovery triggered for ${channel.name} (deleted by ${executor.tag})`, 'info', channel.guild.id);
                await recoverChannel(channel.id, channel.guild.id, channel);
            }
            
            // If more than 5 channels were deleted (>= threshold), take action against the user
            if (recentActionsCount >= threshold) {
                log(`Channel deletion threshold exceeded by ${executor.tag} (${executor.id}) - ${recentActionsCount}/${threshold}`, 'warning', channel.guild.id);
                
                // Take action against the user
                await takeAction(executor.id, channel.guild.id, 'Mass channel deletion');
            }
        }).catch((error) => {
            log(`Error processing channel deletion: ${error.message}`, 'error', channel.guild.id);
        });
    }
};
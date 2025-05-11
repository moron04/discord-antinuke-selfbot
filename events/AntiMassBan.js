module.exports = {
    name: 'guildBanAdd',
    execute(client, ban, ...args) {
        const helpers = args[args.length - 1];
        const { config, log, isWhitelisted, isServerOwner, isProtectedServer, recordAction, takeAction, recentActions } = helpers;
        
        // Skip if not in a protected server
        if (!isProtectedServer(ban.guild.id)) return;
        
        log(`Member banned: ${ban.user.tag} (${ban.user.id})`, 'warning', ban.guild.id);
        
        // Get audit logs to determine who banned the user
        ban.guild.fetchAuditLogs({ type: 'MEMBER_BAN_ADD', limit: 1 }).then(async (audit) => {
            const entry = audit.entries.first();
            
            // Skip if no audit entry was found or if it's too old (more than 5 seconds)
            if (!entry || (Date.now() - entry.createdTimestamp) > 5000) return;
            
            const { executor } = entry;
            
            // Skip if the executor is the bot itself
            if (executor.id === client.user.id) {
                log(`Ban by self (${executor.tag})`, 'info', ban.guild.id);
                return;
            }
            
            // Skip if the user is whitelisted
            if (isWhitelisted(executor.id, ban.guild.id)) {
                log(`Ban by whitelisted user: ${executor.tag} (${executor.id})`, 'info', ban.guild.id);
                return;
            }
            
            // Skip if the user is the server owner
            if (isServerOwner(executor.id, ban.guild.id)) {
                log(`Ban by server owner: ${executor.tag} (${executor.id})`, 'info', ban.guild.id);
                return;
            }
            
            // Debug the threshold to ensure we're using the right value
            const threshold = config.thresholds.bans;
            log(`Current ban threshold: ${threshold}`, 'info', ban.guild.id);
            
            // Record this action and check if threshold exceeded
            const thresholdExceeded = recordAction('bans', executor.id, ban.guild.id);
            
            // For debugging purposes, let's log the current count
            const now = Date.now();
            const recentActionsCount = recentActions.bans[ban.guild.id]?.filter(
                action => action.userId === executor.id && (now - action.timestamp) < config.thresholds.timeWindow
            ).length || 0;
            
            log(`User ${executor.tag} has banned ${recentActionsCount}/${threshold} users in the time window`, 'info', ban.guild.id);
            
            if (thresholdExceeded) {
                log(`Ban threshold exceeded by ${executor.tag} (${executor.id}) - ${recentActionsCount}/${threshold}`, 'warning', ban.guild.id);
                
                // Take action against the user
                await takeAction(executor.id, ban.guild.id, 'Mass banning members');
                
                // Try to unban the user who was just banned
                try {
                    await ban.guild.members.unban(ban.user.id, 'Antinuke: Reverting suspicious ban');
                    log(`Unbanned ${ban.user.tag} after detecting mass ban activity`, 'success', ban.guild.id);
                } catch (error) {
                    log(`Failed to unban ${ban.user.tag}: ${error.message}`, 'error', ban.guild.id);
                }
            }
        }).catch((error) => {
            log(`Error processing ban: ${error.message}`, 'error', ban.guild.id);
        });
    }
};
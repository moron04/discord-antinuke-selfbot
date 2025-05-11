module.exports = {
    name: 'guildMemberRemove',
    execute(client, member, ...args) {
        const helpers = args[args.length - 1];
        const { config, log, isWhitelisted, isServerOwner, isProtectedServer, recordAction, takeAction, recentActions } = helpers;
        
        // Skip if not in a protected server
        if (!isProtectedServer(member.guild.id)) return;
        
        // Get audit logs to check if this was a kick (not a ban or normal leave)
        member.guild.fetchAuditLogs({ type: 'MEMBER_KICK', limit: 1 }).then(async (audit) => {
            const entry = audit.entries.first();
            
            // If there's no recent kick entry, this was probably a normal leave
            if (!entry || (Date.now() - entry.createdTimestamp) > 5000 || entry.target.id !== member.id) {
                return;
            }
            
            log(`Member kicked: ${member.user.tag} (${member.user.id})`, 'warning', member.guild.id);
            
            const { executor } = entry;
            
            // Skip if the executor is the bot itself, whitelisted, or the server owner
            if (executor.id === client.user.id || 
                isWhitelisted(executor.id) || 
                isServerOwner(executor.id, member.guild.id)) {
                log(`Kick by trusted user: ${executor.tag} (${executor.id})`, 'info', member.guild.id);
                return;
            }
            
            // Debug the threshold to ensure we're using the right value
            const threshold = config.thresholds.kicks;
            log(`Current kick threshold: ${threshold}`, 'info', member.guild.id);
            
            // Record this action and check if threshold exceeded
            const thresholdExceeded = recordAction('kicks', executor.id, member.guild.id);
            
            // For debugging purposes, let's log the current count
            const now = Date.now();
            const recentActionsCount = recentActions.kicks[member.guild.id]?.filter(
                action => action.userId === executor.id && (now - action.timestamp) < config.thresholds.timeWindow
            ).length || 0;
            
            log(`User ${executor.tag} has kicked ${recentActionsCount}/${threshold} members in the time window`, 'info', member.guild.id);
            
            if (thresholdExceeded) {
                log(`Kick threshold exceeded by ${executor.tag} (${executor.id}) - ${recentActionsCount}/${threshold}`, 'warning', member.guild.id);
                
                // Take action against the user
                await takeAction(executor.id, member.guild.id, 'Mass kicking members');
                
                // We can't undo kicks, but we can send a DM to the kicked user if desired
                try {
                    await member.user.send(`You were kicked from ${member.guild.name} by a user who was performing suspicious mass kicks. The server staff has been notified and appropriate action has been taken. You may rejoin the server if you wish.`);
                    log(`Sent message to ${member.user.tag} about suspicious kick`, 'info', member.guild.id);
                } catch (error) {
                    log(`Unable to DM kicked user ${member.user.tag}: ${error.message}`, 'info', member.guild.id);
                }
            }
        }).catch((error) => {
            log(`Error processing member remove: ${error.message}`, 'error', member.guild.id);
        });
    }
};
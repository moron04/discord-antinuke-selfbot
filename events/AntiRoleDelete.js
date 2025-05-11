module.exports = {
    name: 'roleDelete',
    execute(client, role, ...args) {
        const helpers = args[args.length - 1];
        const { config, log, isWhitelisted, isServerOwner, isProtectedServer, recordAction, takeAction, recoverRole, recentActions } = helpers;
        
        // Skip if not in a protected server
        if (!isProtectedServer(role.guild.id)) return;
        
        log(`Role deleted: ${role.name} (${role.id})`, 'warning', role.guild.id);
        
        // Get audit logs to determine who deleted the role
        role.guild.fetchAuditLogs({ type: 'ROLE_DELETE', limit: 1 }).then(async (audit) => {
            const entry = audit.entries.first();
            
            // Skip if no audit entry was found or if it's too old (more than 5 seconds)
            if (!entry || (Date.now() - entry.createdTimestamp) > 5000) return;
            
            const { executor } = entry;
            
            // Skip if the executor is the bot itself
            if (executor.id === client.user.id) {
                log(`Role deletion by self (${executor.tag})`, 'info', role.guild.id);
                return;
            }
            
            // Skip if the user is whitelisted
            if (isWhitelisted(executor.id, role.guild.id)) {
                log(`Role deletion by whitelisted user: ${executor.tag} (${executor.id})`, 'info', role.guild.id);
                return;
            }
            
            // Skip if the user is the server owner
            if (isServerOwner(executor.id, role.guild.id)) {
                log(`Role deletion by server owner: ${executor.tag} (${executor.id})`, 'info', role.guild.id);
                return;
            }
            
            // Debug the threshold to ensure we're using the right value
            const threshold = config.thresholds.roleDeletions;
            log(`Current role deletion threshold: ${threshold}`, 'info', role.guild.id);
            
            // Record this action and check if threshold exceeded
            const thresholdExceeded = recordAction('roleDeletions', executor.id, role.guild.id);
            
            // For debugging purposes, let's log the current count
            const now = Date.now();
            const recentActionsCount = recentActions.roleDeletions[role.guild.id]?.filter(
                action => action.userId === executor.id && (now - action.timestamp) < config.thresholds.timeWindow
            ).length || 0;
            
            log(`User ${executor.tag} has deleted ${recentActionsCount}/${threshold} roles in the time window`, 'info', role.guild.id);
            
            // Always try to recover the role immediately if auto-recovery is enabled
            // This happens regardless of threshold
            if (config.antinuke_settings?.auto_recovery && config.antinuke_settings?.recover_roles) {
                log(`Immediate role recovery triggered for ${role.name} (deleted by ${executor.tag})`, 'info', role.guild.id);
                await recoverRole(role.id, role.guild.id, role);
            }
            
            // If more than 5 roles were deleted (>= threshold), take action against the user
            if (recentActionsCount >= threshold) {
                log(`Role deletion threshold exceeded by ${executor.tag} (${executor.id}) - ${recentActionsCount}/${threshold}`, 'warning', role.guild.id);
                
                // Take action against the user
                await takeAction(executor.id, role.guild.id, 'Mass role deletion');
            }
        }).catch((error) => {
            log(`Error processing role deletion: ${error.message}`, 'error', role.guild.id);
        });
    }
};
module.exports = {
    name: 'roleCreate',
    execute(client, role, ...args) {
        const helpers = args[args.length - 1];
        const { config, log, isWhitelisted, isServerOwner, isProtectedServer, recordAction, takeAction, recentActions } = helpers;
        
        // Skip if not in a protected server
        if (!isProtectedServer(role.guild.id)) return;
        
        log(`Role created: ${role.name} (${role.id})`, 'info', role.guild.id);
        
        // Debug the threshold to ensure we're using the right value
        const threshold = config.thresholds.roleCreations;
        log(`Current role creation threshold: ${threshold}`, 'info', role.guild.id);
        
        // Get audit logs to determine who created the role
        role.guild.fetchAuditLogs({ type: 'ROLE_CREATE', limit: 1 }).then(async (audit) => {
            const entry = audit.entries.first();
            
            // Skip if no audit entry was found or if it's too old (more than 5 seconds)
            if (!entry || (Date.now() - entry.createdTimestamp) > 5000) return;
            
            const { executor } = entry;
            
            // Skip if the executor is the bot itself, whitelisted, or the server owner
            if (executor.id === client.user.id || 
                isWhitelisted(executor.id) || 
                isServerOwner(executor.id, role.guild.id)) {
                log(`Role creation by trusted user: ${executor.tag} (${executor.id})`, 'info', role.guild.id);
                return;
            }
            
            // Record this action and check if threshold exceeded
            const thresholdExceeded = recordAction('roleCreations', executor.id, role.guild.id);
            
            // For debugging purposes, let's log the current count
            const now = Date.now();
            const recentActionsCount = recentActions.roleCreations[role.guild.id]?.filter(
                action => action.userId === executor.id && (now - action.timestamp) < config.thresholds.timeWindow
            ).length || 0;
            
            log(`User ${executor.tag} has created ${recentActionsCount}/${threshold} roles in the time window`, 'info', role.guild.id);
            
            if (thresholdExceeded) {
                log(`Role creation threshold exceeded by ${executor.tag} (${executor.id}) - ${recentActionsCount}/${threshold}`, 'warning', role.guild.id);
                
                // Take action against the user
                await takeAction(executor.id, role.guild.id, 'Mass role creation');
                
                // Delete the created role
                try {
                    await role.delete(`Antinuke: Mass role creation detected`);
                    log(`Deleted suspicious role: ${role.name}`, 'success', role.guild.id);
                } catch (error) {
                    log(`Error deleting suspicious role: ${error.message}`, 'error', role.guild.id);
                }
            }
        }).catch((error) => {
            log(`Error processing role creation: ${error.message}`, 'error', role.guild.id);
        });
    }
};
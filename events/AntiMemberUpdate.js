module.exports = {
    name: 'guildMemberUpdate',
    execute(client, oldMember, newMember, ...args) {
        const helpers = args[args.length - 1];
        const { config, log, isWhitelisted, isServerOwner, isProtectedServer, recordAction, takeAction, recentActions } = helpers;
        
        // Skip if not in a protected server
        if (!isProtectedServer(oldMember.guild.id)) return;
        
        // Check for role changes (main concern is adding admin roles)
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;
        
        // Skip if no role changes
        if (oldRoles.size === newRoles.size && 
            [...oldRoles.keys()].every(role => newRoles.has(role))) {
            return;
        }
        
        // Get roles that were added
        const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
        
        // Check if any dangerous permissions were added
        const dangerousRoles = addedRoles.filter(role => 
            role.permissions.has('ADMINISTRATOR') || 
            role.permissions.has('BAN_MEMBERS') || 
            role.permissions.has('KICK_MEMBERS') || 
            role.permissions.has('MANAGE_CHANNELS') || 
            role.permissions.has('MANAGE_GUILD') || 
            role.permissions.has('MANAGE_ROLES') || 
            role.permissions.has('MANAGE_WEBHOOKS')
        );
        
        if (dangerousRoles.size === 0) {
            // No dangerous roles were added, no need to take action
            return;
        }
        
        log(`Dangerous roles added to ${newMember.user.tag} (${newMember.user.id}): ${dangerousRoles.map(r => r.name).join(', ')}`, 'warning', newMember.guild.id);
        
        // Get audit logs to determine who changed the roles
        newMember.guild.fetchAuditLogs({ type: 'MEMBER_ROLE_UPDATE', limit: 1 }).then(async (audit) => {
            const entry = audit.entries.first();
            
            // Skip if no audit entry was found or if it's too old (more than 5 seconds)
            if (!entry || (Date.now() - entry.createdTimestamp) > 5000 || entry.target.id !== newMember.user.id) {
                return;
            }
            
            const { executor } = entry;
            
            // Skip if the executor is the bot itself, whitelisted, or the server owner
            if (executor.id === client.user.id || 
                isWhitelisted(executor.id) || 
                isServerOwner(executor.id, newMember.guild.id)) {
                log(`Role update by trusted user: ${executor.tag} (${executor.id})`, 'info', newMember.guild.id);
                return;
            }
            
            // Debug the threshold to ensure we're using the right value
            const threshold = config.thresholds.memberUpdates;
            log(`Current member update threshold: ${threshold}`, 'info', newMember.guild.id);
            
            // Record this action and check if threshold exceeded
            const thresholdExceeded = recordAction('memberRoleUpdates', executor.id, newMember.guild.id);
            
            // For debugging purposes, let's log the current count
            const now = Date.now();
            const recentActionsCount = recentActions.memberRoleUpdates[newMember.guild.id]?.filter(
                action => action.userId === executor.id && (now - action.timestamp) < config.thresholds.timeWindow
            ).length || 0;
            
            log(`User ${executor.tag} has updated ${recentActionsCount}/${threshold} member roles in the time window`, 'info', newMember.guild.id);
            
            if (thresholdExceeded || dangerousRoles.size > 0) {
                // Take immediate action if admin roles were added, or if threshold exceeded for regular role changes
                log(`${dangerousRoles.size > 0 ? 'Dangerous roles added' : 'Role update threshold exceeded'} by ${executor.tag} (${executor.id}) - ${recentActionsCount}/${threshold}`, 'warning', newMember.guild.id);
                
                // Take action against the user
                await takeAction(executor.id, newMember.guild.id, 'Suspicious role modifications');
                
                // Remove the added dangerous roles
                try {
                    await newMember.roles.remove(dangerousRoles, 'Antinuke: Reverting suspicious role additions');
                    log(`Removed dangerous roles from ${newMember.user.tag}`, 'success', newMember.guild.id);
                } catch (error) {
                    log(`Error removing dangerous roles: ${error.message}`, 'error', newMember.guild.id);
                }
            }
        }).catch((error) => {
            log(`Error processing member update: ${error.message}`, 'error', newMember.guild.id);
        });
    }
};
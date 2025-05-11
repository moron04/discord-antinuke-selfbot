module.exports = {
    name: 'roleUpdate',
    execute(client, oldRole, newRole, ...args) {
        const helpers = args[args.length - 1];
        const { log, isWhitelisted, isServerOwner, isProtectedServer, recordAction, takeAction, serverCache } = helpers;
        
        // Skip if not in a protected server
        if (!isProtectedServer(oldRole.guild.id)) return;
        
        // Check for significant changes (admin permissions being added)
        const oldHasAdmin = oldRole.permissions.has('ADMINISTRATOR');
        const newHasAdmin = newRole.permissions.has('ADMINISTRATOR');
        
        const significantPermissionChanges = 
            (!oldHasAdmin && newHasAdmin) ||  // Admin permission added
            (oldRole.permissions.bitfield !== newRole.permissions.bitfield && // Permissions changed
             (newRole.permissions.has('BAN_MEMBERS') || 
              newRole.permissions.has('KICK_MEMBERS') || 
              newRole.permissions.has('MANAGE_GUILD') || 
              newRole.permissions.has('MANAGE_CHANNELS') || 
              newRole.permissions.has('MANAGE_ROLES') || 
              newRole.permissions.has('MANAGE_WEBHOOKS')));
        
        if (!significantPermissionChanges) {
            // Not a dangerous permission change, don't need to log or act
            return;
        }
        
        log(`Role updated with significant permission changes: ${newRole.name} (${newRole.id})`, 'warning', newRole.guild.id);
        
        // Get audit logs to determine who updated the role
        newRole.guild.fetchAuditLogs({ type: 'ROLE_UPDATE', limit: 1 }).then(async (audit) => {
            const entry = audit.entries.first();
            
            // Skip if no audit entry was found or if it's too old (more than 5 seconds)
            if (!entry || (Date.now() - entry.createdTimestamp) > 5000) return;
            
            const { executor } = entry;
            
            // Skip if the executor is the bot itself, whitelisted, or the server owner
            if (executor.id === client.user.id || 
                isWhitelisted(executor.id) || 
                isServerOwner(executor.id, newRole.guild.id)) {
                log(`Role update by trusted user: ${executor.tag} (${executor.id})`, 'info', newRole.guild.id);
                return;
            }
            
            log(`Suspicious role update by ${executor.tag} (${executor.id})`, 'warning', newRole.guild.id);
            
            // Take action against the user (no threshold for dangerous permission changes)
            await takeAction(executor.id, newRole.guild.id, 'Dangerous role permission update');
            
            // Revert the role to its previous state
            try {
                await newRole.setPermissions(oldRole.permissions);
                log(`Reverted permission changes for role: ${newRole.name}`, 'success', newRole.guild.id);
            } catch (error) {
                log(`Error reverting role permissions: ${error.message}`, 'error', newRole.guild.id);
            }
            
            // Update the role in the cache
            if (serverCache[newRole.guild.id]) {
                const roleIndex = serverCache[newRole.guild.id].roles.findIndex(r => r.id === newRole.id);
                if (roleIndex !== -1) {
                    serverCache[newRole.guild.id].roles[roleIndex] = {
                        id: newRole.id,
                        name: newRole.name,
                        color: newRole.color,
                        hoist: newRole.hoist,
                        position: newRole.position,
                        permissions: newRole.permissions.bitfield,
                        mentionable: newRole.mentionable
                    };
                }
            }
        }).catch((error) => {
            log(`Error processing role update: ${error.message}`, 'error', newRole.guild.id);
        });
    }
};
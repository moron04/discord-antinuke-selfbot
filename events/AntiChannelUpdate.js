module.exports = {
    name: 'channelUpdate',
    execute(client, oldChannel, newChannel, ...args) {
        const helpers = args[args.length - 1];
        const { log, isWhitelisted, isServerOwner, isProtectedServer, takeAction, serverCache } = helpers;
        
        // Skip if not in a guild (DM channel) or not in a protected server
        if (!oldChannel.guild || !isProtectedServer(oldChannel.guild.id)) return;
        
        // Skip if nothing significant changed
        // Check for significant permission changes like adding admin permissions or removing everyone's view access
        let significantChanges = false;
        
        if (oldChannel.permissionOverwrites && newChannel.permissionOverwrites) {
            // Check if @everyone role had permissions changed dramatically
            const oldEveryonePerms = oldChannel.permissionOverwrites.cache.get(oldChannel.guild.id);
            const newEveryonePerms = newChannel.permissionOverwrites.cache.get(newChannel.guild.id);
            
            if (oldEveryonePerms && newEveryonePerms) {
                // Check if view channel permission was removed from @everyone (potentially hiding the channel)
                if (!oldEveryonePerms.deny.has('VIEW_CHANNEL') && newEveryonePerms.deny.has('VIEW_CHANNEL')) {
                    significantChanges = true;
                }
            }
            
            // Check if any roles or users received dangerous permissions
            newChannel.permissionOverwrites.cache.forEach(perm => {
                if (perm.allow.has('ADMINISTRATOR') || 
                    perm.allow.has('MANAGE_CHANNELS') || 
                    perm.allow.has('MANAGE_GUILD') || 
                    perm.allow.has('MANAGE_ROLES') || 
                    perm.allow.has('MANAGE_WEBHOOKS')) {
                    
                    // Check if these permissions were newly added
                    const oldPerm = oldChannel.permissionOverwrites.cache.get(perm.id);
                    if (!oldPerm || 
                        !oldPerm.allow.has('ADMINISTRATOR') && perm.allow.has('ADMINISTRATOR') ||
                        !oldPerm.allow.has('MANAGE_CHANNELS') && perm.allow.has('MANAGE_CHANNELS') ||
                        !oldPerm.allow.has('MANAGE_GUILD') && perm.allow.has('MANAGE_GUILD') ||
                        !oldPerm.allow.has('MANAGE_ROLES') && perm.allow.has('MANAGE_ROLES') ||
                        !oldPerm.allow.has('MANAGE_WEBHOOKS') && perm.allow.has('MANAGE_WEBHOOKS')) {
                        
                        significantChanges = true;
                    }
                }
            });
        }
        
        // Check for name changes with potential webhook disguises
        if (oldChannel.name !== newChannel.name) {
            const suspiciousNamePatterns = [
                'admin', 'announcement', 'important', 'security', 'verification', 'alert',
                'nitro', 'free', 'giveaway', 'moderator', 'mod', 'staff'
            ];
            
            if (suspiciousNamePatterns.some(pattern => 
                newChannel.name.toLowerCase().includes(pattern) && 
                !oldChannel.name.toLowerCase().includes(pattern))) {
                significantChanges = true;
            }
        }
        
        if (!significantChanges) {
            return;
        }
        
        log(`Significant channel update detected: ${newChannel.name} (${newChannel.id})`, 'warning', newChannel.guild.id);
        
        // Get audit logs to determine who updated the channel
        newChannel.guild.fetchAuditLogs({ type: 'CHANNEL_UPDATE', limit: 1 }).then(async (audit) => {
            const entry = audit.entries.first();
            
            // Skip if no audit entry was found or if it's too old (more than 5 seconds)
            if (!entry || (Date.now() - entry.createdTimestamp) > 5000) return;
            
            const { executor } = entry;
            
            // Skip if the executor is the bot itself, whitelisted, or the server owner
            if (executor.id === client.user.id || 
                isWhitelisted(executor.id) || 
                isServerOwner(executor.id, newChannel.guild.id)) {
                log(`Channel update by trusted user: ${executor.tag} (${executor.id})`, 'info', newChannel.guild.id);
                return;
            }
            
            log(`Suspicious channel update by ${executor.tag} (${executor.id})`, 'warning', newChannel.guild.id);
            
            // Take action against the user (no threshold for dangerous permission changes)
            await takeAction(executor.id, newChannel.guild.id, 'Suspicious channel modification');
            
            // Try to revert the channel to previous state
            try {
                if (oldChannel.name !== newChannel.name) {
                    await newChannel.setName(oldChannel.name, 'Antinuke: Reverting suspicious name change');
                }
                
                // Revert permission changes if needed
                if (oldChannel.permissionOverwrites && oldChannel.permissionsLocked !== newChannel.permissionsLocked) {
                    await newChannel.lockPermissions();
                }
                
                // More specific permission overwrites could be reverted here if needed
                
                log(`Reverted suspicious changes to channel ${newChannel.name}`, 'success', newChannel.guild.id);
            } catch (error) {
                log(`Error reverting channel changes: ${error.message}`, 'error', newChannel.guild.id);
            }
            
            // Update the channel in the cache
            if (serverCache[newChannel.guild.id]) {
                const channelIndex = serverCache[newChannel.guild.id].channels.findIndex(c => c.id === newChannel.id);
                if (channelIndex !== -1) {
                    serverCache[newChannel.guild.id].channels[channelIndex] = {
                        id: newChannel.id,
                        name: newChannel.name,
                        type: newChannel.type,
                        parent: newChannel.parent ? newChannel.parent.id : null,
                        position: newChannel.position,
                        permissionOverwrites: newChannel.permissionOverwrites ? 
                            Array.from(newChannel.permissionOverwrites.cache.values()).map(overwrite => ({
                                id: overwrite.id,
                                type: overwrite.type,
                                allow: overwrite.allow ? overwrite.allow.bitfield : 0,
                                deny: overwrite.deny ? overwrite.deny.bitfield : 0
                            })) : []
                    };
                }
            }
        }).catch((error) => {
            log(`Error processing channel update: ${error.message}`, 'error', newChannel.guild.id);
        });
    }
};
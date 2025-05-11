/**
 * PermissionHandler
 * Utilities for checking permissions and handling permission-related issues
 * Includes continuous monitoring of permissions and role hierarchy with auto-shutdown feature
 */

const chalk = require('chalk');
const moment = require('moment');

module.exports = {
    init(client, helpers) {
        const { log, isProtectedServer, config, sendLogToChannel } = helpers;
        
        // Track permission issues for auto-shutdown functionality
        const permissionIssues = {
            firstDetected: null,     // When an issue was first detected
            notifiedOwners: false,   // Whether owners have been notified
            affectedGuilds: {},      // Guilds with permission issues
            criticalIssue: false,    // Whether a critical issue is active
            shutdownScheduled: false // Whether shutdown has been scheduled
        };
        
        // Set up interval to check for permission issues (every 15 minutes)
        const permissionCheckInterval = setInterval(() => {
            checkBotPermissionsAndHierarchy();
        }, 15 * 60 * 1000); 
        
        // Check permissions on startup
        client.on('ready', () => {
            setTimeout(() => {
                checkBotPermissionsAndHierarchy();
            }, 5000); // Wait 5 seconds after ready before checking
        });
        
        // Listen for role updates that might affect the bot's hierarchy
        client.on('roleUpdate', (oldRole, newRole) => {
            // Only check if position changed and guild is protected
            if (oldRole.position !== newRole.position && isProtectedServer(newRole.guild.id)) {
                // Wait a moment for all role position changes to complete
                setTimeout(() => {
                    checkBotPermissionsAndHierarchy(newRole.guild);
                }, 2000);
            }
        });
        
        // Listen for role deletion that might affect the bot's highest role
        client.on('roleDelete', (role) => {
            if (isProtectedServer(role.guild.id)) {
                const me = role.guild.members.cache.get(client.user.id);
                if (!me) return;
                
                // If the deleted role was our highest role, recheck permissions
                const highestRole = me.roles.cache.sort((a, b) => b.position - a.position).first();
                if (!highestRole || highestRole.id === role.id) {
                    setTimeout(() => {
                        checkBotPermissionsAndHierarchy(role.guild);
                    }, 2000);
                }
            }
        });
        
        // Listen for guild member update that might affect the bot's roles
        client.on('guildMemberUpdate', (oldMember, newMember) => {
            // Only check if it's the bot being updated and guild is protected
            if (newMember.id === client.user.id && isProtectedServer(newMember.guild.id)) {
                // Check if roles were removed
                if (oldMember.roles.cache.size > newMember.roles.cache.size) {
                    setTimeout(() => {
                        checkBotPermissionsAndHierarchy(newMember.guild);
                    }, 2000);
                }
            }
        });
        
        /**
         * Comprehensive check of bot permissions and role hierarchy
         * @param {Guild} [specificGuild] - Optional specific guild to check
         */
        function checkBotPermissionsAndHierarchy(specificGuild = null) {
            // ONLY check servers that are explicitly in the protectedServers config
            const guildsToCheck = specificGuild ? 
                [specificGuild].filter(g => config.protectedServers.includes(g.id)) :
                client.guilds.cache.filter(g => config.protectedServers.includes(g.id));
            
            // Skip check if no protected servers
            if (guildsToCheck.size === 0) {
                return;
            }
            
            // Track if we find any critical issues in this check
            let criticalIssueFound = false;
            
            guildsToCheck.forEach(guild => {
                const me = guild.members.cache.get(client.user.id);
                if (!me) return;
                
                // Critical permissions needed for the bot to function properly
                const criticalPermissions = [
                    { name: 'BAN_MEMBERS', friendly: 'Ban Members' },
                    { name: 'KICK_MEMBERS', friendly: 'Kick Members' },
                ];
                
                // Important but not critical permissions
                const importantPermissions = [
                    { name: 'VIEW_AUDIT_LOG', friendly: 'View Audit Log' },
                    { name: 'MANAGE_ROLES', friendly: 'Manage Roles' },
                    { name: 'MANAGE_CHANNELS', friendly: 'Manage Channels' },
                    { name: 'MANAGE_GUILD', friendly: 'Manage Server' },
                ];
                
                // Check for administrator permission (best case)
                const hasAdmin = me.permissions.has('ADMINISTRATOR');
                
                if (hasAdmin) {
                    // We have admin, check if this guild had issues before
                    if (permissionIssues.affectedGuilds[guild.id]) {
                        // Issue resolved!
                        log(`🔄 Permissions restored in ${guild.name}! Administrator permission granted.`, 'success', guild.id);
                        delete permissionIssues.affectedGuilds[guild.id];
                    }
                    return;
                }
                
                // 1. Check for missing critical permissions
                const missingCritical = criticalPermissions.filter(perm => !me.permissions.has(perm.name));
                const missingImportant = importantPermissions.filter(perm => !me.permissions.has(perm.name));
                
                // 2. Check role hierarchy - need to have role above at least 70% of members
                let hierarchyIssue = false;
                const botRole = me.roles.cache.sort((a, b) => b.position - a.position).first();
                const botPosition = botRole ? botRole.position : 0;
                
                // Count members with roles higher than the bot 
                let membersAboveCount = 0;
                let totalMembers = 0;
                
                guild.members.cache.forEach(member => {
                    if (!member.user.bot) { // Only count real users
                        totalMembers++;
                        
                        const memberHighestRole = member.roles.cache.sort((a, b) => b.position - a.position).first();
                        if (memberHighestRole && memberHighestRole.position > botPosition && member.id !== client.user.id) {
                            membersAboveCount++;
                        }
                    }
                });
                
                // Only apply the 70% rule if there are more than 5 members in the server
                if (totalMembers > 5) {
                    const percentAbove = (membersAboveCount / totalMembers) * 100;
                    hierarchyIssue = percentAbove > 70;
                }
                
                // Determine if we have critical issues that impair bot functionality
                const hasCriticalIssue = missingCritical.length > 0 || hierarchyIssue;
                
                // If we found an issue, record it
                if (hasCriticalIssue) {
                    criticalIssueFound = true;
                    
                    // If this guild wasn't already marked as having issues, add it
                    if (!permissionIssues.affectedGuilds[guild.id]) {
                        permissionIssues.affectedGuilds[guild.id] = {
                            name: guild.name,
                            missingPermissions: [...missingCritical, ...missingImportant].map(p => p.friendly),
                            hierarchyIssue: hierarchyIssue,
                            percentAbove: totalMembers > 5 ? Math.round((membersAboveCount / totalMembers) * 100) : 0
                        };
                        
                        // Log the new issue
                        if (missingCritical.length > 0) {
                            log(`⚠️ Critical permission issue detected in ${guild.name}!`, 'warning', guild.id);
                            const missingList = missingCritical.map(p => p.friendly).join(', ');
                            log(`Missing critical permissions: ${missingList}`, 'warning', guild.id);
                        }
                        
                        if (hierarchyIssue) {
                            log(`⚠️ Role hierarchy issue detected in ${guild.name}!`, 'warning', guild.id);
                            log(`Bot's role is below ${membersAboveCount}/${totalMembers} members (${Math.round((membersAboveCount / totalMembers) * 100)}%)`, 'warning', guild.id);
                        }
                    }
                } else {
                    // If this guild had issues before but now they're resolved, remove from affected guilds
                    if (permissionIssues.affectedGuilds[guild.id]) {
                        log(`🔄 Permission/hierarchy issues resolved in ${guild.name}!`, 'success', guild.id);
                        delete permissionIssues.affectedGuilds[guild.id];
                    }
                }
            });
            
            // If we have any critical issues, check if we need to notify owners or schedule shutdown
            if (criticalIssueFound) {
                // If this is the first time we're detecting issues, record the time
                if (!permissionIssues.criticalIssue) {
                    permissionIssues.criticalIssue = true;
                    permissionIssues.firstDetected = Date.now();
                    log(`🔔 First critical permission/hierarchy issue detected at ${moment().format('YYYY-MM-DD HH:mm:ss')}`, 'warning');
                }
                
                // If we haven't notified owners yet, do so now
                if (!permissionIssues.notifiedOwners) {
                    notifyOwnersAboutPermissionIssues();
                    permissionIssues.notifiedOwners = true;
                }
                
                // Check if 12 hours have passed since the first issue was detected
                const hoursSinceIssue = (Date.now() - permissionIssues.firstDetected) / (1000 * 60 * 60);
                
                // If more than 12 hours have passed and we haven't scheduled shutdown yet, do it now
                if (hoursSinceIssue >= 12 && !permissionIssues.shutdownScheduled) {
                    scheduleAutoShutdown();
                    permissionIssues.shutdownScheduled = true;
                }
            } else {
                // All issues resolved, reset the tracker
                if (permissionIssues.criticalIssue) {
                    log(`✅ All critical permission/hierarchy issues resolved!`, 'success');
                    resetPermissionIssues();
                }
            }
        }
        
        /**
         * Send a detailed notification to all owners about permission/hierarchy issues
         */
        async function notifyOwnersAboutPermissionIssues() {
            const affectedGuildsCount = Object.keys(permissionIssues.affectedGuilds).length;
            
            // Prepare detailed message about the issues
            const message = [
                `⚠️ **CRITICAL PERMISSION ALERT** ⚠️`,
                ``,
                `The bot has detected critical permission or role hierarchy issues in ${affectedGuildsCount} server(s).`,
                `These issues will prevent the bot from taking action against malicious activity.`,
                ``,
                `If these issues are not resolved within 12 hours, the bot will automatically shut down to prevent security risks.`,
                ``,
                `**Affected Servers:**`
            ];
            
            // Add details for each affected guild
            Object.values(permissionIssues.affectedGuilds).forEach(guild => {
                message.push(`\n**${guild.name}**`);
                
                if (guild.missingPermissions.length > 0) {
                    message.push(`• Missing permissions: ${guild.missingPermissions.join(', ')}`);
                }
                
                if (guild.hierarchyIssue) {
                    message.push(`• Role hierarchy issue: Bot's role is below ${guild.percentAbove}% of members`);
                }
            });
            
            message.push(`\n\nTime of detection: ${moment(permissionIssues.firstDetected).format('YYYY-MM-DD HH:mm:ss')}`);
            message.push(`Auto-shutdown scheduled for: ${moment(permissionIssues.firstDetected).add(12, 'hours').format('YYYY-MM-DD HH:mm:ss')}`);
            message.push(`\nPlease fix these issues to prevent auto-shutdown.`);
            
            const finalMessage = message.join('\n');
            
            // Send message to all owners
            for (const ownerId of config.ownerIds) {
                try {
                    const owner = await client.users.fetch(ownerId);
                    await owner.send(finalMessage);
                    log(`Sent permission alert to owner ${owner.tag} (${ownerId})`, 'info');
                } catch (error) {
                    if (error.code === 50007) {
                        log(`Cannot send permission alert to owner ${ownerId} - they have DMs closed`, 'warning');
                    } else {
                        log(`Failed to notify owner ${ownerId} about permission issues: ${error.message}`, 'error');
                    }
                }
            }
        }
        
        /**
         * Reset the permission issues tracker (when all issues are resolved)
         */
        function resetPermissionIssues() {
            permissionIssues.firstDetected = null;
            permissionIssues.notifiedOwners = false;
            permissionIssues.affectedGuilds = {};
            permissionIssues.criticalIssue = false;
            permissionIssues.shutdownScheduled = false;
            
            // If we had a shutdown scheduled, notify owners that it's cancelled
            if (permissionIssues.shutdownScheduled) {
                notifyOwnersShutdownCancelled();
            }
        }
        
        /**
         * Schedule automatic shutdown after 12 hours of critical issues
         */
        function scheduleAutoShutdown() {
            // Calculate when shutdown should happen (12 hours after first detection)
            const shutdownTime = permissionIssues.firstDetected + (12 * 60 * 60 * 1000);
            const msUntilShutdown = shutdownTime - Date.now();
            
            // Log the scheduled shutdown
            const shutdownTimeString = moment(shutdownTime).format('YYYY-MM-DD HH:mm:ss');
            log(`⚠️ CRITICAL: Auto-shutdown scheduled for ${shutdownTimeString} due to persistent permission issues`, 'error');
            
            // Notify owners about imminent shutdown
            notifyOwnersAboutShutdown(shutdownTimeString);
            
            // Schedule the actual shutdown
            setTimeout(() => {
                // Double-check if issues still exist before shutting down
                if (permissionIssues.criticalIssue) {
                    log(`🛑 Executing auto-shutdown due to unresolved permission issues for over 12 hours`, 'error');
                    
                    // Send final message to owners
                    for (const ownerId of config.ownerIds) {
                        try {
                            const owner = client.users.cache.get(ownerId);
                            if (owner) {
                                owner.send(`🛑 **AUTO-SHUTDOWN EXECUTED**\nBot is shutting down now due to unresolved permission issues for over 12 hours.`);
                            }
                        } catch (e) {
                            // Ignore errors here, we're shutting down anyway
                        }
                    }
                    
                    // Delay shutdown slightly to allow final messages to be sent
                    setTimeout(() => {
                        process.exit(1);
                    }, 3000);
                }
            }, msUntilShutdown);
        }
        
        /**
         * Notify owners about the imminent shutdown
         * @param {string} shutdownTime - Formatted shutdown time
         */
        async function notifyOwnersAboutShutdown(shutdownTime) {
            const message = [
                `🛑 **CRITICAL: AUTO-SHUTDOWN IMMINENT** 🛑`,
                ``,
                `The bot has scheduled an automatic shutdown for: ${shutdownTime}`,
                ``,
                `This is happening because critical permission/hierarchy issues have existed for over 12 hours,`,
                `making it impossible for the bot to provide protection in the following servers:`,
                ``
            ];
            
            // Add details for each affected guild
            Object.values(permissionIssues.affectedGuilds).forEach(guild => {
                message.push(`• ${guild.name}`);
            });
            
            message.push(`\nTo prevent shutdown, please fix the permission issues immediately.`);
            message.push(`The bot will check every 15 minutes and cancel the shutdown if all issues are resolved.`);
            
            const finalMessage = message.join('\n');
            
            // Send message to all owners
            for (const ownerId of config.ownerIds) {
                try {
                    const owner = await client.users.fetch(ownerId);
                    await owner.send(finalMessage);
                    log(`Sent shutdown alert to owner ${owner.tag} (${ownerId})`, 'info');
                } catch (error) {
                    log(`Failed to notify owner ${ownerId} about imminent shutdown: ${error.message}`, 'error');
                }
            }
        }
        
        /**
         * Notify owners that scheduled shutdown is cancelled
         */
        async function notifyOwnersShutdownCancelled() {
            const message = [
                `✅ **AUTO-SHUTDOWN CANCELLED** ✅`,
                ``,
                `The bot has cancelled the scheduled auto-shutdown because all critical permission/hierarchy issues have been resolved.`,
                ``,
                `Protection features are now fully functional again.`,
                ``,
                `Thank you for addressing the issues.`
            ].join('\n');
            
            // Send message to all owners
            for (const ownerId of config.ownerIds) {
                try {
                    const owner = await client.users.fetch(ownerId);
                    await owner.send(message);
                    log(`Notified owner ${owner.tag} (${ownerId}) about shutdown cancellation`, 'info');
                } catch (error) {
                    log(`Failed to notify owner ${ownerId} about shutdown cancellation: ${error.message}`, 'warning');
                }
            }
        }
        
        // Make the check function available to other handlers
        helpers.checkBotPermissionsAndHierarchy = checkBotPermissionsAndHierarchy;
        
        log(`${chalk.greenBright('✓')} Permission handler initialized`, 'success');
    }
};
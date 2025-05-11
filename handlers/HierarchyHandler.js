/**
 * HierarchyHandler
 * Checks and enforces role hierarchy to ensure the bot can perform actions
 */

const chalk = require('chalk');

module.exports = {
    init(client, helpers) {
        const { log, config, isProtectedServer, sendLogToChannel } = helpers;
        
        // Initialize a variable to track silent mode (used during startup)
        let silentMode = false;
        
        // Silent check during ready event
        client.on('ready', () => {
            // Enable silent mode (no logging)
            silentMode = true;
            
            // Only check servers explicitly listed in config.protectedServers
            const protectedGuilds = client.guilds.cache.filter(guild => 
                config.protectedServers.includes(guild.id)
            );
                
            if (protectedGuilds.size > 0) {
                protectedGuilds.forEach(guild => {
                    checkBotHierarchy(guild, true); // true = silent mode
                });
            }
            
            // Disable silent mode after startup checks
            silentMode = false;
        });
        
        // Check hierarchy when bot joins a new guild
        client.on('guildCreate', (guild) => {
            // Only check if this guild is protected
            if (isProtectedServer(guild.id)) {
                checkBotHierarchy(guild);
            }
        });
        
        // Check hierarchy when roles are updated
        client.on('roleUpdate', (oldRole, newRole) => {
            // Only check if the position changed and guild is protected
            if (oldRole.position !== newRole.position && isProtectedServer(newRole.guild.id)) {
                checkBotHierarchy(newRole.guild);
            }
        });
        
        // Function to check bot's role hierarchy with silent mode option
        function checkBotHierarchy(guild, silent = false) {
            const me = guild.members.cache.get(client.user.id);
            if (!me) return;
            
            // Get the bot's highest role
            const botRole = me.roles.cache.sort((a, b) => b.position - a.position).first();
            const botPosition = botRole ? botRole.position : 0;
            
            // Only log if not in silent mode
            if (!silent && !silentMode) {
                log(`🔷 [${guild.name}] Role Hierarchy: ${chalk.cyanBright('[' + guild.name + ']')}`, 'info', guild.id);
            }
            
            // Always log critical warnings even in silent mode
            if (!botRole || botPosition === 0) {
                if (!silent) {
                    log(`${chalk.redBright('  ✗')} Bot has ${chalk.gray('@everyone')} as highest role - limited protection available`, 'warning', guild.id);
                }
                
                // This is a critical warning - also send to webhook/DM if configured
                if (config.logWebhook || config.logOwnerDm) {
                    sendLogToChannel(guild.id, "⚠️ Bot has `@everyone` as highest role - limited protection available");
                }
                
                return false;
            } else if (!silent && !silentMode) {
                log(`${chalk.cyanBright('  ▸')} Highest role: ${chalk.whiteBright(botRole.name)} (${chalk.gray(botRole.id)})`, 'info', guild.id);
            }
            
            // Count roles above the bot's highest role
            const rolesAbove = guild.roles.cache.filter(r => r.position > botPosition).size;
            if (!silent && !silentMode) {
                log(`${chalk.cyanBright('  ▸')} Roles above: ${chalk.whiteBright(rolesAbove)} roles`, 'info', guild.id);
            }
            
            // Count members that have roles above the bot
            let membersAboveCount = 0;
            let membersAboveNames = [];
            
            guild.members.cache.forEach(member => {
                const memberHighestRole = member.roles.cache.sort((a, b) => b.position - a.position).first();
                if (memberHighestRole && memberHighestRole.position > botPosition && member.id !== client.user.id) {
                    membersAboveCount++;
                    if (membersAboveCount <= 3) {
                        membersAboveNames.push(member.user.tag || member.displayName);
                    }
                }
            });
            
            // Get total member count (exclude bots if possible)
            const totalMembers = guild.members.cache.filter(m => !m.user.bot).size || guild.memberCount;
            
            // Only apply the 70% rule if there are more than 5 members in the server
            if (totalMembers > 5) {
                const percentAbove = (membersAboveCount / totalMembers) * 100;
                
                if (membersAboveCount > 0) {
                    if (!silent && !silentMode) {
                        if (membersAboveNames.length <= 3) {
                            log(`${chalk.cyanBright('  ▸')} Members above: ${chalk.whiteBright(membersAboveNames.join(', '))}`, 'info', guild.id);
                        } else {
                            log(`${chalk.cyanBright('  ▸')} Members above: ${chalk.whiteBright(membersAboveCount)} members (${Math.round(percentAbove)}% of server)`, 'info', guild.id);
                        }
                    }
                    
                    // Warning if more than 70% of members have higher roles than the bot - this is critical so always log
                    if (percentAbove > 70) {
                        // Critical warnings should show even in silent mode
                        log(`${chalk.yellowBright('  ⚠')} WARNING: Majority of members have higher roles!`, 'warning', guild.id);
                        
                        // Send to webhook/DM if configured
                        if (config.logWebhook || config.logOwnerDm) {
                            sendLogToChannel(guild.id, `⚠️ WARNING: ${membersAboveCount} members (${Math.round(percentAbove)}%) in ${guild.name} have roles higher than the bot. Protection capabilities are limited.`);
                        }
                        
                        return false;
                    }
                } else if (!silent && !silentMode) {
                    log(`${chalk.cyanBright('  ▸')} No members have roles higher than the bot`, 'info', guild.id);
                }
            } else {
                // For small servers, just mention how many members are above
                if (!silent && !silentMode) {
                    if (membersAboveCount > 0) {
                        log(`${chalk.cyanBright('  ▸')} Members above: ${chalk.whiteBright(membersAboveNames.join(', '))}`, 'info', guild.id);
                    } else {
                        log(`${chalk.cyanBright('  ▸')} No members have roles higher than the bot`, 'info', guild.id);
                    }
                }
            }
            
            return true;
        }
        
        log(`${chalk.greenBright('✓')} Hierarchy handler initialized`, 'success');
    }
};
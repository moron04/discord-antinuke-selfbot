const chalk = require('chalk');
const moment = require('moment');
const clear = require('clear');

module.exports = {
    name: 'ready',
    async execute(client, ...args) {
        const helpers = args[args.length - 1];
        const { config, log, isProtectedServer, cacheGuild } = helpers;
        
        // Clear the console for a clean startup display
        clear();
        
        // Import the displayStartupBanner function from index.js
        const displayStartupBanner = require('../index.js').displayStartupBanner;
        
        // Display the full startup banner
        if (typeof displayStartupBanner === 'function') {
            displayStartupBanner();
        } else {
            // Fallback banner if function not found
            console.log('\n' + chalk.cyanBright('═════════════════════════════════════════════════════════════'));
            console.log(chalk.whiteBright('                Discord Antinuke Selfbot'));
            console.log(chalk.gray('               (WebSocket Optimized)'));
            console.log(chalk.cyanBright('═════════════════════════════════════════════════════════════\n'));
        }
        
        // Check if selfbot's ID was manually specified in the config
        const botId = client.user.id;
        let configHadSelfbotAsOwner = false;
        
        // Get information about selfbot user for better error messages
        const botUsername = client.user.tag || client.user.username || 'Unknown';
        
        // Check if this ID was specified in config before login
        // We can identify this by checking the original owner IDs in the config
        const ownerIdsFromConfig = config.runtime.originalOwnerIds || [];
        
        // Check if selfbot's own ID is in the original owner IDs list
        if (ownerIdsFromConfig.includes(botId)) {
            configHadSelfbotAsOwner = true;
            
            // Display a clear error banner
            console.log('\n' + chalk.redBright('═════════════════════════════════════════════════════════════'));
            console.log(chalk.whiteBright('       ⚠️  CRITICAL CONFIGURATION ERROR  ⚠️'));
            console.log(chalk.redBright('═════════════════════════════════════════════════════════════'));
            
            log(`${chalk.redBright('🚨 CRITICAL ERROR: Self-protection loop detected!')}`, 'error');
            log(`${chalk.redBright('🚨 You cannot specify the selfbot\'s own ID as an owner!')}`, 'error');
            log(`${chalk.yellowBright('⚠️ Owner ID in your config matches this selfbot\'s account:')} ${chalk.cyanBright(botUsername)} (${chalk.gray(botId)})`, 'warning');
            
            // Explanation of why this is dangerous
            console.log('');
            log(`${chalk.redBright('❌')} ${chalk.gray('EXPLANATION:')}`, 'error');
            log(`${chalk.yellowBright('⚠️')} This creates a dangerous protection loop where the selfbot would try to monitor itself`, 'warning');
            log(`${chalk.yellowBright('⚠️')} If triggers were activated, the selfbot would attempt to punish its own account`, 'warning');
            log(`${chalk.yellowBright('⚠️')} This could make your selfbot inaccessible or cause unpredictable behavior`, 'warning');
            
            // Instructions on how to fix
            console.log('');
            log(`${chalk.greenBright('✅')} ${chalk.gray('HOW TO FIX:')}`, 'info');
            log(`${chalk.cyanBright('1.')} Edit your config.yaml file and remove the selfbot's ID from owner1_id or owner2_id`, 'info');
            log(`${chalk.cyanBright('2.')} Or if using environment variables, check OWNER_ID/OWNER_IDS variables`, 'info');
            log(`${chalk.cyanBright('3.')} Use your personal account ID as the owner instead of the selfbot's ID`, 'info');
            
            console.log('\n' + chalk.redBright('═════════════════════════════════════════════════════════════'));
            log(`${chalk.redBright('🛑 Shutting down for safety...')}`, 'error');
            console.log(chalk.redBright('═════════════════════════════════════════════════════════════\n'));
            
            // Give user time to read the message
            await new Promise(resolve => setTimeout(resolve, 5000));
            process.exit(1);
        }
        
        // Set owner ID to current user if not set and not already specified
        if (!configHadSelfbotAsOwner && !config.ownerIds.includes(client.user.id)) {
            config.ownerIds.push(client.user.id);
            // Ensure whitelist includes owner
            config.whitelist = [...new Set([...config.ownerIds, ...config.whitelist])];
            log(`${chalk.cyanBright('ℹ️')} Added your user ID (${client.user.id}) to the owners list`, 'info');
        }
        
        // Create a collection of whitelisted users with usernames
        const whitelistedUsers = [];
        
        // Silently fetch usernames for whitelisted users first
        if (config.whitelist.length > 0) {
            for (const userId of config.whitelist) {
                try {
                    // Try to fetch username if possible
                    const user = await client.users.fetch(userId).catch(() => null);
                    whitelistedUsers.push({
                        id: userId,
                        username: user ? user.tag || user.username : userId
                    });
                } catch (error) {
                    // If we can't fetch, just use the ID
                    whitelistedUsers.push({ id: userId, username: userId });
                }
            }
        }
        
        // We'll display this later in a more organized format
        
        
        log(`${chalk.greenBright('✅')} ${chalk.whiteBright(`Logged in as ${client.user.tag}`)}`, 'success');
        
        // Verify the configured servers
        if (config.protectedServers.length === 0) {
            log(`${chalk.redBright('❌')} ${chalk.yellowBright('No servers specified in config.protectedServers!')}`, 'error');
            log(`${chalk.cyanBright('ℹ️')} ${chalk.whiteBright('Please add at least one server ID to protect.')}`, 'info');
            log(`${chalk.yellowBright('⚠️')} ${chalk.whiteBright('Shutting down as there are no servers to protect...')}`, 'warning');
            process.exit(1);
        }
        
        // We'll summarize server information for a cleaner display
        log(`${chalk.cyanBright('═══════════════════════════════════════════════════════')}`, 'info');
        
        // Check which servers in the config we're actually in
        const joinedProtectedServers = [];
        const missingServers = [];
        
        for (const serverId of config.protectedServers) {
            const guild = client.guilds.cache.get(serverId);
            if (guild) {
                // Check if bot has Administrator permission in this server
                const botMember = guild.members.cache.get(client.user.id);
                if (!botMember) {
                    missingServers.push(serverId);
                    log(`${chalk.redBright('❌')} Cannot find bot member in server: ${chalk.gray(guild.name)}`, 'error');
                    continue;
                }
                
                // Check for Administrator permission (required for effective protection)
                if (!botMember.permissions.has("ADMINISTRATOR")) {
                    log(`${chalk.redBright('❌')} Missing ADMINISTRATOR permission in ${chalk.cyanBright(guild.name)}`, 'error');
                    log(`${chalk.yellowBright('⚠️')} Administrator permission is required for protection in ${guild.name}`, 'warning');
                    missingServers.push(serverId);
                    continue;
                }
                
                // All checks passed, add to protected servers
                joinedProtectedServers.push({id: serverId, name: guild.name});
                cacheGuild(guild);
                log(`${chalk.greenBright('✅')} Protecting: ${chalk.cyanBright(guild.name)} (ID: ${chalk.gray(serverId)})`, 'success');
            } else {
                missingServers.push(serverId);
                log(`${chalk.redBright('❌')} Cannot find server with ID: ${chalk.gray(serverId)}`, 'error');
            }
        }
        
        // Record the number of protected servers
        config.runtime.serversProtected = joinedProtectedServers.length;
        
        // Handle case where we're not in any of the specified servers
        if (joinedProtectedServers.length === 0 && config.protectedServers.length > 0) {
            log(`${chalk.redBright('❌')} ${chalk.yellowBright('Not present in any of the specified servers!')}`, 'error');
            log(`${chalk.yellowBright('⚠️')} ${chalk.whiteBright('Make sure this account is in the servers you want to protect.')}`, 'warning');
            log(`${chalk.yellowBright('⚠️')} ${chalk.whiteBright('Shutting down as there are no protected servers joined...')}`, 'warning');
            process.exit(1);
        }
        
        // Print summary - ONLY showing protected servers info
        log(`${chalk.cyanBright('\n══════════════════ PROTECTED SERVERS ══════════════════')}`, 'info');
        log(`${chalk.greenBright(`🛡️ Monitoring ${joinedProtectedServers.length} servers`)}`, 'success');
        
        if (missingServers.length > 0) {
            log(`${chalk.yellowBright(`⚠️ Warning: Unable to join ${missingServers.length} configured servers:`)}`, 'warning');
            missingServers.forEach(id => {
                log(`${chalk.gray(`   - ${id}`)}`, 'info');
            });
        }
        log(`${chalk.cyanBright('═══════════════════════════════════════════════════════')}`, 'info');
        
        // Display whitelist information in organized format
        if (whitelistedUsers.length > 0) {
            log(`${chalk.cyanBright('👥 Whitelisted Users:')}`, 'info');
            // Display whitelisted users in a cleaner format - two columns if many users
            const userDisplay = whitelistedUsers.map(user => 
                `${chalk.gray('   • ')}${chalk.cyanBright(user.username)}`
            );
            userDisplay.forEach(line => log(line, 'info'));
        } else {
            log(`${chalk.yellow('⚠️ No users are whitelisted. Consider adding trusted users to the whitelist in config.yaml')}`, 'warning');
        }
        log(`${chalk.cyanBright('═══════════════════════════════════════════════════════\n')}`, 'info');
        
        // Set activity status based on RPC configuration
        if (config.rpc && config.rpc.enabled) {
            // Initialize the RPC with the default activity
            const statusType = config.rpc.status || 'WATCHING';
            client.user.setActivity(`Protecting ${joinedProtectedServers.length} servers`, { type: statusType });
            log(`${chalk.cyanBright('ℹ️')} RPC status enabled: Activity status set to ${statusType}`, 'info');
            
            // Set up rotating status if configured
            if (config.rpc.rotate) {
                // Define the status rotation array with different messages
                const statusMessages = [
                    { text: `Protecting ${joinedProtectedServers.length} servers`, type: statusType },
                    { text: `${client.ws.ping}ms latency`, type: statusType },
                    { text: `Antinuke active`, type: statusType },
                    { text: `Monitoring since ${moment(config.runtime.startTime).format('MMM Do')}`, type: statusType }
                ];
                
                let currentIndex = 0;
                
                // Set interval for rotating status
                const interval = setInterval(() => {
                    // Get next status message in rotation
                    currentIndex = (currentIndex + 1) % statusMessages.length;
                    const status = statusMessages[currentIndex];
                    
                    // Update ping value each time if it's the ping status
                    if (status.text.includes('latency')) {
                        status.text = `${client.ws.ping}ms latency`;
                    }
                    
                    // Set the new activity
                    client.user.setActivity(status.text, { type: status.type });
                    log(`${chalk.magenta('🔄')} Rotated RPC status: ${status.text}`, 'debug');
                }, config.rpc.interval);
                
                // Save interval reference to client for cleanup if needed
                client.rpcInterval = interval;
                
                log(`${chalk.cyanBright('ℹ️')} RPC rotation enabled: Changing every ${config.rpc.interval/1000}s`, 'info');
            }
        } else {
            // Invisible to others when RPC is disabled
            log(`${chalk.cyanBright('ℹ️')} RPC status disabled: No activity status set`, 'info');
        }
    }
};
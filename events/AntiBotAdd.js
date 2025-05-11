module.exports = {
    name: 'guildMemberAdd',
    execute(client, member, ...args) {
        const helpers = args[args.length - 1];
        const { log, isWhitelisted, isServerOwner, isProtectedServer, recordAction, takeAction } = helpers;
        
        // Skip if not in a protected server
        if (!isProtectedServer(member.guild.id)) return;
        
        // Only check for bot additions
        if (!member.user.bot) return;
        
        log(`Bot added to server: ${member.user.tag} (${member.user.id})`, 'warning', member.guild.id);
        
        // Get audit logs to determine who added the bot
        member.guild.fetchAuditLogs({ type: 'BOT_ADD', limit: 1 }).then(async (audit) => {
            const entry = audit.entries.first();
            
            // Skip if no audit entry was found or if it's too old (more than 5 seconds)
            if (!entry || (Date.now() - entry.createdTimestamp) > 5000) return;
            
            const { executor } = entry;
            
            // Skip if the executor is the bot itself, whitelisted, or the server owner
            if (executor.id === client.user.id || 
                isWhitelisted(executor.id) || 
                isServerOwner(executor.id, member.guild.id)) {
                log(`Bot added by trusted user: ${executor.tag} (${executor.id})`, 'info', member.guild.id);
                return;
            }
            
            // Bot additions are extremely dangerous, take immediate action
            log(`Unauthorized bot addition by ${executor.tag} (${executor.id})`, 'warning', member.guild.id);
            
            // Take action against the user (no threshold for bot additions)
            await takeAction(executor.id, member.guild.id, 'Unauthorized bot addition');
            
            // Kick the added bot
            try {
                await member.kick('Antinuke: Unauthorized bot addition');
                log(`Kicked unauthorized bot: ${member.user.tag}`, 'success', member.guild.id);
            } catch (error) {
                log(`Error kicking unauthorized bot: ${error.message}`, 'error', member.guild.id);
            }
        }).catch((error) => {
            log(`Error processing bot addition: ${error.message}`, 'error', member.guild.id);
        });
    }
};
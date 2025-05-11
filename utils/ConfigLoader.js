/**
 * ConfigLoader
 * Centralized configuration loading from config.yaml
 */

const fs = require('fs');
const yaml = require('js-yaml');
const chalk = require('chalk');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

class ConfigLoader {
  constructor() {
    this.yamlConfig = {};
    this.config = {
      // Default config values
      token: process.env.DISCORD_TOKEN || '',
      prefix: '!',
      ownerIds: [],
      whitelist: [],
      protectedServers: [],
      logging: true,
      logLevel: 'info', // Default log level
      logChannels: {},
      logWebhook: '',
      logOwnerDm: false,
      notifyOnShutdown: true, // Default to notify owners on shutdown
      thresholds: {
        bans: 5,
        kicks: 5,
        unbans: 5,
        channelCreations: 5,
        channelDeletions: 5,
        channelUpdates: 5,
        roleCreations: 5,
        roleDeletions: 5,
        roleUpdates: 5,
        memberUpdates: 5,
        webhookCreations: 5,
        timeWindow: 36000000 // 10 hours in milliseconds
      },
      recovery: {
        enabled: true,
        channels: true,
        roles: true,
        permissions: true,
        maxRetries: 3
      },
      runtime: {
        startTime: Date.now(),
        timeWindowLogged: false,
        serversProtected: 0,
        lastRestart: null,
        userInfo: null,
        originalOwnerIds: [], // Store original owner IDs from config for self-ID check
        permissionIssues: {
          detected: false,
          firstDetected: null,
          scheduledShutdown: false
        }
      },
      punishment: 'ban'
    };
    
    this.loadConfig();
  }

  loadConfig() {
    try {
      // Try to load from config.yaml
      const configFile = fs.readFileSync('./config/config.yaml', 'utf8');
      this.yamlConfig = yaml.load(configFile);
      console.log(chalk.green('✅ Loaded configuration from config.yaml'));
      
      // Apply yaml config values to our config object
      this.applyYamlConfig();
    } catch (error) {
      console.log(chalk.red('❌ Error loading config.yaml:'), chalk.white(error.message));
      console.log(chalk.yellow('⚠️ Using default or .env configuration instead'));
      
      // Still try to load from environment variables
      if (process.env.DISCORD_TOKEN) {
        this.config.token = process.env.DISCORD_TOKEN;
        console.log(chalk.green('✅ Loaded token from .env file'));
      }
    }
    
    return this.config;
  }
  
  applyYamlConfig() {
    // Token (prioritize env variable, then yaml)
    this.config.token = process.env.DISCORD_TOKEN || this.yamlConfig.selfbot?.token || this.config.token;
    
    // Owner IDs
    // First, collect original owner IDs from config for later verification
    // YAML config owners
    if (this.yamlConfig.selfbot?.owner1_id) {
      const ownerId = String(this.yamlConfig.selfbot.owner1_id).replace(/"/g, '').trim();
      this.config.ownerIds.push(ownerId);
      this.config.runtime.originalOwnerIds.push(ownerId);
    }
    if (this.yamlConfig.selfbot?.owner2_id) {
      const ownerId = String(this.yamlConfig.selfbot.owner2_id).replace(/"/g, '').trim();
      this.config.ownerIds.push(ownerId);
      this.config.runtime.originalOwnerIds.push(ownerId);
    }
    
    // Check for environment variable owner IDs
    if (process.env.OWNER_ID) {
      const ownerId = String(process.env.OWNER_ID).replace(/"/g, '').trim();
      if (ownerId && /^\d{17,20}$/.test(ownerId)) {
        this.config.ownerIds.push(ownerId);
        this.config.runtime.originalOwnerIds.push(ownerId);
        console.log(chalk.green(`✅ Added owner ID from environment variable: ${ownerId}`));
      }
    }
    
    // Support for multiple owners via comma-separated env var
    if (process.env.OWNER_IDS) {
      const ownerIds = process.env.OWNER_IDS.split(',');
      for (const id of ownerIds) {
        const ownerId = String(id).replace(/"/g, '').trim();
        if (ownerId && /^\d{17,20}$/.test(ownerId)) {
          this.config.ownerIds.push(ownerId);
          this.config.runtime.originalOwnerIds.push(ownerId);
          console.log(chalk.green(`✅ Added owner ID from environment variable: ${ownerId}`));
        }
      }
    }
    
    // Server IDs to protect
    this.config.protectedServers = [];
    if (this.yamlConfig.selfbot?.server1_id) {
      this.config.protectedServers.push(this.yamlConfig.selfbot.server1_id);
    }
    if (this.yamlConfig.selfbot?.server2_id) {
      this.config.protectedServers.push(this.yamlConfig.selfbot.server2_id);
    }
    
    // Load whitelist from config
    this.config.whitelist = [];
    
    // Try to load from the new nested structure first (whitelisted.users)
    if (this.yamlConfig.whitelisted && Array.isArray(this.yamlConfig.whitelisted.users)) {
      console.log(chalk.cyan('ℹ️ Loading whitelist from whitelisted.users configuration'));
      for (const userId of this.yamlConfig.whitelisted.users) {
        // Validate user ID format before adding
        if (typeof userId === 'string' && /^\d{17,20}$/.test(userId.replace(/"/g, ''))) {
          // Remove quotes if present and add to whitelist
          this.config.whitelist.push(userId.replace(/"/g, ''));
          console.log(chalk.green(`✅ Added user to whitelist: ${userId}`));
        } else {
          console.log(chalk.yellow(`⚠️ Invalid whitelist user ID format: ${userId}`));
        }
      }
    }
    
    // For backward compatibility, also check the old format
    if (Array.isArray(this.yamlConfig.whitelist)) {
      console.log(chalk.cyan('ℹ️ Loading whitelist from legacy configuration'));
      for (const userId of this.yamlConfig.whitelist) {
        // Validate user ID format before adding
        if (typeof userId === 'string' && /^\d{17,20}$/.test(userId.replace(/"/g, ''))) {
          // Remove quotes if present and add to whitelist
          this.config.whitelist.push(userId.replace(/"/g, ''));
        } else {
          console.log(chalk.yellow(`⚠️ Invalid whitelist user ID format: ${userId}`));
        }
      }
    }
    
    // Thresholds and antinuke settings
    if (this.yamlConfig.antinuke_settings) {
      // Load thresholds from config
      this.config.thresholds.bans = this.yamlConfig.antinuke_settings.ban_limit || this.config.thresholds.bans;
      this.config.thresholds.kicks = this.yamlConfig.antinuke_settings.kick_limit || this.config.thresholds.kicks;
      this.config.thresholds.channelCreations = this.yamlConfig.antinuke_settings.channel_create_limit || this.config.thresholds.channelCreations;
      this.config.thresholds.channelDeletions = this.yamlConfig.antinuke_settings.channel_delete_limit || this.config.thresholds.channelDeletions;
      this.config.thresholds.channelUpdates = this.yamlConfig.antinuke_settings.channel_update_limit || this.config.thresholds.channelUpdates;
      this.config.thresholds.roleCreations = this.yamlConfig.antinuke_settings.role_create_limit || this.config.thresholds.roleCreations;
      this.config.thresholds.roleDeletions = this.yamlConfig.antinuke_settings.role_delete_limit || this.config.thresholds.roleDeletions;
      this.config.thresholds.roleUpdates = this.yamlConfig.antinuke_settings.role_update_limit || this.config.thresholds.roleUpdates;
      this.config.thresholds.memberUpdates = this.yamlConfig.antinuke_settings.member_update_limit || this.config.thresholds.memberUpdates;
      this.config.thresholds.unbans = this.yamlConfig.antinuke_settings.unban_limit || this.config.thresholds.unbans || 5;
      
      // Set the time window (default is 36000000ms = 10 hours)
      const configTimeWindow = this.yamlConfig.antinuke_settings.time_window;
      this.config.thresholds.timeWindow = configTimeWindow || 36000000;
      
      // For debugging time window configuration
      const timeWindowInSeconds = Math.floor(this.config.thresholds.timeWindow / 1000);
      const timeWindowInMinutes = Math.floor(timeWindowInSeconds / 60);
      const timeWindowInHours = Math.floor(timeWindowInMinutes / 60);
      
      if (configTimeWindow) {
          console.log(chalk.cyan(`ℹ️ Time window set from config: ${timeWindowInMinutes} minutes (${timeWindowInHours} hours)`));
      } else {
          console.log(chalk.yellow(`⚠️ Using default time window: ${timeWindowInMinutes} minutes (${timeWindowInHours} hours)`));
      }
      
      // Punishment type
      this.config.punishment = this.yamlConfig.antinuke_settings.punishment || this.config.punishment;
      
      // Auto-recovery settings
      this.config.antinuke_settings = {
        auto_recovery: this.yamlConfig.antinuke_settings.auto_recovery !== false, // Default to true if not specified
        recover_channels: this.yamlConfig.antinuke_settings.recover_channels !== false, // Default to true if not specified
        recover_roles: this.yamlConfig.antinuke_settings.recover_roles !== false, // Default to true if not specified
        recovery_delay: this.yamlConfig.antinuke_settings.recovery_delay || 500, // Default to 500ms if not specified
        punishment: this.yamlConfig.antinuke_settings.punishment || 'ban' // Default to ban if not specified
      };
      
      console.log(chalk.green(`✅ Loaded auto-recovery settings: ${this.config.antinuke_settings.auto_recovery ? 'Enabled' : 'Disabled'}`));
    }
    
    // Logging configuration
    if (this.yamlConfig.logs) {
      // Load webhook URL if present
      if (this.yamlConfig.logs.log_webhook) {
        this.config.logWebhook = this.yamlConfig.logs.log_webhook;
      }
      
      // Load DM setting
      if (this.yamlConfig.logs.log_owner_dm !== undefined) {
        this.config.logOwnerDm = this.yamlConfig.logs.log_owner_dm === true;
      }
      
      // Load channel ID for logging if present
      if (this.yamlConfig.logs.channel_id) {
        // Associate the channel with all protected servers
        for (const serverId of this.config.protectedServers) {
          this.config.logChannels[serverId] = this.yamlConfig.logs.channel_id;
        }
      }
      
      // Other log settings
      this.config.logging = this.yamlConfig.logs.timestamp !== false;
      
      // Notification on shutdown setting
      if (this.yamlConfig.logs.notify_on_shutdown !== undefined) {
        this.config.notifyOnShutdown = this.yamlConfig.logs.notify_on_shutdown === true;
      }
      
      // Load log level from config if present (defaults to 'info')
      if (this.yamlConfig.logs.log_level) {
        const validLevels = ['error', 'warning', 'info', 'success', 'debug'];
        const configLevel = this.yamlConfig.logs.log_level.toLowerCase();
        
        if (validLevels.includes(configLevel)) {
          this.config.logLevel = configLevel;
        } else {
          console.log(chalk.yellow(`⚠️ Invalid log_level in config: ${configLevel}. Using default: 'info'`));
        }
      }
    }
    
    // RPC settings
    if (this.yamlConfig.rpc) {
      this.config.rpc = {
        enabled: this.yamlConfig.rpc.enabled === true,
        rotate: this.yamlConfig.rpc.rotate === true,
        interval: this.yamlConfig.rpc.interval || 60000, // Default to 60 seconds rotation
        status: this.yamlConfig.rpc.status || 'WATCHING'
      };
    } else {
      this.config.rpc = {
        enabled: false,
        rotate: false,
        interval: 60000,
        status: 'WATCHING'
      };
    }
  }
}

module.exports = new ConfigLoader().config;
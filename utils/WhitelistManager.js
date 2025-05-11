/**
 * Whitelist Manager
 * Handles dynamic addition, removal, and persistence of whitelisted users
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const chalk = require('chalk');

class WhitelistManager {
  constructor(config) {
    this.config = config;
    this.whitelistPath = path.join(__dirname, '../config/config.yaml');
  }

  /**
   * Add a user to the whitelist
   * @param {string} userId - The Discord user ID to whitelist
   * @param {string} reason - The reason for whitelisting
   * @returns {object} Status of the operation
   */
  async addToWhitelist(userId, reason = 'Manual addition') {
    // Clean and validate user ID
    const cleanedId = this.cleanUserId(userId);
    if (!this.validateUserId(cleanedId)) {
      return { 
        success: false, 
        message: 'Invalid user ID format. IDs should be 17-20 digits.'
      };
    }

    // Check if already whitelisted
    if (this.config.whitelist.includes(cleanedId)) {
      return { 
        success: false, 
        message: `User ${cleanedId} is already whitelisted.`
      };
    }

    // Add to runtime whitelist
    this.config.whitelist.push(cleanedId);
    
    // Persist to config file
    try {
      await this.saveWhitelist();
      return { 
        success: true, 
        message: `Successfully added ${cleanedId} to whitelist. Reason: ${reason}`
      };
    } catch (error) {
      console.error(`Failed to save whitelist: ${error.message}`);
      return { 
        success: false, 
        message: `Added to runtime whitelist but failed to save to config: ${error.message}`
      };
    }
  }

  /**
   * Remove a user from the whitelist
   * @param {string} userId - The Discord user ID to remove
   * @returns {object} Status of the operation
   */
  async removeFromWhitelist(userId) {
    // Clean and validate user ID
    const cleanedId = this.cleanUserId(userId);
    if (!this.validateUserId(cleanedId)) {
      return { 
        success: false, 
        message: 'Invalid user ID format. IDs should be 17-20 digits.'
      };
    }

    // Check if in whitelist
    if (!this.config.whitelist.includes(cleanedId)) {
      return { 
        success: false, 
        message: `User ${cleanedId} is not in the whitelist.`
      };
    }

    // Check if user is an owner (cannot remove owners)
    if (this.config.ownerIds.includes(cleanedId)) {
      return { 
        success: false, 
        message: `Cannot remove user ${cleanedId} from whitelist because they are an owner. Remove from ownerIds first.`
      };
    }

    // Remove from runtime whitelist
    this.config.whitelist = this.config.whitelist.filter(id => id !== cleanedId);
    
    // Persist to config file
    try {
      await this.saveWhitelist();
      return { 
        success: true, 
        message: `Successfully removed ${cleanedId} from whitelist.`
      };
    } catch (error) {
      console.error(`Failed to save whitelist: ${error.message}`);
      return { 
        success: false, 
        message: `Removed from runtime whitelist but failed to save to config: ${error.message}`
      };
    }
  }

  /**
   * Get the current whitelist
   * @returns {Array<string>} Array of whitelisted user IDs
   */
  getWhitelist() {
    return this.config.whitelist;
  }

  /**
   * Check if a user is whitelisted
   * @param {string} userId - The Discord user ID to check
   * @returns {boolean} Whether the user is whitelisted
   */
  isWhitelisted(userId) {
    const cleanedId = this.cleanUserId(userId);
    return this.config.whitelist.includes(cleanedId);
  }

  /**
   * Clean a user ID by removing quotes, spaces, etc.
   * @param {string} userId - The Discord user ID to clean
   * @returns {string} The cleaned user ID
   */
  cleanUserId(userId) {
    if (!userId) return '';
    return userId.toString().replace(/["\s]/g, '');
  }

  /**
   * Validate a user ID format
   * @param {string} userId - The Discord user ID to validate
   * @returns {boolean} Whether the ID is valid
   */
  validateUserId(userId) {
    // Allow bot IDs which can have different formats
    if (userId.startsWith('bot-')) {
      // Extract the ID part after 'bot-' prefix
      const botId = userId.substring(4);
      return /^\d{17,20}$/.test(botId);
    }
    // Regular user ID validation
    return /^\d{17,20}$/.test(userId);
  }

  /**
   * Save the whitelist to the config file
   * @private
   */
  async saveWhitelist() {
    try {
      // Read the current config
      const configContent = fs.readFileSync(this.whitelistPath, 'utf8');
      const config = yaml.load(configContent);
      
      // Ensure the whitelisted structure exists
      if (!config.whitelisted) {
        config.whitelisted = {};
      }
      
      // Update the whitelist using the new structure
      config.whitelisted.users = this.config.whitelist.map(id => `"${id}"`);
      
      // Also update old structure for backward compatibility
      config.whitelist = this.config.whitelist.map(id => `"${id}"`);
      
      // Write back to file
      const yamlStr = yaml.dump(config, { lineWidth: -1 });
      fs.writeFileSync(this.whitelistPath, yamlStr, 'utf8');
      
      console.log(chalk.green('✅ Whitelist saved successfully to config.yaml'));
      return true;
    } catch (error) {
      console.error(chalk.red(`Error saving whitelist: ${error.message}`));
      throw error;
    }
  }
}

module.exports = WhitelistManager;
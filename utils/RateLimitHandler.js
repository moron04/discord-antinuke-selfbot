/**
 * RateLimitHandler
 * Provides utilities to prevent rate limiting in Discord API calls
 */

const chalk = require('chalk');

class RateLimitHandler {
  constructor() {
    this.pendingRequests = {};
    this.requestQueue = {};
    this.rateLimitInfo = {
      global: {
        limited: false,
        resetTime: 0
      },
      routes: {}
    };
  }

  /**
   * Execute a function with rate limit handling
   * @param {string} routeId - Unique identifier for the API route
   * @param {function} func - The async function to execute
   * @param {Array} args - Arguments to pass to the function
   * @param {Object} options - Additional options
   * @returns {Promise<any>} Result of the function
   */
  async execute(routeId, func, args = [], options = {}) {
    const {
      retryLimit = 3,
      initialBackoff = 1000,
      maxBackoff = 60000,
      logFunction = console.log
    } = options;

    // Check if we're globally rate limited
    if (this.rateLimitInfo.global.limited) {
      const now = Date.now();
      if (now < this.rateLimitInfo.global.resetTime) {
        const waitTime = this.rateLimitInfo.global.resetTime - now;
        logFunction(chalk.yellow(`Global rate limit in effect. Waiting ${waitTime}ms before retrying...`));
        await this.sleep(waitTime);
      } else {
        this.rateLimitInfo.global.limited = false;
      }
    }

    // Check if this specific route is rate limited
    if (this.rateLimitInfo.routes[routeId]?.limited) {
      const now = Date.now();
      if (now < this.rateLimitInfo.routes[routeId].resetTime) {
        const waitTime = this.rateLimitInfo.routes[routeId].resetTime - now;
        logFunction(chalk.yellow(`Rate limit for ${routeId}. Waiting ${waitTime}ms before retrying...`));
        await this.sleep(waitTime);
      } else {
        this.rateLimitInfo.routes[routeId] = { limited: false, resetTime: 0 };
      }
    }

    // Queue system to prevent parallel requests to the same route
    if (this.pendingRequests[routeId]) {
      if (!this.requestQueue[routeId]) {
        this.requestQueue[routeId] = [];
      }
      
      return new Promise((resolve, reject) => {
        this.requestQueue[routeId].push({ resolve, reject, func, args });
      });
    }

    this.pendingRequests[routeId] = true;

    let retries = 0;
    let lastError = null;

    while (retries <= retryLimit) {
      try {
        const result = await func(...args);
        this.pendingRequests[routeId] = false;
        this.processQueue(routeId);
        return result;
      } catch (error) {
        lastError = error;

        // Check for rate limit errors
        if (error.code === 429) {
          const retryAfter = error.retry_after || 1;
          const waitTime = retryAfter * 1000;
          
          if (error.global) {
            this.rateLimitInfo.global.limited = true;
            this.rateLimitInfo.global.resetTime = Date.now() + waitTime;
            logFunction(chalk.red(`Global rate limit hit! Waiting ${waitTime}ms before retrying...`));
          } else {
            if (!this.rateLimitInfo.routes[routeId]) {
              this.rateLimitInfo.routes[routeId] = { limited: false, resetTime: 0 };
            }
            
            this.rateLimitInfo.routes[routeId].limited = true;
            this.rateLimitInfo.routes[routeId].resetTime = Date.now() + waitTime;
            logFunction(chalk.yellow(`Rate limit hit for ${routeId}! Waiting ${waitTime}ms before retrying...`));
          }
          
          await this.sleep(waitTime);
          retries++; // Count the rate limit retry
          continue;
        }

        // For other errors, use exponential backoff
        if (retries < retryLimit) {
          const backoff = Math.min(maxBackoff, initialBackoff * Math.pow(2, retries));
          logFunction(chalk.yellow(`Request to ${routeId} failed, retrying in ${backoff}ms...`));
          await this.sleep(backoff);
          retries++;
        } else {
          this.pendingRequests[routeId] = false;
          this.processQueue(routeId);
          throw error; // Rethrow if we've exceeded retry limit
        }
      }
    }

    this.pendingRequests[routeId] = false;
    this.processQueue(routeId);
    throw lastError; // Shouldn't reach here, but just in case
  }

  /**
   * Process queued requests for a route
   * @private
   * @param {string} routeId - Route identifier
   */
  processQueue(routeId) {
    if (!this.requestQueue[routeId] || this.requestQueue[routeId].length === 0) {
      return;
    }

    const nextRequest = this.requestQueue[routeId].shift();
    this.pendingRequests[routeId] = true;

    nextRequest.func(...nextRequest.args)
      .then(result => {
        this.pendingRequests[routeId] = false;
        nextRequest.resolve(result);
        this.processQueue(routeId);
      })
      .catch(error => {
        this.pendingRequests[routeId] = false;
        nextRequest.reject(error);
        this.processQueue(routeId);
      });
  }

  /**
   * Sleep for a specified duration
   * @private
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new RateLimitHandler();
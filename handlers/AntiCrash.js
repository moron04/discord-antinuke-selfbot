/**
 * AntiCrash Handler
 * Handles process-wide error handling to prevent crashes
 */

const chalk = require('chalk');
const moment = require('moment');

module.exports = {
    init(client, helpers) {
        const { log } = helpers;
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (err) => {
            const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
            
            log(`\n${chalk.redBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`, 'error');
            log(`${chalk.redBright('⚠ UNCAUGHT EXCEPTION')} at ${chalk.yellow(timestamp)}`, 'error');
            log(`${chalk.redBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`, 'error');
            log(`${chalk.yellowBright('Error Message:')} ${chalk.whiteBright(err.message)}`, 'error');
            
            if (err.stack) {
                const stackLines = err.stack.split('\n');
                log(`${chalk.yellowBright('Stack Trace:')}`, 'error');
                
                // Print the stack trace with line numbers
                stackLines.forEach((line, index) => {
                    if (index > 0 && index < 6) {  // Limit to 5 stack frames to avoid spam
                        log(`  ${chalk.gray(index)}: ${chalk.gray(line.trim())}`, 'error');
                    }
                });
                
                if (stackLines.length > 6) {
                    log(`  ${chalk.gray('...')} ${chalk.gray(`${stackLines.length - 6} more stack frames`)}`, 'error');
                }
            } else {
                log(`${chalk.yellowBright('No stack trace available')}`, 'error');
            }
            
            log(`${chalk.redBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}\n`, 'error');
        });
        
        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
            
            log(`\n${chalk.yellowBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`, 'warning');
            log(`${chalk.yellowBright('⚠ UNHANDLED PROMISE REJECTION')} at ${chalk.yellow(timestamp)}`, 'warning');
            log(`${chalk.yellowBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`, 'warning');
            
            // Process the reason - it could be an Error object or just a string
            if (reason instanceof Error) {
                log(`${chalk.yellowBright('Reason:')} ${chalk.whiteBright(reason.message)}`, 'warning');
                
                if (reason.stack) {
                    const stackLines = reason.stack.split('\n');
                    log(`${chalk.yellowBright('Stack Trace:')}`, 'warning');
                    
                    // Print a few lines of the stack trace
                    stackLines.slice(0, 3).forEach((line, index) => {
                        log(`  ${chalk.gray(index)}: ${chalk.gray(line.trim())}`, 'warning');
                    });
                    
                    if (stackLines.length > 3) {
                        log(`  ${chalk.gray('...')}`, 'warning');
                    }
                }
            } else {
                log(`${chalk.yellowBright('Reason:')} ${chalk.whiteBright(String(reason))}`, 'warning');
            }
            
            // The promise object isn't very useful in the logs, so we just acknowledge it
            log(`${chalk.yellowBright('Promise:')} ${chalk.gray('[Promise Object]')}`, 'warning');
            log(`${chalk.yellowBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}\n`, 'warning');
        });
        
        // Handle runtime warnings (usually slower and less critical)
        process.on('warning', (warning) => {
            log(`${chalk.yellowBright('⚠ WARNING:')} ${warning.name} - ${warning.message}`, 'warning');
            
            // Only log the stack for non-standard warnings
            if (warning.name !== 'ExperimentalWarning' && warning.stack) {
                // Just log the first line of the stack
                const firstLine = warning.stack.split('\n')[1];
                if (firstLine) {
                    log(`  ${chalk.gray(firstLine.trim())}`, 'warning');
                }
            }
        });
        
        // Handle Discord client errors
        client.on('error', (error) => {
            log(`\n${chalk.redBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`, 'error');
            log(`${chalk.redBright('⚠ DISCORD CLIENT ERROR')}`, 'error');
            log(`${chalk.redBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`, 'error');
            log(`${chalk.yellowBright('Error Message:')} ${chalk.whiteBright(error.message)}`, 'error');
            
            if (error.stack) {
                const stackLines = error.stack.split('\n');
                log(`${chalk.yellowBright('Stack Trace:')}`, 'error');
                
                // Print a few lines of the stack trace
                stackLines.slice(0, 3).forEach((line, index) => {
                    log(`  ${chalk.gray(index)}: ${chalk.gray(line.trim())}`, 'error');
                });
                
                if (stackLines.length > 3) {
                    log(`  ${chalk.gray('...')}`, 'error');
                }
            }
            
            log(`${chalk.redBright('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}\n`, 'error');
        });
        
        // Handle disconnect and reconnection
        client.on('disconnect', () => {
            log(`${chalk.redBright('🔌 DISCONNECTED')} from Discord Gateway`, 'error');
        });
        
        client.on('reconnecting', () => {
            log(`${chalk.yellowBright('🔄 RECONNECTING')} to Discord Gateway...`, 'warning');
        });
        
        // Handle rate limits
        client.on('rateLimit', (info) => {
            log(`${chalk.yellowBright('⏱️ RATE LIMIT:')} ${chalk.cyan(info.method)} ${chalk.whiteBright(info.path)} (Timeout: ${chalk.redBright(info.timeout + 'ms')})`, 'warning');
            
            // Add a recovery estimate
            const resetAfter = Math.ceil(info.timeout / 1000);
            if (resetAfter > 5) {
                log(`  ${chalk.gray(`Rate limit resets in ${resetAfter} seconds`)}`, 'info');
            }
        });
        
        log(`${chalk.greenBright('✓')} AntiCrash handler initialized`, 'success');
    }
};
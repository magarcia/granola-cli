import chalk from 'chalk';
import { Command } from 'commander';
import { getAuthenticatedCredentials } from '../../lib/auth.js';
import { createGranolaDebug } from '../../lib/debug.js';
import { formatOutput, type OutputFormat } from '../../lib/output.js';

const debug = createGranolaDebug('cmd:auth:status');

/**
 * Creates the 'status' command for checking authentication state.
 *
 * Reports whether the user is currently authenticated.
 * Supports -o/--output for structured output.
 *
 * @returns Commander command instance
 */
export function createStatusCommand() {
  return new Command('status')
    .description('Check authentication status')
    .option('-o, --output <format>', 'Output format (json, yaml, toon)')
    .action(async (opts) => {
      debug('status command invoked');
      const format = opts.output || null;
      if (format && !['json', 'yaml', 'toon'].includes(format)) {
        console.error(chalk.red(`Invalid format: ${format}. Use 'json', 'yaml', or 'toon'.`));
        process.exit(1);
      }

      const creds = await getAuthenticatedCredentials();
      debug('authenticated: %s', !!creds);

      if (format) {
        console.log(formatOutput({ authenticated: !!creds }, format as OutputFormat));
        return;
      }

      if (creds) {
        console.log(chalk.green('Authenticated'));
      } else {
        console.log(chalk.yellow('Not authenticated'));
        console.log(chalk.dim('Run: granola auth login'));
      }
    });
}

export const statusCommand = createStatusCommand();

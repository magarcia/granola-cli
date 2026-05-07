import chalk from 'chalk';
import { Command } from 'commander';
import {
  getDefaultStoredAccountsPath,
  getDefaultSupabasePath,
  loadCredentialsFromFile,
  saveCredentials,
} from '../../lib/auth.js';
import { createGranolaDebug } from '../../lib/debug.js';

const debug = createGranolaDebug('cmd:auth:login');

/**
 * Creates the 'login' command for authenticating with Granola.
 * Imports credentials from the Granola desktop app.
 *
 * @example
 * granola auth login
 *
 * @returns Commander command instance
 */
export function createLoginCommand() {
  return new Command('login')
    .description('Import credentials from Granola desktop app')
    .action(async () => {
      debug('login command invoked');
      const creds = await loadCredentialsFromFile();
      if (!creds) {
        const storedAccountsPath = getDefaultStoredAccountsPath();
        const supabasePath = getDefaultSupabasePath();
        debug(
          'login failed: could not load credentials from %s or %s',
          storedAccountsPath,
          supabasePath,
        );
        console.error(chalk.red('Error:'), 'Could not load credentials.');
        console.error(`Looked for: ${chalk.dim(storedAccountsPath)}`);
        console.error(`       and: ${chalk.dim(supabasePath)}`);
        console.error('\nMake sure the Granola desktop app is installed and you are logged in.');
        process.exit(1);
      }

      debug('credentials loaded, saving to keychain');
      await saveCredentials(creds);
      debug('login successful');
      console.log(chalk.green('Credentials imported successfully'));
    });
}

export const loginCommand = createLoginCommand();

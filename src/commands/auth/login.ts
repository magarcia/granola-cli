import chalk from 'chalk';
import { Command } from 'commander';
import {
  getAuthenticatedCredentials,
  loadCredentialsFromFile,
  saveCredentials,
  validateCredentials,
} from '../../lib/auth.js';
import { loginWithBrowser } from '../../lib/browser-auth.js';
import { createGranolaDebug } from '../../lib/debug.js';
import { ApiError } from '../../lib/http.js';
import { withLock } from '../../lib/lock.js';

const debug = createGranolaDebug('cmd:auth:login');

export function createLoginCommand() {
  return new Command('login')
    .description('Sign in to Granola')
    .option('--browser', 'Start a new browser sign-in')
    .option('--no-auto-callback', 'Use manual callback paste instead of Chrome detection')
    .option('--provider <provider>', 'Sign-in provider (google, microsoft)', 'google')
    .action(async (opts: { browser?: boolean; autoCallback: boolean; provider: string }) => {
      debug('login command invoked');
      const provider = opts.provider;
      if (provider !== 'google' && provider !== 'microsoft') {
        throw new Error('Invalid provider. Use google or microsoft.');
      }

      if (!opts.browser) {
        const existing = await getAuthenticatedCredentials();
        if (existing) {
          console.log(chalk.green('Already authenticated'));
          return;
        }

        const imported = await loadCredentialsFromFile();
        if (imported && (await validateCredentials(imported))) {
          await withLock(() => saveCredentials(imported));
          console.log(chalk.green('Credentials imported successfully'));
          return;
        }
      }

      const creds = await loginWithBrowser({
        provider,
        autoCallback: opts.autoCallback,
      });
      if (!(await validateCredentials(creds))) {
        throw new ApiError(
          'Granola rejected the new credentials. Run granola auth login again.',
          401,
        );
      }
      await withLock(() => saveCredentials(creds));
      debug('login successful');
      console.log(chalk.green('Authenticated successfully'));
    });
}

export const loginCommand = createLoginCommand();

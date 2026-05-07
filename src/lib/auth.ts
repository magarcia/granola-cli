import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { deletePassword, getPassword, setPassword } from 'cross-keychain';
import type { Credentials } from '../types.js';
import { createGranolaDebug } from './debug.js';
import { withLock } from './lock.js';

const debug = createGranolaDebug('lib:auth');

const SERVICE_NAME = 'com.granola.cli';
const ACCOUNT_NAME = 'credentials';
const DEFAULT_CLIENT_ID = 'client_GranolaMac';

export async function getCredentials(): Promise<Credentials | null> {
  debug('loading credentials from keychain');
  try {
    const stored = await getPassword(SERVICE_NAME, ACCOUNT_NAME);
    if (!stored) {
      debug('no credentials found in keychain');
      return null;
    }

    const parsed = JSON.parse(stored);
    debug('credentials loaded, hasAccessToken: %s', Boolean(parsed.accessToken));
    return {
      refreshToken: parsed.refreshToken,
      accessToken: parsed.accessToken || '',
      clientId: parsed.clientId,
    };
  } catch (error) {
    debug('failed to get credentials: %O', error);
    return null;
  }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  debug('saving credentials to keychain');
  await setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(creds));
  debug('credentials saved');
}

export async function deleteCredentials(): Promise<void> {
  debug('deleting credentials from keychain');
  await deletePassword(SERVICE_NAME, ACCOUNT_NAME);
  debug('credentials deleted');
}

const WORKOS_AUTH_URL = 'https://api.workos.com/user_management/authenticate';

/**
 * Refreshes the access token using the stored refresh token.
 * WorkOS refresh tokens are single-use - each refresh returns a new refresh token
 * that must be saved immediately.
 *
 * Uses a file-based lock to prevent race conditions when multiple CLI processes
 * attempt to refresh the token simultaneously.
 *
 * @returns New credentials if refresh succeeds, null otherwise
 */
export async function refreshAccessToken(): Promise<Credentials | null> {
  debug('attempting token refresh');

  try {
    return await withLock(async () => {
      // Re-read credentials inside the lock - another process may have updated them
      const creds = await getCredentials();
      if (!creds?.refreshToken || !creds?.clientId) {
        debug('cannot refresh: missing refreshToken or clientId');
        return null;
      }

      const response = await fetch(WORKOS_AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: creds.clientId,
          grant_type: 'refresh_token',
          refresh_token: creds.refreshToken,
        }),
      });

      if (!response.ok) {
        debug('token refresh failed: %d %s', response.status, response.statusText);
        return null;
      }

      const data = (await response.json()) as { refresh_token: string; access_token: string };
      const newCreds: Credentials = {
        refreshToken: data.refresh_token,
        accessToken: data.access_token,
        clientId: creds.clientId,
      };

      await saveCredentials(newCreds);
      debug('token refresh successful, new credentials saved');
      return newCreds;
    });
  } catch (error) {
    debug('token refresh error: %O', error);
    return null;
  }
}

export function parseSupabaseJson(json: string): Credentials | null {
  debug('parsing supabase.json');
  try {
    const parsed = JSON.parse(json);

    // Try WorkOS tokens first (newer auth system)
    if (parsed.workos_tokens && typeof parsed.workos_tokens === 'string') {
      const workosTokens = JSON.parse(parsed.workos_tokens);
      if (workosTokens.access_token) {
        debug('found WorkOS tokens');
        return {
          refreshToken: workosTokens.refresh_token || '',
          accessToken: workosTokens.access_token,
          clientId: workosTokens.client_id || DEFAULT_CLIENT_ID,
        };
      }
    }

    // Fall back to Cognito tokens
    if (parsed.cognito_tokens && typeof parsed.cognito_tokens === 'string') {
      const cognitoTokens = JSON.parse(parsed.cognito_tokens);
      if (!cognitoTokens.refresh_token) return null;

      debug('found Cognito tokens');
      return {
        refreshToken: cognitoTokens.refresh_token,
        accessToken: cognitoTokens.access_token || '',
        clientId: cognitoTokens.client_id || DEFAULT_CLIENT_ID,
      };
    }

    // Legacy format: refresh_token at root level
    if (!parsed.refresh_token) return null;

    debug('found legacy token format');
    return {
      refreshToken: parsed.refresh_token,
      accessToken: parsed.access_token || '',
      clientId: parsed.client_id || DEFAULT_CLIENT_ID,
    };
  } catch (error) {
    debug('failed to parse supabase.json: %O', error);
    return null;
  }
}

/**
 * Parses the newer Granola desktop `stored-accounts.json` format.
 *
 * Granola desktop ≥7.162 stores fresh tokens in `stored-accounts.json`
 * instead of `supabase.json`. The shape is:
 *
 *   { "accounts": "[{\"userId\":\"…\",\"email\":\"…\",\"tokens\":\"{…}\"}]" }
 *
 * Both `accounts` and the inner `tokens` may be JSON strings (current shipping
 * format) or already-parsed objects (defensive against future format shifts).
 */
export function parseStoredAccountsJson(json: string): Credentials | null {
  debug('parsing stored-accounts.json');
  try {
    const parsed = JSON.parse(json);

    const accountsRaw = parsed.accounts;
    const accounts = typeof accountsRaw === 'string' ? JSON.parse(accountsRaw) : accountsRaw;
    if (!Array.isArray(accounts) || accounts.length === 0) {
      debug('stored-accounts.json: no accounts array');
      return null;
    }

    const account = accounts[0];
    const tokensRaw = account?.tokens;
    if (!tokensRaw) {
      debug('stored-accounts.json: account has no tokens field');
      return null;
    }
    const tokens = typeof tokensRaw === 'string' ? JSON.parse(tokensRaw) : tokensRaw;

    if (!tokens.access_token) {
      debug('stored-accounts.json: tokens missing access_token');
      return null;
    }

    debug('found stored-accounts tokens');
    return {
      refreshToken: tokens.refresh_token || '',
      accessToken: tokens.access_token,
      clientId: tokens.client_id || DEFAULT_CLIENT_ID,
    };
  } catch (error) {
    debug('failed to parse stored-accounts.json: %O', error);
    return null;
  }
}

/**
 * Gets the default path to a Granola desktop credentials file based on the OS.
 *
 * @param filename The basename of the credentials file (e.g. `supabase.json`,
 *                 `stored-accounts.json`).
 * @returns The platform-specific path to the file.
 */
function getDefaultGranolaFilePath(filename: string): string {
  const home = homedir();
  const os = platform();

  let path: string;
  switch (os) {
    case 'darwin':
      path = join(home, 'Library', 'Application Support', 'Granola', filename);
      break;
    case 'win32':
      path = join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Granola', filename);
      break;
    default:
      // Linux and other Unix-like systems
      path = join(home, '.config', 'granola', filename);
  }
  debug('platform: %s, %s path: %s', os, filename, path);
  return path;
}

/**
 * Gets the default path to the Granola supabase.json file based on the OS.
 *
 * @returns The platform-specific path to supabase.json
 */
export function getDefaultSupabasePath(): string {
  return getDefaultGranolaFilePath('supabase.json');
}

/**
 * Gets the default path to the Granola stored-accounts.json file based on the OS.
 *
 * Granola desktop ≥7.162 stores fresh tokens here instead of supabase.json.
 *
 * @returns The platform-specific path to stored-accounts.json
 */
export function getDefaultStoredAccountsPath(): string {
  return getDefaultGranolaFilePath('stored-accounts.json');
}

/**
 * Loads credentials from the Granola desktop app's local files.
 *
 * Tries `stored-accounts.json` first (Granola desktop ≥7.162) and falls back
 * to the legacy `supabase.json` if the newer file is missing or unreadable.
 * The desktop app stops updating `supabase.json` once it has migrated, so
 * stored-accounts is preferred to avoid handing out stale (and possibly
 * already-consumed-single-use-refresh-token) credentials.
 *
 * @returns Credentials if found and valid, null otherwise
 */
export async function loadCredentialsFromFile(): Promise<Credentials | null> {
  const storedAccountsPath = getDefaultStoredAccountsPath();
  debug('attempting to load credentials from %s', storedAccountsPath);
  try {
    const content = await readFile(storedAccountsPath, 'utf-8');
    const creds = parseStoredAccountsJson(content);
    if (creds) {
      debug('credentials loaded from stored-accounts.json');
      return creds;
    }
    debug('stored-accounts.json present but unparseable; falling back to supabase.json');
  } catch (error) {
    debug('stored-accounts.json not readable, falling back: %O', error);
  }

  const supabasePath = getDefaultSupabasePath();
  debug('attempting to load credentials from %s', supabasePath);
  try {
    const content = await readFile(supabasePath, 'utf-8');
    return parseSupabaseJson(content);
  } catch (error) {
    debug('failed to load credentials from supabase.json: %O', error);
    return null;
  }
}

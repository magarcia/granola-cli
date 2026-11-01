import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { deletePassword, getPassword, setPassword } from 'cross-keychain';
import type { Credentials } from '../types.js';
import { createGranolaDebug } from './debug.js';
import { ApiError } from './http.js';
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
  assertValidAccessToken(creds.accessToken);
  debug('saving credentials to keychain');
  await setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(creds));
  debug('credentials saved');
}

export async function deleteCredentials(): Promise<void> {
  debug('deleting credentials from keychain');
  await deletePassword(SERVICE_NAME, ACCOUNT_NAME);
  debug('credentials deleted');
}

export async function validateCredentials(creds: Credentials): Promise<boolean> {
  if (!creds.accessToken) return false;
  assertValidAccessToken(creds.accessToken);

  const response = await fetch('https://api.granola.ai/v1/get-user-info', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.accessToken}`,
    },
    body: '{}',
    signal: AbortSignal.timeout(15000),
  });
  await response.body?.cancel();

  if (response.status === 401) return false;
  if (!response.ok) {
    throw new ApiError('Could not verify Granola credentials. Try again.', response.status);
  }
  return true;
}

export async function getAuthenticatedCredentials(): Promise<Credentials | null> {
  const creds = await getCredentials();
  if (!creds) return null;
  if (await validateCredentials(creds)) return creds;

  const refreshed = await refreshAccessToken();
  return refreshed && (await validateCredentials(refreshed)) ? refreshed : null;
}

const GRANOLA_REFRESH_URL = 'https://api.granola.ai/v1/refresh-access-token';

function assertValidAccessToken(accessToken: string): void {
  try {
    // Native header errors can include the rejected token value.
    new Headers({ Authorization: `Bearer ${accessToken}` });
  } catch {
    throw new Error('Invalid Granola access token. Run granola auth login --browser.');
  }
}

/**
 * Refreshes the access token using the stored refresh token.
 * WorkOS refresh tokens are single-use - each refresh returns a new refresh token
 * that must be saved immediately.
 *
 * Uses a file-based lock to prevent race conditions when multiple CLI processes
 * attempt to refresh the token simultaneously.
 *
 * @returns New credentials, or null when the session cannot be refreshed
 * @throws Network, protocol, keychain, or lock errors
 */
export async function refreshAccessToken(): Promise<Credentials | null> {
  debug('attempting token refresh');

  return withLock(async () => {
    const creds = await getCredentials();
    if (!creds?.refreshToken) {
      debug('cannot refresh: missing refreshToken');
      return null;
    }

    assertValidAccessToken(creds.accessToken);
    const response = await fetch(GRANOLA_REFRESH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.accessToken}`,
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ refresh_token: creds.refreshToken }),
    });

    if (!response.ok) {
      await response.body?.cancel();
      if ([400, 401, 403].includes(response.status)) return null;
      throw new ApiError('Could not refresh the Granola session. Try again.', response.status);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error('Granola returned invalid credentials during token refresh.');
    }
    if (
      !data ||
      typeof data !== 'object' ||
      !('access_token' in data) ||
      typeof data.access_token !== 'string' ||
      !data.access_token ||
      ('refresh_token' in data && (typeof data.refresh_token !== 'string' || !data.refresh_token))
    ) {
      throw new Error('Granola returned invalid credentials during token refresh.');
    }
    const newCreds: Credentials = {
      refreshToken:
        'refresh_token' in data && typeof data.refresh_token === 'string'
          ? data.refresh_token
          : creds.refreshToken,
      accessToken: data.access_token,
      clientId: creds.clientId || DEFAULT_CLIENT_ID,
    };

    await saveCredentials(newCreds);
    debug('token refresh successful, new credentials saved');
    return newCreds;
  });
}

function parseTokenValues(value: unknown): Credentials | null {
  const tokens: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null;
  if ('access_token' in tokens && typeof tokens.access_token !== 'string') return null;
  if ('refresh_token' in tokens && typeof tokens.refresh_token !== 'string') return null;
  if ('client_id' in tokens && typeof tokens.client_id !== 'string') return null;

  const accessToken =
    'access_token' in tokens && typeof tokens.access_token === 'string' ? tokens.access_token : '';
  const refreshToken =
    'refresh_token' in tokens && typeof tokens.refresh_token === 'string'
      ? tokens.refresh_token
      : '';
  if (!accessToken && !refreshToken) return null;

  return {
    refreshToken,
    accessToken,
    clientId:
      'client_id' in tokens && typeof tokens.client_id === 'string' && tokens.client_id
        ? tokens.client_id
        : DEFAULT_CLIENT_ID,
  };
}

export function parseSupabaseJson(json: string): Credentials | null {
  debug('parsing credentials');
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    if ('workos_tokens' in parsed) {
      const workos = parseTokenValues(parsed.workos_tokens);
      if (workos?.accessToken) return workos;
    }
    if ('tokens' in parsed) {
      const tokens = parseTokenValues(parsed.tokens);
      if (tokens?.accessToken) return tokens;
    }
    if ('cognito_tokens' in parsed) {
      const cognito = parseTokenValues(parsed.cognito_tokens);
      if (cognito?.refreshToken) return cognito;
    }

    const legacy = parseTokenValues(parsed);
    return legacy?.refreshToken ? legacy : null;
  } catch {
    debug('could not parse credentials');
    return null;
  }
}

/**
 * Gets the default path to the Granola supabase.json file based on the OS.
 *
 * @returns The platform-specific path to supabase.json
 */
export function getDefaultSupabasePath(): string {
  const home = homedir();
  const os = platform();

  let path: string;
  switch (os) {
    case 'darwin':
      path = join(home, 'Library', 'Application Support', 'Granola', 'supabase.json');
      break;
    case 'win32':
      path = join(
        process.env.APPDATA || join(home, 'AppData', 'Roaming'),
        'Granola',
        'supabase.json',
      );
      break;
    default:
      path = join(home, '.config', 'granola', 'supabase.json');
  }
  debug('platform: %s, supabase path: %s', os, path);
  return path;
}

/**
 * Loads credentials from the default Granola supabase.json file.
 *
 * @returns Credentials if found and valid, null otherwise
 */
export async function loadCredentialsFromFile(): Promise<Credentials | null> {
  const path = getDefaultSupabasePath();
  debug('loading credentials from file: %s', path);
  try {
    const content = await readFile(path, 'utf-8');
    debug('file read successful, parsing content');
    return parseSupabaseJson(content);
  } catch (error) {
    debug('failed to load credentials from file: %O', error);
    return null;
  }
}

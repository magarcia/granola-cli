import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Credentials } from '../../src/types.js';

// Mock cross-keychain at the top level using hoisted mock
vi.mock('cross-keychain', () => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
}));

// Mock node:os for platform-specific path tests
vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
  platform: vi.fn(() => 'linux'),
}));

// Mock node:fs/promises for file-based credential tests
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

// Mock lock module to avoid file system operations in tests
vi.mock('../../src/lib/lock.js', () => ({
  withLock: vi.fn((operation: () => Promise<unknown>) => operation()),
}));

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
// Import the mocked module to access mock functions
import * as crossKeychain from 'cross-keychain';
// Import auth module after mocking
import {
  deleteCredentials,
  getAuthenticatedCredentials,
  getCredentials,
  getDefaultSupabasePath,
  loadCredentialsFromFile,
  parseSupabaseJson,
  refreshAccessToken,
  saveCredentials,
  validateCredentials,
} from '../../src/lib/auth.js';
import { withLock } from '../../src/lib/lock.js';

describe('auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCredentials', () => {
    it('should return credentials when stored', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'test-refresh-token',
        accessToken: 'test-access-token',
        clientId: 'test-client-id',
      });

      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      const result = await getCredentials();

      expect(crossKeychain.getPassword).toHaveBeenCalledWith('com.granola.cli', 'credentials');
      expect(result).toEqual({
        refreshToken: 'test-refresh-token',
        accessToken: 'test-access-token',
        clientId: 'test-client-id',
      });
    });

    it('should return null when no credentials stored', async () => {
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(null);

      const result = await getCredentials();

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      vi.mocked(crossKeychain.getPassword).mockRejectedValue(new Error('Keychain error'));

      const result = await getCredentials();

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      vi.mocked(crossKeychain.getPassword).mockResolvedValue('not-valid-json');

      const result = await getCredentials();

      expect(result).toBeNull();
    });

    it('should handle credentials without accessToken', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'test-refresh-token',
        clientId: 'test-client-id',
      });

      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      const result = await getCredentials();

      expect(result).toEqual({
        refreshToken: 'test-refresh-token',
        accessToken: '',
        clientId: 'test-client-id',
      });
    });
  });

  describe('saveCredentials', () => {
    it('rejects malformed access tokens before storing them', async () => {
      const creds = {
        accessToken: 'private-token\ninvalid',
        refreshToken: 'refresh',
        clientId: 'client',
      };
      await expect(saveCredentials(creds)).rejects.toThrow('Invalid Granola access token.');
      expect(crossKeychain.setPassword).not.toHaveBeenCalled();
    });
    it('should save credentials to keychain', async () => {
      vi.mocked(crossKeychain.setPassword).mockResolvedValue(undefined);

      const creds: Credentials = {
        refreshToken: 'new-refresh-token',
        accessToken: 'new-access-token',
        clientId: 'new-client-id',
      };

      await saveCredentials(creds);

      expect(crossKeychain.setPassword).toHaveBeenCalledWith(
        'com.granola.cli',
        'credentials',
        JSON.stringify(creds),
      );
    });

    it('should throw on keychain error', async () => {
      vi.mocked(crossKeychain.setPassword).mockRejectedValue(new Error('Keychain error'));

      const creds: Credentials = {
        refreshToken: 'token',
        accessToken: 'access',
        clientId: 'client',
      };

      await expect(saveCredentials(creds)).rejects.toThrow('Keychain error');
    });
  });

  describe('credential validation', () => {
    const mockFetch = vi.fn();
    const creds = { accessToken: 'access', refreshToken: 'refresh', clientId: 'client' };

    beforeEach(() => {
      globalThis.fetch = mockFetch;
      mockFetch.mockReset();
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(JSON.stringify(creds));
      vi.mocked(crossKeychain.setPassword).mockResolvedValue(undefined);
    });

    it('validates the access token against Granola', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      expect(await validateCredentials(creds)).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.granola.ai/v1/get-user-info',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access' },
          body: '{}',
        }),
      );
    });

    it('rejects an expired token', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });
      expect(await validateCredentials(creds)).toBe(false);
    });

    it.each([
      '\n',
      '\0',
      '\u0100',
    ])('does not expose malformed access tokens containing %j', async (separator) => {
      mockFetch.mockImplementation((_url, options) => {
        new Headers(options.headers);
        return { ok: true, status: 200 };
      });
      await expect(
        validateCredentials({ ...creds, accessToken: `private-token${separator}invalid` }),
      ).rejects.toThrow('Invalid Granola access token.');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not report network failures as logged out', async () => {
      mockFetch.mockRejectedValue(new Error('fetch failed'));
      await expect(validateCredentials(creds)).rejects.toThrow('fetch failed');
    });

    it('does not report server failures as logged out', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 503 });
      await expect(validateCredentials(creds)).rejects.toMatchObject({ status: 503 });
    });

    it('returns an authenticated stored session only after server validation', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      expect(await getAuthenticatedCredentials()).toEqual(creds);
    });

    it('returns null when no credentials are stored', async () => {
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(null);
      expect(await getAuthenticatedCredentials()).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('recovers an expired session and persists the rotated tokens', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh' }),
        })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      expect(await getAuthenticatedCredentials()).toEqual({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        clientId: 'client',
      });
      expect(crossKeychain.setPassword).toHaveBeenCalledWith(
        'com.granola.cli',
        'credentials',
        JSON.stringify({
          refreshToken: 'new-refresh',
          accessToken: 'new-access',
          clientId: 'client',
        }),
      );
    });

    it('returns null for a session that cannot be refreshed', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });
      expect(await getAuthenticatedCredentials()).toBeNull();
    });
  });

  describe('deleteCredentials', () => {
    it('should delete credentials from keychain', async () => {
      vi.mocked(crossKeychain.deletePassword).mockResolvedValue(undefined);

      await deleteCredentials();

      expect(crossKeychain.deletePassword).toHaveBeenCalledWith('com.granola.cli', 'credentials');
    });

    it('should not throw if credentials do not exist', async () => {
      vi.mocked(crossKeychain.deletePassword).mockResolvedValue(undefined);

      await expect(deleteCredentials()).resolves.toBeUndefined();
    });
  });

  describe('parseSupabaseJson', () => {
    it.each([
      { workos_tokens: { access_token: 'access', refresh_token: 'refresh' } },
      { tokens: { access_token: 'access', refresh_token: 'refresh' } },
    ])('parses structured browser token responses %j', (payload) => {
      expect(parseSupabaseJson(JSON.stringify(payload))).toEqual({
        accessToken: 'access',
        refreshToken: 'refresh',
        clientId: 'client_GranolaMac',
      });
    });

    it.each([
      null,
      [],
      { workos_tokens: JSON.stringify({ access_token: 42 }) },
      { refresh_token: { invalid: true } },
    ])('rejects malformed token values %j', (payload) => {
      expect(parseSupabaseJson(JSON.stringify(payload))).toBeNull();
    });

    it('should parse valid Supabase JSON with WorkOS tokens', () => {
      const supabaseJson = {
        workos_tokens: JSON.stringify({
          access_token: 'workos-access-token',
          refresh_token: 'workos-refresh-token',
        }),
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'workos-refresh-token',
        accessToken: 'workos-access-token',
        clientId: 'client_GranolaMac',
      });
    });

    it('should fall back to Cognito tokens when WorkOS not available', () => {
      const supabaseJson = {
        cognito_tokens: JSON.stringify({
          refresh_token: 'cognito-refresh-token',
          access_token: 'cognito-access-token',
          client_id: 'cognito-client-id',
        }),
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'cognito-refresh-token',
        accessToken: 'cognito-access-token',
        clientId: 'cognito-client-id',
      });
    });

    it('should parse legacy format with root-level tokens', () => {
      const supabaseJson = {
        refresh_token: 'supabase-refresh-token',
        access_token: 'supabase-access-token',
        client_id: 'supabase-client-id',
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'supabase-refresh-token',
        accessToken: 'supabase-access-token',
        clientId: 'supabase-client-id',
      });
    });

    it('should return null for invalid JSON', () => {
      const result = parseSupabaseJson('not valid json');
      expect(result).toBeNull();
    });

    it('should return null for missing refresh_token in legacy format', () => {
      const supabaseJson = {
        client_id: 'supabase-client-id',
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));
      expect(result).toBeNull();
    });

    it('should handle missing client_id with default in legacy format', () => {
      const supabaseJson = {
        refresh_token: 'supabase-refresh-token',
        access_token: 'supabase-access-token',
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'supabase-refresh-token',
        accessToken: 'supabase-access-token',
        clientId: 'client_GranolaMac',
      });
    });

    it('should handle missing access_token in legacy format', () => {
      const supabaseJson = {
        refresh_token: 'supabase-refresh-token',
        client_id: 'supabase-client-id',
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'supabase-refresh-token',
        accessToken: '',
        clientId: 'supabase-client-id',
      });
    });

    it('should handle WorkOS tokens without refresh_token', () => {
      const supabaseJson = {
        workos_tokens: JSON.stringify({
          access_token: 'workos-access-token',
          client_id: 'workos-client-id',
        }),
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: '',
        accessToken: 'workos-access-token',
        clientId: 'workos-client-id',
      });
    });

    it('should handle WorkOS tokens without client_id', () => {
      const supabaseJson = {
        workos_tokens: JSON.stringify({
          access_token: 'workos-access-token',
          refresh_token: 'workos-refresh-token',
        }),
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'workos-refresh-token',
        accessToken: 'workos-access-token',
        clientId: 'client_GranolaMac',
      });
    });

    it('should handle Cognito tokens without access_token', () => {
      const supabaseJson = {
        cognito_tokens: JSON.stringify({
          refresh_token: 'cognito-refresh-token',
          client_id: 'cognito-client-id',
        }),
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'cognito-refresh-token',
        accessToken: '',
        clientId: 'cognito-client-id',
      });
    });

    it('should handle Cognito tokens without client_id', () => {
      const supabaseJson = {
        cognito_tokens: JSON.stringify({
          refresh_token: 'cognito-refresh-token',
          access_token: 'cognito-access-token',
        }),
      };

      const result = parseSupabaseJson(JSON.stringify(supabaseJson));

      expect(result).toEqual({
        refreshToken: 'cognito-refresh-token',
        accessToken: 'cognito-access-token',
        clientId: 'client_GranolaMac',
      });
    });
  });

  describe('getDefaultSupabasePath', () => {
    it('should return macOS path when on darwin', () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');

      const result = getDefaultSupabasePath();

      expect(result).toBe('/Users/testuser/Library/Application Support/Granola/supabase.json');
    });

    it('should return Windows path using APPDATA when available', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(os.homedir).mockReturnValue('C:\\Users\\testuser');
      const originalAppData = process.env.APPDATA;
      process.env.APPDATA = 'C:\\Users\\testuser\\AppData\\Roaming';

      const result = getDefaultSupabasePath();

      expect(result).toContain('Granola');
      expect(result).toContain('supabase.json');
      expect(result).toContain('AppData');

      process.env.APPDATA = originalAppData;
    });

    it('should return Windows path with fallback when APPDATA not set', () => {
      vi.mocked(os.platform).mockReturnValue('win32');
      vi.mocked(os.homedir).mockReturnValue('C:\\Users\\testuser');
      const originalAppData = process.env.APPDATA;
      delete process.env.APPDATA;

      const result = getDefaultSupabasePath();

      expect(result).toContain('Granola');
      expect(result).toContain('supabase.json');

      process.env.APPDATA = originalAppData;
    });

    it('should return Linux path for other platforms', () => {
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.mocked(os.homedir).mockReturnValue('/home/testuser');

      const result = getDefaultSupabasePath();

      expect(result).toBe('/home/testuser/.config/granola/supabase.json');
    });
  });

  describe('loadCredentialsFromFile', () => {
    it('should return credentials when file exists and is valid', async () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');

      const validSupabaseJson = JSON.stringify({
        refresh_token: 'file-refresh-token',
        access_token: 'file-access-token',
        client_id: 'file-client-id',
      });
      vi.mocked(fs.readFile).mockResolvedValue(validSupabaseJson);

      const result = await loadCredentialsFromFile();

      expect(result).toEqual({
        refreshToken: 'file-refresh-token',
        accessToken: 'file-access-token',
        clientId: 'file-client-id',
      });
    });

    it('should return null when file does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const result = await loadCredentialsFromFile();

      expect(result).toBeNull();
    });

    it('should return null when file contains invalid JSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('not valid json');

      const result = await loadCredentialsFromFile();

      expect(result).toBeNull();
    });
  });

  describe('refreshAccessToken', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      globalThis.fetch = mockFetch;
      mockFetch.mockReset();
    });

    it('should refresh token and save new credentials', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);
      vi.mocked(crossKeychain.setPassword).mockResolvedValue(undefined);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          }),
      });

      const result = await refreshAccessToken();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.granola.ai/v1/refresh-access-token',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer old-access-token',
          },
          body: JSON.stringify({
            refresh_token: 'old-refresh-token',
          }),
        }),
      );

      expect(result).toEqual({
        refreshToken: 'new-refresh-token',
        accessToken: 'new-access-token',
        clientId: 'test-client-id',
      });

      expect(crossKeychain.setPassword).toHaveBeenCalledWith(
        'com.granola.cli',
        'credentials',
        JSON.stringify({
          refreshToken: 'new-refresh-token',
          accessToken: 'new-access-token',
          clientId: 'test-client-id',
        }),
      );
    });

    it('should return null when no credentials stored', async () => {
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(null);

      const result = await refreshAccessToken();

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null when missing refreshToken', async () => {
      const storedCreds = JSON.stringify({
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      const result = await refreshAccessToken();

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should refresh without requiring a WorkOS client ID', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
        }),
      });

      const result = await refreshAccessToken();

      expect(result?.accessToken).toBe('new-access-token');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should return null when WorkOS returns error', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await refreshAccessToken();

      expect(result).toBeNull();
      expect(crossKeychain.setPassword).not.toHaveBeenCalled();
    });

    it('should propagate network errors instead of reporting an invalid session', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(refreshAccessToken()).rejects.toThrow('Network error');
      expect(crossKeychain.setPassword).not.toHaveBeenCalled();
    });

    it('should use file lock to prevent race conditions', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);
      vi.mocked(crossKeychain.setPassword).mockResolvedValue(undefined);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
          }),
      });

      await refreshAccessToken();

      expect(withLock).toHaveBeenCalledTimes(1);
      expect(withLock).toHaveBeenCalledWith(expect.any(Function));
    });

    it.each([
      null,
      {},
      { access_token: '' },
      { access_token: 42 },
      { access_token: 'new', refresh_token: '' },
    ])('should not overwrite credentials with an invalid refresh response %j', async (data) => {
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(
        JSON.stringify({
          refreshToken: 'old-refresh-token',
          accessToken: 'old-access-token',
          clientId: 'client',
        }),
      );
      mockFetch.mockResolvedValue({ ok: true, json: async () => data });

      await expect(refreshAccessToken()).rejects.toThrow(/invalid credentials/i);
      expect(crossKeychain.setPassword).not.toHaveBeenCalled();
    });

    it('should preserve the refresh token when the response does not rotate it', async () => {
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(
        JSON.stringify({
          refreshToken: 'old-refresh-token',
          accessToken: 'old-access-token',
          clientId: 'client',
        }),
      );
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'new-access-token' }),
      });

      expect((await refreshAccessToken())?.refreshToken).toBe('old-refresh-token');
    });

    it('should propagate lock failures instead of reporting an invalid session', async () => {
      vi.mocked(withLock).mockRejectedValueOnce(new Error('Failed to acquire token refresh lock'));

      await expect(refreshAccessToken()).rejects.toThrow('Failed to acquire token refresh lock');
    });

    it('should propagate a server outage during refresh', async () => {
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(
        JSON.stringify({
          refreshToken: 'refresh',
          accessToken: 'access',
          clientId: 'client',
        }),
      );
      mockFetch.mockResolvedValue({ ok: false, status: 503 });
      await expect(refreshAccessToken()).rejects.toMatchObject({ status: 503 });
      expect(crossKeychain.setPassword).not.toHaveBeenCalled();
    });

    it('does not expose a malformed refresh response in an error', async () => {
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(
        JSON.stringify({
          refreshToken: 'refresh',
          accessToken: 'access',
          clientId: 'client',
        }),
      );
      mockFetch.mockResolvedValue(new Response('private-refresh-response'));
      await expect(refreshAccessToken()).rejects.toThrow(
        'Granola returned invalid credentials during token refresh.',
      );
      expect(crossKeychain.setPassword).not.toHaveBeenCalled();
    });
  });
});

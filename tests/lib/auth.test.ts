import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Credentials } from '../../src/types.js';

// Mock cross-keychain at the top level using hoisted mock
vi.mock('cross-keychain', () => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
}));

// Mock child_process for macOS safeStorage keychain lookups
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
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

import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
// Import the mocked module to access mock functions
import * as crossKeychain from 'cross-keychain';
// Import auth module after mocking
import {
  deleteCredentials,
  getCredentials,
  getDefaultSupabasePath,
  loadCredentialsFromFile,
  parseSupabaseJson,
  refreshAccessToken,
  saveCredentials,
} from '../../src/lib/auth.js';
import { withLock } from '../../src/lib/lock.js';

function encryptMacSafeStorageValue(value: string, password: string): Buffer {
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.from(' '.repeat(16)));
  return Buffer.concat([Buffer.from('v10'), cipher.update(value, 'utf8'), cipher.final()]);
}

function encryptGranolaStorage(value: string, dek: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv, { authTagLength: 16 });
  return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
}

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
      vi.mocked(os.platform).mockReturnValue('linux');
      vi.mocked(os.homedir).mockReturnValue('/home/testuser');

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

    it('should import credentials from encrypted Granola storage when available', async () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');

      const password = 'test-safe-storage-password';
      const dek = randomBytes(32);
      const encryptedDek = encryptMacSafeStorageValue(dek.toString('base64'), password);
      const encryptedSupabaseJson = encryptGranolaStorage(
        JSON.stringify({
          workos_tokens: JSON.stringify({
            access_token: 'encrypted-access-token',
            refresh_token: 'encrypted-refresh-token',
            client_id: 'encrypted-client-id',
          }),
        }),
        dek,
      );

      vi.mocked(childProcess.execFileSync).mockReturnValue(`${password}\n`);
      vi.mocked(fs.readFile).mockImplementation((async (path) => {
        if (String(path).endsWith('supabase.json.enc')) return encryptedSupabaseJson;
        if (String(path).endsWith('storage.dek')) return encryptedDek;
        throw new Error(`Unexpected path: ${String(path)}`);
      }) as typeof fs.readFile);

      const result = await loadCredentialsFromFile();

      expect(childProcess.execFileSync).toHaveBeenCalledWith(
        'security',
        ['find-generic-password', '-w', '-s', 'Granola Safe Storage', '-a', 'Granola Key'],
        { encoding: 'utf8' },
      );
      expect(result).toEqual({
        refreshToken: 'encrypted-refresh-token',
        accessToken: 'encrypted-access-token',
        clientId: 'encrypted-client-id',
      });
    });

    it('should prefer encrypted credentials over stale plaintext credentials', async () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');

      const password = 'test-safe-storage-password';
      const dek = randomBytes(32);
      const encryptedDek = encryptMacSafeStorageValue(dek.toString('base64'), password);
      const encryptedSupabaseJson = encryptGranolaStorage(
        JSON.stringify({
          workos_tokens: JSON.stringify({
            access_token: 'current-access-token',
            refresh_token: 'current-refresh-token',
          }),
        }),
        dek,
      );

      vi.mocked(childProcess.execFileSync).mockReturnValue(`${password}\n`);
      vi.mocked(fs.readFile).mockImplementation((async (path, encoding) => {
        const pathString = String(path);
        if (pathString.endsWith('supabase.json.enc')) return encryptedSupabaseJson;
        if (pathString.endsWith('storage.dek')) return encryptedDek;
        if (pathString.endsWith('supabase.json') && encoding === 'utf-8') {
          return JSON.stringify({
            refresh_token: 'stale-refresh-token',
            access_token: 'stale-access-token',
          });
        }
        throw new Error(`Unexpected path: ${pathString}`);
      }) as typeof fs.readFile);

      const result = await loadCredentialsFromFile();

      expect(result).toEqual({
        refreshToken: 'current-refresh-token',
        accessToken: 'current-access-token',
        clientId: 'client_GranolaMac',
      });
    });

    it('should fall back to plaintext credentials when encrypted storage is unavailable', async () => {
      vi.mocked(os.platform).mockReturnValue('darwin');
      vi.mocked(os.homedir).mockReturnValue('/Users/testuser');

      vi.mocked(fs.readFile).mockImplementation((async (path, encoding) => {
        const pathString = String(path);
        if (pathString.endsWith('supabase.json.enc')) {
          throw new Error('ENOENT: no such file or directory');
        }
        if (pathString.endsWith('supabase.json') && encoding === 'utf-8') {
          return JSON.stringify({
            refresh_token: 'plaintext-refresh-token',
            access_token: 'plaintext-access-token',
          });
        }
        throw new Error(`Unexpected path: ${pathString}`);
      }) as typeof fs.readFile);

      const result = await loadCredentialsFromFile();

      expect(childProcess.execFileSync).not.toHaveBeenCalled();
      expect(result).toEqual({
        refreshToken: 'plaintext-refresh-token',
        accessToken: 'plaintext-access-token',
        clientId: 'client_GranolaMac',
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
        'https://api.workos.com/user_management/authenticate',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: 'test-client-id',
            grant_type: 'refresh_token',
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

    it('should return null when missing clientId', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      const result = await refreshAccessToken();

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
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

    it('should return null on network error', async () => {
      const storedCreds = JSON.stringify({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token',
        clientId: 'test-client-id',
      });
      vi.mocked(crossKeychain.getPassword).mockResolvedValue(storedCreds);

      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await refreshAccessToken();

      expect(result).toBeNull();
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

    it('should return null when lock acquisition fails', async () => {
      vi.mocked(withLock).mockRejectedValueOnce(new Error('Failed to acquire token refresh lock'));

      const result = await refreshAccessToken();

      expect(result).toBeNull();
    });
  });
});

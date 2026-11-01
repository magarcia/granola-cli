import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoginCommand } from '../../../src/commands/auth/login.js';
import { captureConsole } from '../../setup.js';

vi.mock('../../../src/lib/auth.js', () => ({
  getAuthenticatedCredentials: vi.fn(),
  saveCredentials: vi.fn(),
  loadCredentialsFromFile: vi.fn(),
  validateCredentials: vi.fn(),
}));
vi.mock('../../../src/lib/browser-auth.js', () => ({ loginWithBrowser: vi.fn() }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: vi.fn(actual.homedir), tmpdir: vi.fn(actual.tmpdir) };
});

import * as auth from '../../../src/lib/auth.js';
import { loginWithBrowser } from '../../../src/lib/browser-auth.js';
import { acquireLock, releaseLock } from '../../../src/lib/lock.js';

const tempDirectory = tmpdir();

describe('login command', () => {
  let console_: ReturnType<typeof captureConsole>;
  let directory: string;
  const creds = { refreshToken: 'token', accessToken: 'access', clientId: 'client' };

  function login(args: string[] = []) {
    return new Command()
      .addCommand(createLoginCommand())
      .parseAsync(['node', 'test', 'login', ...args]);
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    directory = await mkdtemp(join(tempDirectory, 'granola-login-test-'));
    vi.mocked(homedir).mockReturnValue(directory);
    vi.mocked(tmpdir).mockReturnValue(directory);
    console_ = captureConsole();
    vi.mocked(auth.getAuthenticatedCredentials).mockResolvedValue(null);
    vi.mocked(auth.loadCredentialsFromFile).mockResolvedValue(null);
    vi.mocked(auth.validateCredentials).mockResolvedValue(true);
    vi.mocked(loginWithBrowser).mockResolvedValue(creds);
  });

  afterEach(async () => {
    console_.restore();
    await rm(directory, { recursive: true, force: true });
  });

  it.each([
    'browser',
    'import',
  ])('waits for an ongoing refresh before saving %s credentials', async (source) => {
    if (source === 'import') vi.mocked(auth.loadCredentialsFromFile).mockResolvedValue(creds);
    const lock = await acquireLock();
    if (!lock) throw new Error('Could not acquire test lock');
    const pending = login(source === 'browser' ? ['--browser'] : []);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(auth.saveCredentials).not.toHaveBeenCalled();
    } finally {
      await releaseLock(lock);
      await pending;
    }
    expect(auth.saveCredentials).toHaveBeenCalledWith(creds);
  });

  it('keeps an existing working session', async () => {
    vi.mocked(auth.getAuthenticatedCredentials).mockResolvedValue(creds);
    await login();
    expect(auth.loadCredentialsFromFile).not.toHaveBeenCalled();
    expect(loginWithBrowser).not.toHaveBeenCalled();
    expect(auth.saveCredentials).not.toHaveBeenCalled();
    expect(console_.logs.join('\n')).toContain('Already authenticated');
  });

  it('imports legacy desktop credentials only after validation', async () => {
    vi.mocked(auth.loadCredentialsFromFile).mockResolvedValue(creds);
    await login();
    expect(auth.validateCredentials).toHaveBeenCalledWith(creds);
    expect(auth.saveCredentials).toHaveBeenCalledWith(creds);
    expect(loginWithBrowser).not.toHaveBeenCalled();
    expect(console_.logs.join('\n')).toContain('Credentials imported successfully');
  });

  it('uses browser login when desktop plaintext files are unavailable', async () => {
    await login();
    expect(loginWithBrowser).toHaveBeenCalledWith({ provider: 'google', autoCallback: true });
    expect(auth.validateCredentials).toHaveBeenCalledWith(creds);
    expect(auth.saveCredentials).toHaveBeenCalledWith(creds);
  });

  it('uses browser login instead of importing stale desktop credentials', async () => {
    const stale = { ...creds, accessToken: 'stale' };
    vi.mocked(auth.loadCredentialsFromFile).mockResolvedValue(stale);
    vi.mocked(auth.validateCredentials).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await login();
    expect(loginWithBrowser).toHaveBeenCalled();
    expect(auth.saveCredentials).toHaveBeenCalledTimes(1);
    expect(auth.saveCredentials).toHaveBeenCalledWith(creds);
  });

  it('can explicitly start a new Microsoft browser session', async () => {
    await login(['--browser', '--provider', 'microsoft']);
    expect(auth.getAuthenticatedCredentials).not.toHaveBeenCalled();
    expect(auth.loadCredentialsFromFile).not.toHaveBeenCalled();
    expect(loginWithBrowser).toHaveBeenCalledWith({ provider: 'microsoft', autoCallback: true });
    expect(auth.saveCredentials).toHaveBeenCalledWith(creds);
  });

  it('can start a new browser session with manual callback paste', async () => {
    await login(['--browser', '--no-auto-callback']);
    expect(auth.getAuthenticatedCredentials).not.toHaveBeenCalled();
    expect(auth.loadCredentialsFromFile).not.toHaveBeenCalled();
    expect(loginWithBrowser).toHaveBeenCalledWith({ provider: 'google', autoCallback: false });
    expect(auth.saveCredentials).toHaveBeenCalledWith(creds);
  });

  it('does not save invalid browser credentials', async () => {
    vi.mocked(auth.validateCredentials).mockResolvedValue(false);
    await expect(login(['--browser'])).rejects.toMatchObject({ status: 401 });
    expect(auth.saveCredentials).not.toHaveBeenCalled();
    expect(console_.logs).toEqual([]);
  });

  it('preserves the current credentials when browser login is cancelled', async () => {
    vi.mocked(loginWithBrowser).mockRejectedValue(new Error('Login cancelled'));
    await expect(login(['--browser'])).rejects.toThrow('Login cancelled');
    expect(auth.saveCredentials).not.toHaveBeenCalled();
  });

  it('does not save credentials when verification fails because of the network', async () => {
    vi.mocked(auth.validateCredentials).mockRejectedValue(new Error('fetch failed'));
    await expect(login(['--browser'])).rejects.toThrow('fetch failed');
    expect(auth.saveCredentials).not.toHaveBeenCalled();
  });

  it('rejects unknown providers before starting authentication', async () => {
    await expect(login(['--provider', 'unknown'])).rejects.toThrow(/google.*microsoft/i);
    expect(auth.getAuthenticatedCredentials).not.toHaveBeenCalled();
    expect(loginWithBrowser).not.toHaveBeenCalled();
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

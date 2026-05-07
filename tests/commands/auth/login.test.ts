import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoginCommand } from '../../../src/commands/auth/login.js';
import { captureConsole } from '../../setup.js';

vi.mock('../../../src/lib/auth.js', () => ({
  saveCredentials: vi.fn(),
  loadCredentialsFromFile: vi.fn(),
  getDefaultSupabasePath: vi.fn(() => '/mock/path/supabase.json'),
  getDefaultStoredAccountsPath: vi.fn(() => '/mock/path/stored-accounts.json'),
}));

import * as auth from '../../../src/lib/auth.js';

describe('login command', () => {
  let console_: ReturnType<typeof captureConsole>;
  let mockExit: any;

  beforeEach(() => {
    vi.clearAllMocks();
    console_ = captureConsole();
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    console_.restore();
    mockExit.mockRestore();
  });

  it('should import credentials from desktop app', async () => {
    vi.mocked(auth.loadCredentialsFromFile).mockResolvedValue({
      refreshToken: 'token',
      accessToken: 'access',
      clientId: 'client',
    });

    const program = new Command();
    program.addCommand(createLoginCommand());
    await program.parseAsync(['node', 'test', 'login']);

    expect(auth.loadCredentialsFromFile).toHaveBeenCalled();
    expect(auth.saveCredentials).toHaveBeenCalledWith({
      refreshToken: 'token',
      accessToken: 'access',
      clientId: 'client',
    });
    expect(console_.logs.some((log) => /Credentials imported/i.test(log))).toBe(true);
  });

  it('should exit with code 1 when credentials not found', async () => {
    vi.mocked(auth.loadCredentialsFromFile).mockResolvedValue(null);

    const program = new Command();
    program.addCommand(createLoginCommand());

    await expect(program.parseAsync(['node', 'test', 'login'])).rejects.toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(console_.errors.some((log) => /Could not load credentials/i.test(log))).toBe(true);
  });

  it('should show both paths in error message when credentials not found', async () => {
    vi.mocked(auth.loadCredentialsFromFile).mockResolvedValue(null);

    const program = new Command();
    program.addCommand(createLoginCommand());

    await expect(program.parseAsync(['node', 'test', 'login'])).rejects.toThrow('process.exit');
    expect(console_.errors.some((log) => /\/mock\/path\/stored-accounts\.json/i.test(log))).toBe(
      true,
    );
    expect(console_.errors.some((log) => /\/mock\/path\/supabase\.json/i.test(log))).toBe(true);
  });
});

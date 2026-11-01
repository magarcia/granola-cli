import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStatusCommand } from '../../../src/commands/auth/status.js';
import { captureConsole, mockProcessExit } from '../../setup.js';

vi.mock('../../../src/lib/auth.js', () => ({
  getAuthenticatedCredentials: vi.fn(),
}));

import * as auth from '../../../src/lib/auth.js';

describe('auth status command', () => {
  let console_: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    vi.clearAllMocks();
    console_ = captureConsole();
  });

  afterEach(() => {
    console_.restore();
  });

  it('should show authenticated when credentials exist', async () => {
    vi.mocked(auth.getAuthenticatedCredentials).mockResolvedValue({
      refreshToken: 'token',
      accessToken: 'access',
      clientId: 'client',
    });

    const program = new Command();
    program.addCommand(createStatusCommand());
    await program.parseAsync(['node', 'test', 'status']);

    expect(console_.logs.some((log) => /Authenticated/i.test(log))).toBe(true);
  });

  it('should show not authenticated when no credentials', async () => {
    vi.mocked(auth.getAuthenticatedCredentials).mockResolvedValue(null);

    const program = new Command();
    program.addCommand(createStatusCommand());
    await program.parseAsync(['node', 'test', 'status']);

    expect(console_.logs.some((log) => /Not authenticated/i.test(log))).toBe(true);
  });

  it('should output JSON when --output json is set', async () => {
    vi.mocked(auth.getAuthenticatedCredentials).mockResolvedValue({
      refreshToken: 'token',
      accessToken: 'access',
      clientId: 'client',
    });

    const program = new Command();
    program.addCommand(createStatusCommand());
    await program.parseAsync(['node', 'test', 'status', '--output', 'json']);

    const jsonOutput = console_.logs.find((log) => {
      try {
        JSON.parse(log);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput!);
    expect(parsed.authenticated).toBe(true);
  });

  it('should reject invalid output formats', async () => {
    vi.mocked(auth.getAuthenticatedCredentials).mockResolvedValue(null);
    const exit = mockProcessExit();

    const program = new Command();
    program.addCommand(createStatusCommand());

    await expect(
      program.parseAsync(['node', 'test', 'status', '--output', 'invalid']),
    ).rejects.toThrow(/process\.exit/i);

    expect(console_.errors.some((log) => /invalid format/i.test(log))).toBe(true);
    expect(exit.exitCodes).toContain(1);
    expect(auth.getAuthenticatedCredentials).not.toHaveBeenCalled();
    exit.restore();
  });

  it('reports false when stored credentials are no longer valid', async () => {
    vi.mocked(auth.getAuthenticatedCredentials).mockResolvedValue(null);
    const program = new Command().addCommand(createStatusCommand());
    await program.parseAsync(['node', 'test', 'status', '--output', 'json']);
    expect(JSON.parse(console_.logs[0])).toEqual({ authenticated: false });
  });

  it('propagates a verification outage instead of reporting authentication success', async () => {
    vi.mocked(auth.getAuthenticatedCredentials).mockRejectedValue(new Error('fetch failed'));
    const program = new Command().addCommand(createStatusCommand());
    await expect(program.parseAsync(['node', 'test', 'status'])).rejects.toThrow('fetch failed');
    expect(console_.logs).toEqual([]);
  });
});

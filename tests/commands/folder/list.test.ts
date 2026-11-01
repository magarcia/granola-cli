import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createListCommand } from '../../../src/commands/folder/list.js';
import { mockFolders } from '../../fixtures/folders.js';
import { captureConsole, mockProcessExit } from '../../setup.js';

vi.mock('../../../src/services/folders.js', () => ({
  list: vi.fn(),
}));

import * as folders from '../../../src/services/folders.js';

describe('folder list command', () => {
  let console_: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    vi.clearAllMocks();
    console_ = captureConsole();
  });

  afterEach(() => {
    console_.restore();
  });

  it('should list folders', async () => {
    vi.mocked(folders.list).mockResolvedValue(mockFolders);

    const program = new Command();
    program.addCommand(createListCommand());
    await program.parseAsync(['node', 'test', 'list']);

    expect(folders.list).toHaveBeenCalledWith({ workspace: undefined });
    expect(console_.logs.some((log) => /sales calls/i.test(log) || /folder/i.test(log))).toBe(true);
  });

  it('should filter by workspace', async () => {
    vi.mocked(folders.list).mockResolvedValue([mockFolders[1]]);

    const program = new Command();
    program.addCommand(createListCommand());
    await program.parseAsync(['node', 'test', 'list', '--workspace', 'abc12345']);

    expect(folders.list).toHaveBeenCalledWith({ workspace: 'abc12345' });
  });

  it('should show workspace names and fall back to workspace IDs', async () => {
    vi.mocked(folders.list).mockResolvedValue([
      { ...mockFolders[0], workspace_name: 'Sales Team' },
      mockFolders[1],
      { ...mockFolders[2], workspace_id: undefined },
    ]);

    const program = new Command().addCommand(createListCommand());
    await program.parseAsync(['node', 'test', 'list']);

    const output = console_.logs.join('\n');
    expect(output).toContain('Sales Team');
    expect(output).toContain('abc12345');
    expect(output).not.toMatch(/undefine/);
  });

  it('should output JSON when --output json is set', async () => {
    vi.mocked(folders.list).mockResolvedValue(mockFolders);

    const program = new Command();
    program.addCommand(createListCommand());
    await program.parseAsync(['node', 'test', 'list', '--output', 'json']);

    const jsonOutput = console_.logs.find((log) => {
      try {
        JSON.parse(log);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonOutput).toBeDefined();
  });

  it('should show message when no folders found', async () => {
    vi.mocked(folders.list).mockResolvedValue([]);

    const program = new Command();
    program.addCommand(createListCommand());
    await program.parseAsync(['node', 'test', 'list']);

    expect(console_.logs.some((log) => /no folders found/i.test(log))).toBe(true);
  });

  it('should show error for invalid output format', async () => {
    vi.mocked(folders.list).mockResolvedValue(mockFolders);
    const exit = mockProcessExit();

    const program = new Command();
    program.addCommand(createListCommand());

    try {
      await program.parseAsync(['node', 'test', 'list', '--output', 'invalid']);
    } catch {
      // process.exit throws
    }

    expect(console_.errors.some((e) => /invalid format/i.test(e))).toBe(true);
    expect(exit.exitCodes).toContain(1);
    exit.restore();
  });

  it('should show error and exit when folder API fails', async () => {
    vi.mocked(folders.list).mockRejectedValue(new Error('API error'));
    const exit = mockProcessExit();

    const program = new Command();
    program.addCommand(createListCommand());

    await expect(program.parseAsync(['node', 'test', 'list'])).rejects.toThrow(/process\.exit/i);

    expect(console_.errors.some((log) => /failed to list folders/i.test(log))).toBe(true);
    expect(exit.exitCodes).toContain(1);
    exit.restore();
  });
});

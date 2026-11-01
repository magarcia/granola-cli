import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createViewCommand } from '../../../src/commands/folder/view.js';
import { mockFolder } from '../../fixtures/folders.js';
import { captureConsole } from '../../setup.js';

vi.mock('../../../src/services/folders.js', () => ({
  get: vi.fn(),
}));

import * as folders from '../../../src/services/folders.js';

describe('folder view command', () => {
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

  it('should view folder details', async () => {
    vi.mocked(folders.get).mockResolvedValue(mockFolder);

    const program = new Command();
    program.addCommand(createViewCommand());
    await program.parseAsync(['node', 'test', 'view', 'folder-id']);

    expect(folders.get).toHaveBeenCalledWith('folder-id');
    expect(console_.logs.some((log) => /sales calls/i.test(log))).toBe(true);
  });

  it('should output JSON when --output json is set', async () => {
    vi.mocked(folders.get).mockResolvedValue(mockFolder);

    const program = new Command();
    program.addCommand(createViewCommand());
    await program.parseAsync(['node', 'test', 'view', 'folder-id', '--output', 'json']);

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

  it('should use the API meeting count and workspace display name', async () => {
    vi.mocked(folders.get).mockResolvedValue({
      ...mockFolder,
      workspace_name: 'Sales Team',
      document_count: 12,
    });

    const program = new Command().addCommand(createViewCommand());
    await program.parseAsync(['node', 'test', 'view', 'folder-id']);

    expect(console_.logs).toContain('12 meetings · Workspace Sales Team');
  });

  it('should preserve an explicit zero meeting count and omit absent workspace details', async () => {
    vi.mocked(folders.get).mockResolvedValue({
      ...mockFolder,
      workspace_id: undefined,
      document_count: 0,
    });

    const program = new Command().addCommand(createViewCommand());
    await program.parseAsync(['node', 'test', 'view', 'folder-id']);

    expect(console_.logs).toContain('0 meetings');
    expect(console_.logs.join('\n')).not.toContain('undefined');
  });

  it('should exit with code 4 when folder not found', async () => {
    vi.mocked(folders.get).mockResolvedValue(null);

    const program = new Command();
    program.addCommand(createViewCommand());

    await expect(program.parseAsync(['node', 'test', 'view', 'nonexistent'])).rejects.toThrow(
      'process.exit',
    );
    expect(mockExit).toHaveBeenCalledWith(4);
  });

  it('should handle folders without name', async () => {
    vi.mocked(folders.get).mockResolvedValue({
      ...mockFolder,
      name: undefined,
      title: 'Folder Title',
    });

    const program = new Command();
    program.addCommand(createViewCommand());
    await program.parseAsync(['node', 'test', 'view', 'folder-id']);

    expect(console_.logs.some((log) => /folder title/i.test(log))).toBe(true);
  });

  it('should show error for invalid output format', async () => {
    vi.mocked(folders.get).mockResolvedValue(mockFolder);

    const program = new Command();
    program.addCommand(createViewCommand());

    await expect(
      program.parseAsync(['node', 'test', 'view', 'folder-id', '--output', 'invalid']),
    ).rejects.toThrow('process.exit');

    expect(console_.errors.some((e) => /invalid format/i.test(e))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should show error and exit when folder API fails', async () => {
    vi.mocked(folders.get).mockRejectedValue(new Error('API error'));

    const program = new Command();
    program.addCommand(createViewCommand());

    await expect(program.parseAsync(['node', 'test', 'view', 'folder-id'])).rejects.toThrow(
      /process\.exit/i,
    );

    expect(console_.errors.some((log) => /failed to load folder/i.test(log))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

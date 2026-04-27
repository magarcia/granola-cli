import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotesCommand } from '../../../src/commands/meeting/notes.js';
import { mockMeetingWithNotes } from '../../fixtures/meetings.js';
import { captureConsole } from '../../setup.js';

vi.mock('../../../src/services/meetings.js', () => ({
  getNotes: vi.fn(),
  resolveId: vi.fn(),
}));

vi.mock('../../../src/lib/pager.js', () => ({
  pipeToPager: vi.fn(),
}));

vi.mock('../../../src/lib/prosemirror.js', () => ({
  toMarkdown: vi.fn(() => 'Markdown content'),
}));

import { pipeToPager } from '../../../src/lib/pager.js';
import * as meetings from '../../../src/services/meetings.js';

describe('meeting notes command', () => {
  let console_: ReturnType<typeof captureConsole>;
  let originalIsTTY: boolean | undefined;
  let mockExit: any;

  beforeEach(() => {
    vi.clearAllMocks();
    console_ = captureConsole();
    originalIsTTY = process.stdout.isTTY;
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    console_.restore();
    (process.stdout as any).isTTY = originalIsTTY;
    mockExit.mockRestore();
  });

  it('should display meeting notes', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.getNotes).mockResolvedValue(mockMeetingWithNotes.notes!);

    try {
      (process.stdout as any).isTTY = false;

      const program = new Command();
      program.addCommand(createNotesCommand());
      await program.parseAsync(['node', 'test', 'notes', 'meeting-id']);

      expect(meetings.resolveId).toHaveBeenCalledWith('meeting-id');
      expect(meetings.getNotes).toHaveBeenCalledWith('meeting-id');
      expect(console_.logs.some((log) => /Markdown/i.test(log))).toBe(true);
    } finally {
      (process.stdout as any).isTTY = originalIsTTY;
    }
  });

  it('should use pager for TTY output', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.getNotes).mockResolvedValue(mockMeetingWithNotes.notes!);

    try {
      (process.stdout as any).isTTY = true;

      const program = new Command();
      program.addCommand(createNotesCommand());
      await program.parseAsync(['node', 'test', 'notes', 'meeting-id']);

      expect(pipeToPager).toHaveBeenCalled();
    } finally {
      (process.stdout as any).isTTY = originalIsTTY;
    }
  });

  it('should skip pager when not TTY', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.getNotes).mockResolvedValue(mockMeetingWithNotes.notes!);

    try {
      (process.stdout as any).isTTY = false;

      const program = new Command();
      program.addCommand(createNotesCommand());
      await program.parseAsync(['node', 'test', 'notes', 'meeting-id']);

      expect(pipeToPager).not.toHaveBeenCalled();
      expect(console_.logs.length).toBeGreaterThan(0);
    } finally {
      (process.stdout as any).isTTY = originalIsTTY;
    }
  });

  it('should output JSON when --output json is set', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.getNotes).mockResolvedValue(mockMeetingWithNotes.notes!);

    const program = new Command();
    program.addCommand(createNotesCommand());
    await program.parseAsync(['node', 'test', 'notes', 'meeting-id', '--output', 'json']);

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

  it('should output YAML when --output yaml is set', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.getNotes).mockResolvedValue(mockMeetingWithNotes.notes!);

    const program = new Command();
    program.addCommand(createNotesCommand());
    await program.parseAsync(['node', 'test', 'notes', 'meeting-id', '--output', 'yaml']);

    expect(console_.logs.some((log) => /type:\s+doc/i.test(log))).toBe(true);
  });

  it('should exit with code 4 when notes not found', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue(null);

    const program = new Command();
    program.addCommand(createNotesCommand());

    await expect(program.parseAsync(['node', 'test', 'notes', 'meeting-id'])).rejects.toThrow(
      'process.exit',
    );
    expect(mockExit).toHaveBeenCalledWith(4);
  });

  it('should handle network errors gracefully', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.getNotes).mockRejectedValue(new Error('Network error'));

    const program = new Command();
    program.addCommand(createNotesCommand());

    await expect(program.parseAsync(['node', 'test', 'notes', 'meeting-id'])).rejects.toThrow(
      /process\.exit/i,
    );
    expect(console_.errors.some((log) => /failed to fetch notes/i.test(log))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should handle authentication failures', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.getNotes).mockRejectedValue(new Error('Not authenticated'));

    const program = new Command();
    program.addCommand(createNotesCommand());

    await expect(program.parseAsync(['node', 'test', 'notes', 'meeting-id'])).rejects.toThrow(
      /process\.exit/i,
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should reject invalid output formats', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.getNotes).mockResolvedValue(mockMeetingWithNotes.notes!);

    const program = new Command();
    program.addCommand(createNotesCommand());

    await expect(
      program.parseAsync(['node', 'test', 'notes', 'meeting-id', '--output', 'invalid']),
    ).rejects.toThrow(/process\.exit/i);

    expect(console_.errors.some((log) => /invalid format/i.test(log))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with code 4 when getNotes returns null', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.getNotes).mockResolvedValue(null);

    const program = new Command();
    program.addCommand(createNotesCommand());

    await expect(program.parseAsync(['node', 'test', 'notes', 'meeting-id'])).rejects.toThrow(
      'process.exit',
    );

    expect(console_.errors.some((e) => /no notes found/i.test(e))).toBe(true);
    expect(mockExit).toHaveBeenCalledWith(4);
  });
});

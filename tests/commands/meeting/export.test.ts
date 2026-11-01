import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExportCommand } from '../../../src/commands/meeting/export.js';
import {
  mockMeetings,
  mockMeetingWithNotes,
  mockMeetingWithPeople,
  mockTranscript,
} from '../../fixtures/meetings.js';
import { captureConsole } from '../../setup.js';

vi.mock('../../../src/services/meetings.js', () => ({
  get: vi.fn(),
  getNotes: vi.fn(),
  getTranscript: vi.fn(),
  resolveId: vi.fn(),
}));

vi.mock('../../../src/lib/prosemirror.js', () => ({
  toMarkdown: vi.fn(() => 'Markdown content'),
}));

vi.mock('../../../src/lib/toon.js', () => ({
  toToon: vi.fn(() => 'toon:output'),
}));

import * as meetings from '../../../src/services/meetings.js';

describe('meeting export command', () => {
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

  it('should export meeting as JSON', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.get).mockResolvedValue(mockMeetings[0]);
    vi.mocked(meetings.getNotes).mockResolvedValue(mockMeetingWithNotes.last_viewed_panel!.content);
    vi.mocked(meetings.getTranscript).mockResolvedValue(mockTranscript);

    const program = new Command();
    program.addCommand(createExportCommand());
    await program.parseAsync(['node', 'test', 'export', 'meeting-id']);

    expect(meetings.resolveId).toHaveBeenCalledWith('meeting-id');
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
    expect(parsed.id).toBe(mockMeetings[0].id);
    expect(parsed.notes_markdown).toBe('Markdown content');
  });

  it('should handle null notes', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.get).mockResolvedValue(mockMeetings[0]);
    vi.mocked(meetings.getNotes).mockResolvedValue(null);
    vi.mocked(meetings.getTranscript).mockResolvedValue(mockTranscript);

    const program = new Command();
    program.addCommand(createExportCommand());
    await program.parseAsync(['node', 'test', 'export', 'meeting-id']);

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
    expect(parsed.notes_markdown).toBe(null);
  });

  it('should exit with code 4 when meeting not found', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue(null);

    const program = new Command();
    program.addCommand(createExportCommand());

    await expect(program.parseAsync(['node', 'test', 'export', 'meeting-id'])).rejects.toThrow(
      'process.exit',
    );
    expect(mockExit).toHaveBeenCalledWith(4);
  });

  it('should export as JSON by default', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.get).mockResolvedValue(mockMeetings[0]);
    vi.mocked(meetings.getNotes).mockResolvedValue(null);
    vi.mocked(meetings.getTranscript).mockResolvedValue([]);

    const program = new Command();
    program.addCommand(createExportCommand());
    await program.parseAsync(['node', 'test', 'export', 'meeting-id']);

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

  it('should export as Toon format when --format toon is specified', async () => {
    vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
    vi.mocked(meetings.get).mockResolvedValue(mockMeetings[0]);
    vi.mocked(meetings.getNotes).mockResolvedValue(null);
    vi.mocked(meetings.getTranscript).mockResolvedValue([]);

    const program = new Command();
    program.addCommand(createExportCommand());
    await program.parseAsync(['node', 'test', 'export', 'meeting-id', '--format', 'toon']);

    expect(console_.logs).toContain('toon:output');
  });

  it('should exit with code 1 for invalid format', async () => {
    const program = new Command();
    program.addCommand(createExportCommand());

    await expect(
      program.parseAsync(['node', 'test', 'export', 'meeting-id', '--format', 'invalid']),
    ).rejects.toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(console_.errors.some((e) => /Invalid format/i.test(e))).toBe(true);
  });

  describe('export with participants', () => {
    it('exports participant metadata when the document has no people object', async () => {
      vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
      vi.mocked(meetings.get).mockResolvedValue({
        ...mockMeetings[0],
        people: undefined,
        creator: mockMeetingWithPeople.creator,
        attendees: mockMeetingWithPeople.attendees,
      });
      vi.mocked(meetings.getNotes).mockResolvedValue(null);
      vi.mocked(meetings.getTranscript).mockResolvedValue([]);

      await new Command()
        .addCommand(createExportCommand())
        .parseAsync(['node', 'test', 'export', 'meeting-id']);

      expect(JSON.parse(console_.logs[0]).people).toEqual({
        creator: mockMeetingWithPeople.creator,
        attendees: mockMeetingWithPeople.attendees,
      });
    });
    it('should include people in exported JSON', async () => {
      vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
      vi.mocked(meetings.get).mockResolvedValue(mockMeetingWithPeople);
      vi.mocked(meetings.getNotes).mockResolvedValue(null);
      vi.mocked(meetings.getTranscript).mockResolvedValue([]);

      const program = new Command();
      program.addCommand(createExportCommand());
      await program.parseAsync(['node', 'test', 'export', 'meeting-id']);

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

      expect(parsed.people).toBeDefined();
      expect(parsed.people.creator).toMatchObject({
        name: 'John Doe',
        email: 'john.doe@example.com',
      });
      expect(parsed.people.attendees).toHaveLength(2);
    });

    it('should handle null people gracefully', async () => {
      vi.mocked(meetings.resolveId).mockResolvedValue('meeting-id');
      vi.mocked(meetings.get).mockResolvedValue(mockMeetings[0]);
      vi.mocked(meetings.getNotes).mockResolvedValue(null);
      vi.mocked(meetings.getTranscript).mockResolvedValue([]);

      const program = new Command();
      program.addCommand(createExportCommand());
      await program.parseAsync(['node', 'test', 'export', 'meeting-id']);

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

      expect(parsed.people).toBeUndefined();
    });
  });
});

import { describe, expect, it } from 'vitest';
import { type MeetingExport, toToon } from '../../src/lib/toon.js';
import { mockMeetingWithNotes, mockTranscript } from '../fixtures/meetings.js';

describe('toToon', () => {
  it('should convert meeting export to Toon format', () => {
    const data: MeetingExport = {
      id: mockMeetingWithNotes.id,
      title: mockMeetingWithNotes.title,
      created_at: mockMeetingWithNotes.created_at,
      updated_at: mockMeetingWithNotes.updated_at,
      workspace_id: mockMeetingWithNotes.workspace_id,
      notes_markdown: '# Q4 Planning Session\n\n## Key Decisions\n\n- Launch date moved',
      notes_raw: mockMeetingWithNotes.notes!,
      transcript: mockTranscript,
    };

    const result = toToon(data);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('Q4 Planning Session');
    expect(result).toContain(mockMeetingWithNotes.id);
  });

  it('should handle null notes', () => {
    const data: MeetingExport = {
      id: 'test-id',
      title: 'Test Meeting',
      created_at: '2025-12-18T14:00:00Z',
      updated_at: '2025-12-18T15:00:00Z',
      notes_markdown: null,
      notes_raw: null,
      transcript: [],
    };

    const result = toToon(data);

    expect(typeof result).toBe('string');
    expect(result).toContain('Test Meeting');
  });

  it('should handle transcript array', () => {
    const data: MeetingExport = {
      id: 'test-id',
      title: 'Test Meeting',
      created_at: '2025-12-18T14:00:00Z',
      updated_at: '2025-12-18T15:00:00Z',
      notes_markdown: null,
      notes_raw: null,
      transcript: mockTranscript,
    };

    const result = toToon(data);

    expect(typeof result).toBe('string');
    expect(result).toContain('microphone');
    expect(result).toContain('system');
  });
});

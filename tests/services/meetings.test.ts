import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/lib/http.js';

// Mock the client module
vi.mock('../../src/services/client.js', () => ({
  getClient: vi.fn(),
  withTokenRefresh: vi.fn((fn) => fn()),
}));

import { getClient } from '../../src/services/client.js';
import {
  clearMeetingsCache,
  get,
  getEnhancedNotes,
  getNotes,
  getTranscript,
  list,
  resolveId,
} from '../../src/services/meetings.js';
import {
  mockMeetings,
  mockMeetingWithNotes,
  mockPeople,
  mockPerson,
  mockTranscript,
} from '../fixtures/meetings.js';

describe('meetings service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMeetingsCache();
  });

  describe('resolveId', () => {
    it('should resolve to a unique meeting id', async () => {
      const mockClient = {
        getDocuments: vi.fn().mockResolvedValue({
          docs: [
            { id: 'abc123', title: 'Meeting A', created_at: '', updated_at: '' },
            { id: 'def456', title: 'Meeting B', created_at: '', updated_at: '' },
          ],
        }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await resolveId('abc');

      expect(result).toBe('abc123');
    });

    it('should return null when no matching meeting exists', async () => {
      const mockClient = {
        getDocuments: vi.fn().mockResolvedValue({ docs: [] }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await resolveId('missing');

      expect(result).toBeNull();
    });

    it('should throw when multiple meetings match', async () => {
      const mockClient = {
        getDocuments: vi.fn().mockResolvedValue({
          docs: [
            { id: 'abc123', title: 'Meeting A', created_at: '', updated_at: '' },
            { id: 'abc999', title: 'Meeting B', created_at: '', updated_at: '' },
          ],
        }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      await expect(resolveId('abc')).rejects.toThrow(/ambiguous/i);
    });

    it('should paginate when meeting is outside the first 100 results', async () => {
      const firstPage = Array.from({ length: 100 }, (_, idx) => ({
        id: `other-${idx}`,
        title: `Meeting ${idx}`,
        created_at: '',
        updated_at: '',
      }));
      const secondPage = [
        { id: 'abc555', title: 'Target Meeting', created_at: '', updated_at: '' },
      ];
      const mockClient = {
        getDocuments: vi.fn().mockImplementation(async ({ offset }: { offset: number }) => {
          if (offset === 0) {
            return { docs: firstPage };
          }
          if (offset === 100) {
            return { docs: secondPage };
          }
          return { docs: [] };
        }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await resolveId('abc');

      expect(result).toBe('abc555');
      expect(mockClient.getDocuments).toHaveBeenCalledWith({
        limit: 100,
        offset: 0,
        include_last_viewed_panel: false,
      });
      expect(mockClient.getDocuments).toHaveBeenCalledWith({
        limit: 100,
        offset: 100,
        include_last_viewed_panel: false,
      });
    });

    it('should use direct lookup for full UUID (36+ chars)', async () => {
      const fullUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const mockClient = {
        getDocumentMetadata: vi.fn().mockResolvedValue({ id: fullUuid, title: 'Meeting' }),
        getDocuments: vi.fn(),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await resolveId(fullUuid);

      expect(result).toBe(fullUuid);
      expect(mockClient.getDocumentMetadata).toHaveBeenCalledWith(fullUuid);
      expect(mockClient.getDocuments).not.toHaveBeenCalled();
    });

    it('should fall back to search when direct lookup fails', async () => {
      const fullUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const mockClient = {
        getDocumentMetadata: vi.fn().mockRejectedValue(new Error('Not found')),
        getDocuments: vi.fn().mockResolvedValue({
          docs: [{ id: fullUuid, title: 'Meeting', created_at: '', updated_at: '' }],
        }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await resolveId(fullUuid);

      expect(result).toBe(fullUuid);
      expect(mockClient.getDocumentMetadata).toHaveBeenCalledWith(fullUuid);
      expect(mockClient.getDocuments).toHaveBeenCalled();
    });

    it('should use cache for subsequent calls', async () => {
      const mockClient = {
        getDocuments: vi.fn().mockResolvedValue({
          docs: [
            { id: 'abc123', title: 'Meeting A', created_at: '', updated_at: '' },
            { id: 'def456', title: 'Meeting B', created_at: '', updated_at: '' },
          ],
        }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      await resolveId('abc');
      await resolveId('def');

      // Should only fetch once due to caching
      expect(mockClient.getDocuments).toHaveBeenCalledTimes(1);
    });

    it('should clear cache when clearMeetingsCache is called', async () => {
      const mockClient = {
        getDocuments: vi.fn().mockResolvedValue({
          docs: [{ id: 'abc123', title: 'Meeting A', created_at: '', updated_at: '' }],
        }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      await resolveId('abc');
      clearMeetingsCache();
      await resolveId('abc');

      expect(mockClient.getDocuments).toHaveBeenCalledTimes(2);
    });
  });

  describe('list', () => {
    it('should list meetings with default options', async () => {
      const mockClient = {
        getDocuments: vi.fn().mockResolvedValue({ docs: mockMeetings }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list();

      expect(result).toEqual(mockMeetings);
    });

    it('should list meetings with custom limit', async () => {
      const mockClient = {
        getDocuments: vi.fn().mockResolvedValue({ docs: mockMeetings.slice(0, 1) }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list({ limit: 1 });

      expect(result).toHaveLength(1);
    });

    it('should filter by workspace', async () => {
      const mockClient = {
        getDocuments: vi.fn().mockResolvedValue({ docs: mockMeetings }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list({ workspace: 'abc12345' });

      expect(result).toHaveLength(1);
      expect(result[0].workspace_id).toBe('abc12345');
    });

    it('should handle empty response', async () => {
      const mockClient = {
        getDocuments: vi.fn().mockResolvedValue({ docs: [] }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list();

      expect(result).toEqual([]);
    });

    it('should handle undefined response', async () => {
      const mockClient = {
        getDocuments: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list();

      expect(result).toEqual([]);
    });

    it('should paginate folder meetings after workspace filtering', async () => {
      const folderMeetings = [
        {
          id: 'folder-1',
          title: 'Folder Meeting 1',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
          workspace_id: 'ws-1',
        },
        {
          id: 'folder-2',
          title: 'Folder Meeting 2',
          created_at: '2024-01-02',
          updated_at: '2024-01-02',
          workspace_id: 'ws-2',
        },
        {
          id: 'folder-3',
          title: 'Folder Meeting 3',
          created_at: '2024-01-03',
          updated_at: '2024-01-03',
          workspace_id: 'ws-1',
        },
        {
          id: 'folder-4',
          title: 'Folder Meeting 4',
          created_at: '2024-01-04',
          updated_at: '2024-01-04',
          workspace_id: 'ws-1',
        },
      ];
      const meetingLookup = new Map(folderMeetings.map((m) => [m.id, m]));
      const mockClient = {
        getDocumentList: vi.fn().mockResolvedValue({
          document_ids: folderMeetings.map((m) => m.id),
        }),
        getDocumentsBatch: vi.fn().mockImplementation(async ({ document_ids }) => ({
          documents: document_ids.map((id: string) => meetingLookup.get(id)),
        })),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list({ folder: 'folder-id', workspace: 'ws-1', limit: 3 });

      expect(mockClient.getDocumentList).toHaveBeenCalledWith('folder-id');
      expect(result).toHaveLength(3);
      expect(result.map((m) => m.id)).toEqual(['folder-1', 'folder-3', 'folder-4']);
    });

    it('should apply offset after filtering folder results', async () => {
      const folderMeetings = [
        {
          id: 'folder-1',
          title: 'Folder Meeting 1',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
          workspace_id: 'ws-1',
        },
        {
          id: 'folder-2',
          title: 'Folder Meeting 2',
          created_at: '2024-01-02',
          updated_at: '2024-01-02',
          workspace_id: 'ws-2',
        },
        {
          id: 'folder-3',
          title: 'Folder Meeting 3',
          created_at: '2024-01-03',
          updated_at: '2024-01-03',
          workspace_id: 'ws-1',
        },
        {
          id: 'folder-4',
          title: 'Folder Meeting 4',
          created_at: '2024-01-04',
          updated_at: '2024-01-04',
          workspace_id: 'ws-1',
        },
      ];
      const meetingLookup = new Map(folderMeetings.map((m) => [m.id, m]));
      const mockClient = {
        getDocumentList: vi.fn().mockResolvedValue({
          document_ids: folderMeetings.map((m) => m.id),
        }),
        getDocumentsBatch: vi.fn().mockImplementation(async ({ document_ids }) => ({
          documents: document_ids.map((id: string) => meetingLookup.get(id)),
        })),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list({ folder: 'folder-id', workspace: 'ws-1', offset: 1, limit: 1 });

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('folder-3');
    });

    it('should paginate folder meetings without workspace filter', async () => {
      const folderMeetings = [
        {
          id: 'folder-1',
          title: 'Folder Meeting 1',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
          workspace_id: 'ws-1',
        },
        {
          id: 'folder-2',
          title: 'Folder Meeting 2',
          created_at: '2024-01-02',
          updated_at: '2024-01-02',
          workspace_id: 'ws-2',
        },
        {
          id: 'folder-3',
          title: 'Folder Meeting 3',
          created_at: '2024-01-03',
          updated_at: '2024-01-03',
          workspace_id: 'ws-1',
        },
      ];
      const meetingLookup = new Map(folderMeetings.map((m) => [m.id, m]));
      const mockClient = {
        getDocumentList: vi.fn().mockResolvedValue({
          document_ids: folderMeetings.map((m) => m.id),
        }),
        getDocumentsBatch: vi.fn().mockImplementation(async ({ document_ids }) => ({
          documents: document_ids.map((id: string) => meetingLookup.get(id)),
        })),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list({ folder: 'folder-id', offset: 1, limit: 2 });

      expect(result.map((m) => m.id)).toEqual(['folder-2', 'folder-3']);
    });

    it('should fetch folder meetings using getDocumentList and getDocumentsBatch', async () => {
      const folderMeetings = [
        {
          id: 'folder-1',
          title: 'Folder Meeting 1',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
          workspace_id: 'ws-1',
        },
        {
          id: 'folder-2',
          title: 'Folder Meeting 2',
          created_at: '2024-01-02',
          updated_at: '2024-01-02',
          workspace_id: 'ws-2',
        },
      ];
      const meetingLookup = new Map(folderMeetings.map((m) => [m.id, m]));
      const mockClient = {
        getDocumentList: vi.fn().mockResolvedValue({
          id: 'folder-id',
          documents: folderMeetings.map((m) => ({ id: m.id })),
        }),
        getDocumentsBatch: vi.fn().mockImplementation(async ({ document_ids }) => ({
          documents: document_ids.map((id: string) => meetingLookup.get(id)),
        })),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list({ folder: 'folder-id', limit: 2 });

      expect(mockClient.getDocumentList).toHaveBeenCalledWith('folder-id');
      expect(result).toHaveLength(2);
    });

    it('should return empty array when folder is not found', async () => {
      const mockClient = {
        getDocumentList: vi.fn().mockResolvedValue(null),
        getDocumentsBatch: vi.fn(),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list({ folder: 'nonexistent' });

      expect(result).toEqual([]);
      expect(mockClient.getDocumentsBatch).not.toHaveBeenCalled();
    });

    it('should return empty array when folder has no documents', async () => {
      const mockClient = {
        getDocumentList: vi.fn().mockResolvedValue({
          id: 'empty-folder',
          documents: [],
        }),
        getDocumentsBatch: vi.fn(),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list({ folder: 'empty-folder' });

      expect(result).toEqual([]);
      expect(mockClient.getDocumentsBatch).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('should combine the full meeting with participant metadata', async () => {
      const meeting = mockMeetings[0];
      const mockClient = {
        getDocumentsBatch: vi.fn().mockResolvedValue({ documents: [meeting] }),
        getDocumentMetadata: vi.fn().mockResolvedValue({
          id: meeting.id,
          creator: mockPerson,
          attendees: mockPeople.attendees,
          conferencing: null,
          url: 'https://example.com/meeting',
        }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await get(meeting.id);

      expect(mockClient.getDocumentsBatch).toHaveBeenCalledWith({
        document_ids: [meeting.id],
        include_last_viewed_panel: false,
      });
      expect(result).toMatchObject({
        ...meeting,
        creator: mockPerson,
        attendees: mockPeople.attendees,
      });
    });

    it('should select the matching meeting and preserve its core fields', async () => {
      const meeting = mockMeetings[0];
      const mockClient = {
        getDocumentsBatch: vi.fn().mockResolvedValue({ documents: [mockMeetings[1], meeting] }),
        getDocumentMetadata: vi.fn().mockResolvedValue({
          id: 'different-id',
          title: undefined,
          created_at: undefined,
          updated_at: undefined,
          creator: mockPerson,
        }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await get(meeting.id);

      expect(result).toMatchObject(meeting);
      expect(result?.creator).toEqual(mockPerson);
    });

    it('should return null when the batch does not contain the meeting', async () => {
      const mockClient = {
        getDocumentsBatch: vi.fn().mockResolvedValue({ documents: [mockMeetings[1]] }),
        getDocumentMetadata: vi.fn(),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await get(mockMeetings[0].id);

      expect(result).toBeNull();
      expect(mockClient.getDocumentMetadata).not.toHaveBeenCalled();
    });

    it('should return null when the batch contains no meetings', async () => {
      const mockClient = {
        getDocumentsBatch: vi.fn().mockResolvedValue({ documents: [] }),
        getDocumentMetadata: vi.fn(),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await get('nonexistent-id');

      expect(result).toBeNull();
      expect(mockClient.getDocumentMetadata).not.toHaveBeenCalled();
    });

    it('should preserve the meeting when optional metadata is not found', async () => {
      const meeting = { ...mockMeetings[0], people: mockPeople };
      const mockClient = {
        getDocumentsBatch: vi.fn().mockResolvedValue({ documents: [meeting] }),
        getDocumentMetadata: vi.fn().mockRejectedValue(new ApiError('Not found', 404)),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await get(meeting.id);

      expect(result).toEqual(meeting);
    });

    it('should preserve the meeting when optional metadata is empty', async () => {
      const meeting = mockMeetings[0];
      const mockClient = {
        getDocumentsBatch: vi.fn().mockResolvedValue({ documents: [meeting] }),
        getDocumentMetadata: vi.fn().mockResolvedValue(null),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await get(meeting.id);

      expect(result).toEqual(meeting);
    });

    it('should handle participant metadata containing only the creator', async () => {
      const meeting = mockMeetings[0];
      const mockClient = {
        getDocumentsBatch: vi.fn().mockResolvedValue({ documents: [meeting] }),
        getDocumentMetadata: vi.fn().mockResolvedValue({ creator: mockPerson }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await get(meeting.id);

      expect(result?.creator).toEqual(mockPerson);
      expect(result?.attendees).toBeUndefined();
    });

    it('should handle participant metadata containing only attendees', async () => {
      const meeting = mockMeetings[0];
      const mockClient = {
        getDocumentsBatch: vi.fn().mockResolvedValue({ documents: [meeting] }),
        getDocumentMetadata: vi.fn().mockResolvedValue({ attendees: mockPeople.attendees }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await get(meeting.id);

      expect(result?.creator).toBeUndefined();
      expect(result?.attendees).toEqual(mockPeople.attendees);
    });

    it.each([
      ['authentication', new ApiError('Unauthorized', 401)],
      ['server', new ApiError('Internal server error', 500)],
      ['network', new Error('fetch failed')],
    ])('should propagate %s errors from the document batch', async (_, error) => {
      const mockClient = {
        getDocumentsBatch: vi.fn().mockRejectedValue(error),
        getDocumentMetadata: vi.fn(),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      await expect(get(mockMeetings[0].id)).rejects.toBe(error);
    });

    it.each([
      ['authentication', new ApiError('Unauthorized', 401)],
      ['server', new ApiError('Internal server error', 500)],
      ['network', new Error('fetch failed')],
    ])('should propagate %s errors from optional metadata', async (_, error) => {
      const mockClient = {
        getDocumentsBatch: vi.fn().mockResolvedValue({ documents: [mockMeetings[0]] }),
        getDocumentMetadata: vi.fn().mockRejectedValue(error),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      await expect(get(mockMeetings[0].id)).rejects.toBe(error);
    });
  });

  describe('getTranscript', () => {
    it('should get meeting transcript', async () => {
      const mockClient = {
        getDocumentTranscript: vi.fn().mockResolvedValue(mockTranscript),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await getTranscript('meeting-id');

      expect(result).toEqual(mockTranscript);
    });

    it('should return empty array when the transcript is not found', async () => {
      const mockClient = {
        getDocumentTranscript: vi.fn().mockRejectedValue(new ApiError('Not found', 404)),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await getTranscript('meeting-id');

      expect(result).toEqual([]);
    });

    it.each([
      ['authentication', new ApiError('Unauthorized', 401)],
      ['server', new ApiError('Internal server error', 500)],
      ['network', new Error('fetch failed')],
    ])('should propagate %s errors', async (_, error) => {
      const mockClient = {
        getDocumentTranscript: vi.fn().mockRejectedValue(error),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      await expect(getTranscript('meeting-id')).rejects.toBe(error);
    });
  });

  describe.each([
    { name: 'manual notes', load: getNotes },
    { name: 'enhanced notes', load: getEnhancedNotes },
  ])('$name error handling', ({ load }) => {
    it.each([
      { source: 'metadata', error: new ApiError('Unauthorized', 401) },
      { source: 'metadata', error: new ApiError('Unavailable', 503) },
      { source: 'metadata', error: new Error('fetch failed') },
      { source: 'documents', error: new ApiError('Unauthorized', 401) },
      { source: 'documents', error: new ApiError('Unavailable', 503) },
      { source: 'documents', error: new Error('fetch failed') },
    ])('propagates $source errors: $error', async ({ source, error }) => {
      const client = {
        getDocumentMetadata:
          source === 'metadata'
            ? vi.fn().mockRejectedValue(error)
            : vi.fn().mockResolvedValue(null),
        getDocuments: vi.fn().mockRejectedValue(error),
      };
      vi.mocked(getClient).mockResolvedValue(client as never);
      await expect(load('meeting-id')).rejects.toBe(error);
      if (source === 'metadata') expect(client.getDocuments).not.toHaveBeenCalled();
    });

    it('returns null for missing notes', async () => {
      vi.mocked(getClient).mockResolvedValue({
        getDocumentMetadata: vi.fn().mockRejectedValue(new ApiError('Not found', 404)),
        getDocuments: vi.fn().mockRejectedValue(new ApiError('Not found', 404)),
      } as never);
      expect(await load('missing-id')).toBeNull();
    });
  });

  describe('getNotes', () => {
    it('should get manual notes from metadata', async () => {
      const meetingWithNotes = {
        id: 'meeting-id',
        notes: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Manual note' }] }],
        },
      };
      const mockClient = {
        getDocumentMetadata: vi.fn().mockResolvedValue(meetingWithNotes),
        getDocuments: vi.fn(),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await getNotes('meeting-id');

      expect(result).toEqual(meetingWithNotes.notes);
      expect(mockClient.getDocumentMetadata).toHaveBeenCalledWith('meeting-id');
      expect(mockClient.getDocuments).not.toHaveBeenCalled();
    });

    it('should return null when metadata has no notes', async () => {
      const mockClient = {
        getDocumentMetadata: vi.fn().mockResolvedValue({ id: 'meeting-id', notes: null }),
        getDocuments: vi.fn(),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await getNotes('meeting-id');

      expect(result).toBeNull();
      expect(mockClient.getDocuments).not.toHaveBeenCalled();
    });

    it('should fallback to document search when metadata unavailable', async () => {
      const meetingWithNotes = {
        id: 'meeting-id',
        notes: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Manual note' }] }],
        },
      };
      const mockClient = {
        getDocumentMetadata: vi.fn().mockResolvedValue(null),
        getDocuments: vi.fn().mockResolvedValue({ docs: [meetingWithNotes] }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await getNotes('meeting-id');

      expect(result).toEqual(meetingWithNotes.notes);
      expect(mockClient.getDocuments).toHaveBeenCalled();
    });

    it('should return null when meeting not found via fallback', async () => {
      const mockClient = {
        getDocumentMetadata: vi.fn().mockResolvedValue(null),
        getDocuments: vi.fn().mockResolvedValue({ docs: [] }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await getNotes('nonexistent-id');

      expect(result).toBeNull();
    });

    it('should propagate document search errors', async () => {
      const mockClient = {
        getDocumentMetadata: vi.fn().mockResolvedValue(null),
        getDocuments: vi.fn().mockRejectedValue(new Error('Server error')),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      await expect(getNotes('error-id')).rejects.toThrow('Server error');
    });

    it('should find meeting notes on a later page', async () => {
      const targetMeeting = {
        id: 'target-meeting-id',
        notes: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Found on page 2' }] }],
        },
      };
      const otherMeeting = { id: 'other-meeting', title: 'Other Meeting' };

      const mockClient = {
        getDocumentMetadata: vi.fn().mockResolvedValue(null),
        getDocuments: vi
          .fn()
          .mockResolvedValueOnce({ docs: [otherMeeting] })
          .mockResolvedValueOnce({ docs: [targetMeeting] }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await getNotes('target-meeting-id');

      expect(result).toEqual(targetMeeting.notes);
    });
  });

  describe('getEnhancedNotes', () => {
    it('should get enhanced notes from metadata', async () => {
      const meetingWithEnhanced = {
        ...mockMeetingWithNotes,
        id: 'meeting-id',
      };
      const mockClient = {
        getDocumentMetadata: vi.fn().mockResolvedValue(meetingWithEnhanced),
        getDocuments: vi.fn(),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await getEnhancedNotes('meeting-id');

      expect(result).toEqual(mockMeetingWithNotes.last_viewed_panel?.content);
      expect(mockClient.getDocuments).not.toHaveBeenCalled();
    });

    it('should return null when metadata has no enhanced notes', async () => {
      const mockClient = {
        getDocumentMetadata: vi.fn().mockResolvedValue({ id: 'meeting-id' }),
        getDocuments: vi.fn(),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await getEnhancedNotes('meeting-id');

      expect(result).toBeNull();
    });

    it('should fallback to document search when metadata unavailable', async () => {
      const meetingWithEnhanced = {
        ...mockMeetingWithNotes,
        id: 'meeting-id',
      };
      const mockClient = {
        getDocumentMetadata: vi.fn().mockResolvedValue(null),
        getDocuments: vi.fn().mockResolvedValue({ docs: [meetingWithEnhanced] }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await getEnhancedNotes('meeting-id');

      expect(result).toEqual(mockMeetingWithNotes.last_viewed_panel?.content);
    });

    it('should return null when meeting not found', async () => {
      const mockClient = {
        getDocumentMetadata: vi.fn().mockResolvedValue(null),
        getDocuments: vi.fn().mockResolvedValue({ docs: [] }),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await getEnhancedNotes('nonexistent-id');

      expect(result).toBeNull();
    });

    it('should propagate document search errors', async () => {
      const mockClient = {
        getDocumentMetadata: vi.fn().mockResolvedValue(null),
        getDocuments: vi.fn().mockRejectedValue(new Error('Server error')),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      await expect(getEnhancedNotes('error-id')).rejects.toThrow('Server error');
    });
  });

  describe('error handling', () => {
    it('should throw when list() encounters network error', async () => {
      const mockClient = {
        getDocuments: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      await expect(list()).rejects.toThrow(/network/i);
    });

    it('should throw when client authentication fails', async () => {
      vi.mocked(getClient).mockRejectedValue(new Error('Not authenticated'));

      await expect(list()).rejects.toThrow(/authenticated/i);
    });
  });
});

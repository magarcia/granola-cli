import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/client.js', () => ({
  getClient: vi.fn(),
  withTokenRefresh: vi.fn((fn) => fn()),
}));

import { getClient } from '../../src/services/client.js';
import { get, list } from '../../src/services/folders.js';
import { mockDocumentListsApiResponse } from '../fixtures/folders.js';

describe('folders service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('should fetch folders from getDocumentLists and filter by workspace', async () => {
      const mockClient = {
        getDocumentLists: vi.fn().mockResolvedValue(mockDocumentListsApiResponse),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list({ workspace: 'ws-1' });

      expect(mockClient.getDocumentLists).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'folder-1',
        title: 'Sales Calls',
        workspace_id: 'ws-1',
        document_ids: ['doc-1', 'doc-2'],
        is_favourited: true,
      });
    });

    it('should return all folders when no workspace filter', async () => {
      const mockClient = {
        getDocumentLists: vi.fn().mockResolvedValue(mockDocumentListsApiResponse),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list();

      expect(result).toHaveLength(2);
    });

    it('should return empty array when no folders', async () => {
      const mockClient = {
        getDocumentLists: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list();

      expect(result).toEqual([]);
    });

    it('should normalize folder data with document_ids from documents array', async () => {
      const foldersWithDocs = [
        {
          id: 'folder-1',
          title: 'Folder with docs',
          workspace_id: 'ws-1',
          owner_id: 'user-1',
          created_at: '2024-01-01T00:00:00Z',
          is_favourited: false,
          documents: [{ id: 'doc-a' }, { id: 'doc-b' }],
        },
      ];
      const mockClient = {
        getDocumentLists: vi.fn().mockResolvedValue(foldersWithDocs),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list();

      expect(result[0].document_ids).toEqual(['doc-a', 'doc-b']);
    });

    it('should handle folders with no documents array', async () => {
      const foldersNoDocs = [
        {
          id: 'folder-1',
          title: 'Empty folder',
          created_at: '2024-01-01T00:00:00Z',
          is_favourited: false,
        },
      ];
      const mockClient = {
        getDocumentLists: vi.fn().mockResolvedValue(foldersNoDocs),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await list();

      expect(result[0].document_ids).toEqual([]);
    });
  });

  describe('get', () => {
    it('should return folder by id when found', async () => {
      const mockClient = {
        getDocumentLists: vi.fn().mockResolvedValue(mockDocumentListsApiResponse),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await get('folder-1');

      expect(result).toMatchObject({
        id: 'folder-1',
        title: 'Sales Calls',
        workspace_id: 'ws-1',
      });
    });

    it('should return null when folder not found', async () => {
      const mockClient = {
        getDocumentLists: vi.fn().mockResolvedValue(mockDocumentListsApiResponse),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      const result = await get('nonexistent');

      expect(result).toBeNull();
    });

    it('should propagate errors from getDocumentLists', async () => {
      const mockClient = {
        getDocumentLists: vi.fn().mockRejectedValue(new Error('API error')),
      };
      vi.mocked(getClient).mockResolvedValue(mockClient as never);

      await expect(get('folder-1')).rejects.toThrow('API error');
    });
  });
});

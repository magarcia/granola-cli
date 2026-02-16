import { beforeEach, describe, expect, it, vi } from 'vitest';
// We'll import from the module we're about to create
import { createApiClient, type GranolaApi } from '../../src/lib/api.js';
import type { HttpClient } from '../../src/lib/http.js';

describe('api client', () => {
  let mockHttpClient: HttpClient;
  let api: GranolaApi;

  beforeEach(() => {
    mockHttpClient = {
      post: vi.fn(),
      setToken: vi.fn(),
    };
    api = createApiClient(mockHttpClient);
  });

  describe('createApiClient', () => {
    it('should create an API client with all methods', () => {
      expect(api).toBeDefined();
      expect(api.getDocuments).toBeDefined();
      expect(api.getDocumentsBatch).toBeDefined();
      expect(api.getDocumentMetadata).toBeDefined();
      expect(api.getDocumentTranscript).toBeDefined();
      expect(api.getDocumentLists).toBeDefined();
      expect(api.getDocumentList).toBeDefined();
      expect(api.getWorkspaces).toBeDefined();
      expect(api.setToken).toBeDefined();
    });
  });

  describe('getDocuments', () => {
    it('should call POST /v2/get-documents with default options', async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ docs: [] });

      await api.getDocuments();

      expect(mockHttpClient.post).toHaveBeenCalledWith('/v2/get-documents', {
        include_last_viewed_panel: false,
      });
    });

    it('should pass workspace_id when provided', async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ docs: [] });

      await api.getDocuments({ workspace_id: 'ws-123' });

      expect(mockHttpClient.post).toHaveBeenCalledWith('/v2/get-documents', {
        workspace_id: 'ws-123',
        include_last_viewed_panel: false,
      });
    });

    it('should pass limit and offset when provided', async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ docs: [] });

      await api.getDocuments({ limit: 50, offset: 10 });

      expect(mockHttpClient.post).toHaveBeenCalledWith('/v2/get-documents', {
        limit: 50,
        offset: 10,
        include_last_viewed_panel: false,
      });
    });

    it('should pass include_last_viewed_panel when true', async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ docs: [] });

      await api.getDocuments({ include_last_viewed_panel: true });

      expect(mockHttpClient.post).toHaveBeenCalledWith('/v2/get-documents', {
        include_last_viewed_panel: true,
      });
    });

    it('should return the response from the API', async () => {
      const mockResponse = {
        docs: [{ id: 'doc-1', title: 'Meeting 1' }],
        next_cursor: 'cursor-abc',
      };
      vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

      const result = await api.getDocuments();

      expect(result).toEqual(mockResponse);
    });
  });

  describe('getDocumentsBatch', () => {
    it('should call POST /v1/get-documents-batch with document_ids', async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ documents: [] });

      await api.getDocumentsBatch({ document_ids: ['doc-1', 'doc-2'] });

      expect(mockHttpClient.post).toHaveBeenCalledWith('/v1/get-documents-batch', {
        document_ids: ['doc-1', 'doc-2'],
        include_last_viewed_panel: false,
      });
    });

    it('should pass include_last_viewed_panel when true', async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ documents: [] });

      await api.getDocumentsBatch({
        document_ids: ['doc-1'],
        include_last_viewed_panel: true,
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith('/v1/get-documents-batch', {
        document_ids: ['doc-1'],
        include_last_viewed_panel: true,
      });
    });

    it('should return documents from the response', async () => {
      const mockDocs = [{ id: 'doc-1', title: 'Meeting 1' }];
      vi.mocked(mockHttpClient.post).mockResolvedValue({ documents: mockDocs });

      const result = await api.getDocumentsBatch({ document_ids: ['doc-1'] });

      expect(result).toEqual({ documents: mockDocs });
    });

    it('should handle response with docs field instead of documents', async () => {
      const mockDocs = [{ id: 'doc-1', title: 'Meeting 1' }];
      vi.mocked(mockHttpClient.post).mockResolvedValue({ docs: mockDocs });

      const result = await api.getDocumentsBatch({ document_ids: ['doc-1'] });

      expect(result).toEqual({ docs: mockDocs });
    });
  });

  describe('getDocumentMetadata', () => {
    it('should call POST /v1/get-document-metadata with document_id', async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ creator: {}, attendees: [] });

      await api.getDocumentMetadata('doc-123');

      expect(mockHttpClient.post).toHaveBeenCalledWith('/v1/get-document-metadata', {
        document_id: 'doc-123',
      });
    });

    it('should return the metadata response', async () => {
      const mockMetadata = {
        creator: { name: 'John', email: 'john@example.com' },
        attendees: [{ name: 'Jane', email: 'jane@example.com' }],
      };
      vi.mocked(mockHttpClient.post).mockResolvedValue(mockMetadata);

      const result = await api.getDocumentMetadata('doc-123');

      expect(result).toEqual(mockMetadata);
    });
  });

  describe('getDocumentTranscript', () => {
    it('should call POST /v1/get-document-transcript with document_id', async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue([]);

      await api.getDocumentTranscript('doc-123');

      expect(mockHttpClient.post).toHaveBeenCalledWith('/v1/get-document-transcript', {
        document_id: 'doc-123',
      });
    });

    it('should return the transcript array', async () => {
      const mockTranscript = [
        {
          id: 'seg-1',
          text: 'Hello everyone',
          source: 'microphone',
          start_timestamp: '2025-01-01T10:00:00.000Z',
          end_timestamp: '2025-01-01T10:00:02.000Z',
        },
      ];
      vi.mocked(mockHttpClient.post).mockResolvedValue(mockTranscript);

      const result = await api.getDocumentTranscript('doc-123');

      expect(result).toEqual(mockTranscript);
    });
  });

  describe('getDocumentLists', () => {
    it('should call POST /v2/get-document-lists', async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ lists: [] });

      await api.getDocumentLists();

      expect(mockHttpClient.post).toHaveBeenCalledWith('/v2/get-document-lists', {});
    });

    it('should return the folders array from lists wrapper', async () => {
      const mockFolders = [
        {
          id: 'folder-1',
          title: 'Sales calls',
          workspace_id: 'ws-123',
          documents: [{ id: 'doc-1', title: 'Meeting 1' }],
        },
      ];
      vi.mocked(mockHttpClient.post).mockResolvedValue({ lists: mockFolders });

      const result = await api.getDocumentLists();

      expect(result).toEqual(mockFolders);
    });
  });

  describe('getDocumentList', () => {
    it('should fetch folders and find the matching one', async () => {
      const mockFolders = [
        { id: 'folder-1', title: 'Sales', document_ids: ['doc-1'] },
        { id: 'folder-2', title: 'Support', document_ids: ['doc-2'] },
      ];
      vi.mocked(mockHttpClient.post).mockResolvedValue({ lists: mockFolders });

      const result = await api.getDocumentList('folder-2');

      expect(mockHttpClient.post).toHaveBeenCalledWith('/v2/get-document-lists', {});
      expect(result).toEqual({ id: 'folder-2', title: 'Support', document_ids: ['doc-2'] });
    });

    it('should return null when folder is not found', async () => {
      const mockFolders = [{ id: 'folder-1', title: 'Sales', document_ids: ['doc-1'] }];
      vi.mocked(mockHttpClient.post).mockResolvedValue({ lists: mockFolders });

      const result = await api.getDocumentList('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when folders array is empty', async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ lists: [] });

      const result = await api.getDocumentList('folder-1');

      expect(result).toBeNull();
    });
  });

  describe('getWorkspaces', () => {
    it('should call POST /v1/get-workspaces', async () => {
      vi.mocked(mockHttpClient.post).mockResolvedValue({ workspaces: [] });

      await api.getWorkspaces();

      expect(mockHttpClient.post).toHaveBeenCalledWith('/v1/get-workspaces', {});
    });

    it('should return the workspaces response', async () => {
      const mockResponse = {
        workspaces: [
          {
            workspace: {
              workspace_id: 'ws-123',
              display_name: 'My Workspace',
            },
            role: 'owner',
            plan_type: 'pro',
          },
        ],
      };
      vi.mocked(mockHttpClient.post).mockResolvedValue(mockResponse);

      const result = await api.getWorkspaces();

      expect(result).toEqual(mockResponse);
    });
  });

  describe('setToken', () => {
    it('should delegate to httpClient.setToken', () => {
      api.setToken('new-token');

      expect(mockHttpClient.setToken).toHaveBeenCalledWith('new-token');
    });
  });
});

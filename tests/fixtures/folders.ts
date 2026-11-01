import type { DocumentList } from '../../src/lib/api.js';
import type { Folder } from '../../src/types.js';

export const mockFolder: Folder = {
  id: '9f3d3537',
  name: 'Sales Calls',
  title: 'Sales Calls',
  created_at: '2024-06-01T10:00:00Z',
  workspace_id: 'sales-ws',
  owner_id: 'user123',
  document_ids: ['doc1', 'doc2', 'doc3'],
  is_favourite: false,
};

export const mockFolders: Folder[] = [
  mockFolder,
  {
    id: '1fb1b706',
    name: 'Planning',
    title: 'Planning',
    created_at: '2024-05-15T10:00:00Z',
    workspace_id: 'abc12345',
    owner_id: 'user123',
    document_ids: ['doc4', 'doc5'],
    is_favourite: true,
  },
  {
    id: '8a2c4e6f',
    name: '1:1s',
    title: '1:1s',
    created_at: '2024-04-01T10:00:00Z',
    workspace_id: 'personal123',
    owner_id: 'user123',
    document_ids: [],
    is_favourite: false,
  },
];

export const mockDocumentListsApiResponse: DocumentList[] = [
  {
    id: 'folder-1',
    title: 'Sales Calls',
    workspace_id: 'ws-1',
    owner_id: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    is_favourited: true,
    documents: [{ id: 'doc-1' }, { id: 'doc-2' }],
  },
  {
    id: 'folder-2',
    title: 'Product Notes',
    workspace_id: 'ws-2',
    owner_id: 'user-2',
    created_at: '2024-02-01T00:00:00Z',
    is_favourited: false,
    documents: [{ id: 'doc-3' }],
  },
];

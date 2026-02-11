import type { Meeting, Person, ProseMirrorDoc } from '../types.js';
import type { HttpClient } from './http.js';

export interface GetDocumentsOptions {
  workspace_id?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  include_last_viewed_panel?: boolean;
}

export interface DocumentsResponse {
  docs: Meeting[];
  next_cursor?: string;
}

export interface GetDocumentsBatchOptions {
  document_ids: string[];
  include_last_viewed_panel?: boolean;
}

export interface DocumentsBatchResponse {
  documents?: Meeting[];
  docs?: Meeting[];
}

export interface DocumentMetadata {
  creator?: {
    name: string;
    email: string;
    details?: object;
  };
  attendees?: Person[];
  notes?: ProseMirrorDoc;
  last_viewed_panel?: {
    content: ProseMirrorDoc;
  };
}

export interface TranscriptSegment {
  document_id?: string;
  id: string;
  text: string;
  source: 'microphone' | 'system';
  start_timestamp: string;
  end_timestamp: string;
  is_final?: boolean;
}

export interface DocumentListDocument {
  id: string;
}

export interface DocumentList {
  id: string;
  title?: string;
  name?: string;
  description?: string | null;
  workspace_id?: string;
  owner_id?: string;
  created_at: string;
  updated_at?: string;
  is_favourited?: boolean;
  document_count?: number;
  workspace_display_name?: string;
  documents?: DocumentListDocument[];
  document_ids?: string[];
}

export interface DocumentListsResponse {
  lists: DocumentList[];
}

export interface WorkspaceEntry {
  workspace: {
    workspace_id: string;
    slug: string;
    display_name: string;
    is_locked: boolean;
    created_at: string;
    updated_at: string;
    privacy_mode_enabled: boolean;
    sharing_link_visibility: string | null;
  };
  role: string;
  plan_type: string;
}

export interface WorkspacesResponse {
  workspaces: WorkspaceEntry[];
}

export interface GranolaApi {
  getDocuments(options?: GetDocumentsOptions): Promise<DocumentsResponse>;
  getDocumentsBatch(options: GetDocumentsBatchOptions): Promise<DocumentsBatchResponse>;
  getDocumentMetadata(documentId: string): Promise<DocumentMetadata>;
  getDocumentTranscript(documentId: string): Promise<TranscriptSegment[]>;
  getDocumentLists(): Promise<DocumentList[]>;
  getDocumentList(folderId: string): Promise<DocumentList | null>;
  getWorkspaces(): Promise<WorkspacesResponse>;
  setToken(token: string): void;
}

export function createApiClient(httpClient: HttpClient): GranolaApi {
  async function getDocuments(options: GetDocumentsOptions = {}): Promise<DocumentsResponse> {
    const body: Record<string, unknown> = {
      include_last_viewed_panel: options.include_last_viewed_panel ?? false,
    };

    if (options.workspace_id) body.workspace_id = options.workspace_id;
    if (options.limit !== undefined) body.limit = options.limit;
    if (options.offset !== undefined) body.offset = options.offset;
    if (options.cursor) body.cursor = options.cursor;

    return httpClient.post<DocumentsResponse>('/v2/get-documents', body);
  }

  async function getDocumentsBatch(
    options: GetDocumentsBatchOptions,
  ): Promise<DocumentsBatchResponse> {
    return httpClient.post<DocumentsBatchResponse>('/v1/get-documents-batch', {
      document_ids: options.document_ids,
      include_last_viewed_panel: options.include_last_viewed_panel ?? false,
    });
  }

  async function getDocumentMetadata(documentId: string): Promise<DocumentMetadata> {
    return httpClient.post<DocumentMetadata>('/v1/get-document-metadata', {
      document_id: documentId,
    });
  }

  async function getDocumentTranscript(documentId: string): Promise<TranscriptSegment[]> {
    return httpClient.post<TranscriptSegment[]>('/v1/get-document-transcript', {
      document_id: documentId,
    });
  }

  async function getDocumentLists(): Promise<DocumentList[]> {
    const response = await httpClient.post<DocumentListsResponse>('/v2/get-document-lists', {});
    return response.lists;
  }

  async function getDocumentList(folderId: string): Promise<DocumentList | null> {
    const folders = await getDocumentLists();
    return folders.find((f) => f.id === folderId) || null;
  }

  async function getWorkspaces(): Promise<WorkspacesResponse> {
    return httpClient.post<WorkspacesResponse>('/v1/get-workspaces', {});
  }

  function setToken(token: string): void {
    httpClient.setToken(token);
  }

  return {
    getDocuments,
    getDocumentsBatch,
    getDocumentMetadata,
    getDocumentTranscript,
    getDocumentLists,
    getDocumentList,
    getWorkspaces,
    setToken,
  };
}

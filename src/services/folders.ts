import type { DocumentList } from '../lib/api.js';
import { createGranolaDebug } from '../lib/debug.js';
import type { Folder } from '../types.js';
import { getClient, withTokenRefresh } from './client.js';

const debug = createGranolaDebug('service:folders');

export interface ListOptions {
  workspace?: string;
}

function normalizeFolder(folder: DocumentList): Folder {
  const documentIds = Array.isArray(folder.documents)
    ? folder.documents
        .map((doc: { id?: string }) => doc?.id)
        .filter((id: string | undefined): id is string => Boolean(id))
    : [];

  return {
    id: folder.id,
    name: folder.name ?? folder.title,
    title: folder.title ?? folder.name ?? 'Untitled',
    created_at: folder.created_at,
    workspace_id: folder.workspace_id,
    workspace_name: folder.workspace_display_name,
    owner_id: folder.owner_id,
    document_count: folder.document_count,
    document_ids: documentIds,
    is_favourited: folder.is_favourited,
  };
}

export async function list(opts: ListOptions = {}): Promise<Folder[]> {
  return withTokenRefresh(async () => {
    const client = await getClient();
    const documentLists = await client.getDocumentLists();
    const folders = documentLists.map(normalizeFolder);
    debug('list fetched %d folders', folders.length);

    if (opts.workspace) {
      const filtered = folders.filter((folder) => folder.workspace_id === opts.workspace);
      debug('filtered to %d folders for workspace %s', filtered.length, opts.workspace);
      return filtered;
    }

    return folders;
  });
}

export async function get(id: string): Promise<Folder | null> {
  return withTokenRefresh(async () => {
    debug('get called for folder: %s', id);
    const client = await getClient();
    const documentLists = await client.getDocumentLists();
    const folder = documentLists.find((f) => f.id === id);
    if (!folder) {
      debug('folder %s not found', id);
      return null;
    }
    debug('folder %s found', id);
    return normalizeFolder(folder);
  });
}

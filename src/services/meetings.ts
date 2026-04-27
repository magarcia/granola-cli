import type { GranolaApi } from '../lib/api.js';
import { createGranolaDebug } from '../lib/debug.js';
import { applyFilters, type FilterOptions, hasActiveFilters } from '../lib/filters.js';
import type { Meeting, ProseMirrorDoc, Utterance } from '../types.js';
import { getClient, withTokenRefresh } from './client.js';

const debug = createGranolaDebug('service:meetings');

export interface ListOptions extends FilterOptions {
  limit?: number;
  offset?: number;
  workspace?: string;
  folder?: string;
}

async function getFolderDocumentIds(client: GranolaApi, folderId: string): Promise<string[]> {
  debug('fetching folder %s via getDocumentList', folderId);
  const folder = await client.getDocumentList(folderId);
  if (!folder) {
    debug('folder %s not found', folderId);
    return [];
  }
  const ids = folder.document_ids || folder.documents?.map((doc: { id: string }) => doc.id) || [];
  debug('folder %s returned %d document ids', folderId, ids.length);
  return ids;
}

const DOCUMENT_BATCH_SIZE = 100;
const NOTES_PAGE_SIZE = 50;
const MAX_NOTES_PAGES = 100;

async function fetchMeetingsByIds(client: GranolaApi, documentIds: string[]): Promise<Meeting[]> {
  if (documentIds.length === 0) return [];

  const meetings: Meeting[] = [];
  for (let i = 0; i < documentIds.length; i += DOCUMENT_BATCH_SIZE) {
    const chunk = documentIds.slice(i, i + DOCUMENT_BATCH_SIZE);
    const res = await client.getDocumentsBatch({
      document_ids: chunk,
      include_last_viewed_panel: false,
    });
    const docs = (res?.documents || res?.docs || []) as Meeting[];
    meetings.push(...docs);
  }
  debug('fetched %d meetings via getDocumentsBatch', meetings.length);
  return meetings;
}

async function loadMeetingMetadata(
  client: GranolaApi,
  id: string,
): Promise<{ notes?: any; last_viewed_panel?: { content: any } } | null> {
  try {
    const metadata = await client.getDocumentMetadata(id);
    if (!metadata) {
      debug('getDocumentMetadata returned null for %s', id);
      return null;
    }
    return metadata;
  } catch (err) {
    debug('getDocumentMetadata failed for %s: %O', id, err);
    return null;
  }
}

async function fetchFolderMeetings(client: GranolaApi, folderId: string): Promise<Meeting[]> {
  const ids = await getFolderDocumentIds(client, folderId);
  if (ids.length === 0) {
    debug('folder %s has no documents', folderId);
    return [];
  }
  return fetchMeetingsByIds(client, ids);
}

export async function list(opts: ListOptions = {}): Promise<Meeting[]> {
  return withTokenRefresh(async () => {
    debug('list called with opts: %O', opts);
    const client = await getClient();
    const { limit = 20, offset = 0, workspace, folder, ...filterOpts } = opts;

    if (folder) {
      debug('listing meetings for folder: %s', folder);
      const folderMeetings = await fetchFolderMeetings(client, folder);
      debug('fetched %d meetings for folder %s', folderMeetings.length, folder);

      let filtered = folderMeetings;
      if (workspace) {
        filtered = folderMeetings.filter((m) => m.workspace_id === workspace);
        debug(
          'workspace filter applied for folder %s: %d meetings remain',
          folder,
          filtered.length,
        );
      }

      // Apply additional filters if any
      filtered = applyFilters(filtered, filterOpts);

      const paginated = filtered.slice(offset, offset + limit);
      debug('returning %d meetings from folder %s after pagination', paginated.length, folder);
      return paginated;
    }

    // When filters are active, fetch more meetings to filter from
    if (hasActiveFilters(filterOpts)) {
      debug('filters active, using cached meetings for filtering');
      let meetings = await getCachedMeetings(client);

      if (workspace) {
        meetings = meetings.filter((m) => m.workspace_id === workspace);
        debug('filtered to %d meetings for workspace: %s', meetings.length, workspace);
      }

      // Apply search/attendee/date filters
      meetings = applyFilters(meetings, filterOpts);

      // Apply pagination to filtered results
      const paginated = meetings.slice(offset, offset + limit);
      debug('returning %d meetings after filtering and pagination', paginated.length);
      return paginated;
    }

    // No filters active - use standard pagination from API
    const res = await client.getDocuments({
      limit,
      offset,
      include_last_viewed_panel: false,
    });

    let meetings = (res?.docs || []) as Meeting[];
    debug('fetched %d meetings', meetings.length);
    if (workspace) {
      meetings = meetings.filter((m) => m.workspace_id === workspace);
      debug('filtered to %d meetings for workspace: %s', meetings.length, workspace);
    }

    return meetings;
  });
}

const RESOLVE_PAGE_SIZE = 100;
const MAX_RESOLVE_PAGES = 100;
const FULL_UUID_LENGTH = 36;
const CACHE_TTL_MS = 60000;

interface MeetingsCache {
  meetings: Meeting[];
  timestamp: number;
}

let meetingsCache: MeetingsCache | null = null;

/**
 * Clears the meetings cache. Useful for testing or forcing a refresh.
 */
export function clearMeetingsCache(): void {
  meetingsCache = null;
  debug('meetings cache cleared');
}

/**
 * Fetches meetings with caching to reduce API calls.
 * Cache expires after 60 seconds.
 */
async function getCachedMeetings(client: GranolaApi): Promise<Meeting[]> {
  if (meetingsCache && Date.now() - meetingsCache.timestamp < CACHE_TTL_MS) {
    debug('using cached meetings (%d items)', meetingsCache.meetings.length);
    return meetingsCache.meetings;
  }

  debug('cache miss or expired, fetching meetings');
  const meetings: Meeting[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_RESOLVE_PAGES; page += 1) {
    const res = await client.getDocuments({
      limit: RESOLVE_PAGE_SIZE,
      offset,
      include_last_viewed_panel: false,
    });
    const docs = (res?.docs || []) as Meeting[];
    meetings.push(...docs);

    if (docs.length < RESOLVE_PAGE_SIZE) {
      break;
    }
    offset += RESOLVE_PAGE_SIZE;
  }

  meetingsCache = { meetings, timestamp: Date.now() };
  debug('cached %d meetings', meetings.length);
  return meetings;
}

export async function resolveId(partialId: string): Promise<string | null> {
  return withTokenRefresh(async () => {
    debug('resolving meeting id: %s (length: %d)', partialId, partialId.length);
    const client = await getClient();

    // Optimization: If partialId looks like a full UUID, try direct lookup first
    if (partialId.length >= FULL_UUID_LENGTH) {
      debug('attempting direct lookup for full UUID');
      try {
        const metadata = await client.getDocumentMetadata(partialId);
        if (metadata) {
          debug('direct lookup successful for: %s', partialId);
          return partialId;
        }
      } catch {
        debug('direct lookup failed, falling back to search');
      }
    }

    // Use cached meetings for prefix search
    const meetings = await getCachedMeetings(client);
    const matches = new Set<string>();

    for (const meeting of meetings) {
      if (meeting.id?.startsWith(partialId)) {
        matches.add(meeting.id);
        if (matches.size > 1) {
          debug('ambiguous id: %s matches >1 meetings', partialId);
          throw new Error(`Ambiguous ID: ${partialId} matches ${matches.size} meetings`);
        }
      }
    }

    if (matches.size === 0) {
      debug('no meeting found for id: %s', partialId);
      return null;
    }

    const match = matches.values().next().value as string;
    debug('resolved meeting: %s -> %s', partialId, match);
    return match;
  });
}

export async function get(id: string): Promise<Meeting | null> {
  return withTokenRefresh(async () => {
    debug('getting meeting: %s', id);
    const client = await getClient();
    const metadata = await loadMeetingMetadata(client, id);
    if (!metadata) {
      debug('meeting %s: not found', id);
      return null;
    }
    debug('meeting %s: found', id);
    return { id, ...metadata } as Meeting;
  });
}

interface MeetingSearchOptions {
  includeLastViewedPanel: boolean;
}

async function findMeetingViaDocuments(
  client: GranolaApi,
  id: string,
  { includeLastViewedPanel }: MeetingSearchOptions,
): Promise<Meeting | null> {
  let offset = 0;

  for (let page = 0; page < MAX_NOTES_PAGES; page += 1) {
    try {
      debug('findMeetingViaDocuments fetching page %d (offset: %d)', page, offset);
      const res = await client.getDocuments({
        limit: NOTES_PAGE_SIZE,
        offset,
        include_last_viewed_panel: includeLastViewedPanel,
      });
      const meetings = (res?.docs || []) as Meeting[];
      debug('findMeetingViaDocuments got %d meetings on page %d', meetings.length, page);
      if (meetings.length === 0) break;

      const meeting = meetings.find((m) => m.id === id);
      if (meeting) {
        debug('findMeetingViaDocuments located meeting %s on page %d', id, page);
        return meeting;
      }

      offset += NOTES_PAGE_SIZE;
    } catch (err) {
      debug('findMeetingViaDocuments error: %O', err);
      return null;
    }
  }

  debug('findMeetingViaDocuments did not locate meeting %s', id);
  return null;
}

export async function getNotes(id: string): Promise<ProseMirrorDoc | null> {
  return withTokenRefresh(async () => {
    debug('getNotes called with id: %s', id);
    const client = await getClient();
    const metadata = await loadMeetingMetadata(client, id);
    if (metadata && 'notes' in metadata) {
      debug('getNotes resolved via metadata response');
      return (metadata.notes || null) as ProseMirrorDoc | null;
    }

    const meeting = await findMeetingViaDocuments(client, id, {
      includeLastViewedPanel: false,
    });
    if (meeting) {
      return (meeting.notes || null) as ProseMirrorDoc | null;
    }

    return null;
  });
}

export async function getEnhancedNotes(id: string): Promise<ProseMirrorDoc | string | null> {
  return withTokenRefresh(async () => {
    debug('getEnhancedNotes called with id: %s', id);
    const client = await getClient();
    const metadata = await loadMeetingMetadata(client, id);
    if (metadata && 'last_viewed_panel' in metadata) {
      debug('getEnhancedNotes resolved via metadata response');
      return (metadata.last_viewed_panel?.content || null) as ProseMirrorDoc | string | null;
    }

    const meeting = await findMeetingViaDocuments(client, id, {
      includeLastViewedPanel: true,
    });
    if (meeting) {
      return (meeting.last_viewed_panel?.content || null) as ProseMirrorDoc | string | null;
    }

    return null;
  });
}

export async function getTranscript(id: string): Promise<Utterance[]> {
  return withTokenRefresh(async () => {
    debug('getTranscript called with id: %s', id);
    const client = await getClient();
    try {
      const transcript = (await client.getDocumentTranscript(id)) as Utterance[];
      debug('getTranscript got %d utterances', transcript.length);
      return transcript;
    } catch (err) {
      debug('getTranscript error: %O', err);
      return [];
    }
  });
}

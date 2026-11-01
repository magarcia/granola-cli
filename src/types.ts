// === API Types ===

export interface Person {
  name?: string;
  email?: string;
  details?: {
    person?: {
      name?: {
        fullName?: string;
      };
    };
    employment?: {
      title?: string;
      name?: string;
    };
    company?: {
      name?: string;
    };
  };
}

export interface People {
  creator?: Person;
  attendees?: Person[];
}

export interface Meeting {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  workspace_id?: string;
  notes?: ProseMirrorDoc;
  last_viewed_panel?: {
    content: ProseMirrorDoc;
  };
  people?: People;
  creator?: Person;
  attendees?: Person[];
}

export interface ProseMirrorDoc {
  type: 'doc';
  content: ProseMirrorNode[];
}

export interface ProseMirrorNode {
  type: string;
  content?: ProseMirrorNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
}

export interface Utterance {
  source: 'microphone' | 'system';
  text: string;
  start_timestamp: string;
  end_timestamp: string;
  confidence?: number;
}

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  owner_id: string;
}

export interface Folder {
  id: string;
  name?: string;
  title?: string;
  created_at: string;
  workspace_id?: string;
  workspace_name?: string;
  owner_id?: string;
  document_count?: number;
  document_ids?: string[];
  is_favourite: boolean;
}

// === CLI Types ===

export interface GlobalFlags {
  noPager: boolean;
}

export interface Config {
  default_workspace?: string;
  pager?: string;
  aliases?: Record<string, string>;
}

export interface Credentials {
  refreshToken: string;
  accessToken: string;
  clientId: string;
}

# Granola API Specification

**Version:** 1.1
**Base URL:** `https://api.granola.ai`
**Authentication:** OAuth 2.0 with refresh token rotation (via WorkOS)
**Status:** Reverse-engineered (unofficial)

> **Disclaimer:** This specification was created through reverse engineering of the Granola desktop application and API traffic analysis. It is not official documentation and may become outdated as Granola updates their API. Use at your own risk.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [API Endpoints](#api-endpoints)
4. [Data Models](#data-models)
5. [Client SDK](#client-sdk)
6. [Error Handling](#error-handling)
7. [Rate Limiting](#rate-limiting)
8. [Best Practices](#best-practices)
9. [Appendix: Token Extraction Guide](#appendix-token-extraction-guide)
10. [Version History](#version-history)
11. [Appendix: Session Preservation](#appendix-session-preservation)
12. [Credits](#credits)

---

## Overview

The Granola API provides programmatic access to meeting notes, transcripts, workspaces, and document management functionality. The API uses JSON for request and response bodies, and implements OAuth 2.0 with refresh token rotation for authentication.

This specification was derived through analysis of:
- Network traffic from the Granola Electron desktop application
- Token storage files in the application data directory
- API request/response patterns during normal application usage

### Key Concepts

- **Workspaces**: Organizations or teams that contain documents and folders
- **Document Lists (Folders)**: Collections of documents within a workspace
- **Documents**: Individual notes/meetings with transcripts and AI-generated summaries
- **Transcripts**: Audio recording utterances with timestamps and source information
- **Panel Templates**: Reusable templates for document organization

### Important Limitations

- The `/v2/get-documents` endpoint does **NOT** return shared documents - only documents owned by the authenticated user
- To fetch shared documents, use the `/v1/get-documents-batch` endpoint
- Refresh tokens are **single-use only** and must be rotated on each authentication request
- API endpoints and behavior may change without notice as this is an unofficial integration

---

## Authentication

### OAuth 2.0 Flow

Granola uses WorkOS for authentication with automatic refresh token rotation.

#### Token Storage Location (macOS)

Tokens are stored locally by the Granola desktop application at:

```
~/Library/Application Support/Granola/supabase.json
```

**File Structure:**
```json
{
  "workos_tokens": "{\"access_token\":\"...\",\"refresh_token\":\"...\",\"expires_in\":3600,...}",
  "session_id": "...",
  "user_info": "{...}"
}
```

> **Note:** The `workos_tokens` field contains a JSON string (escaped), not a JSON object. It must be parsed twice to extract the tokens.

#### Authentication Flow

1. **Initial Authentication**: Obtain `refresh_token` and `client_id` from the Granola desktop app's token storage
2. **Access Token Exchange**: Exchange refresh token for short-lived access token via WorkOS
3. **Token Rotation**: Each exchange invalidates the old refresh token and issues a new one

#### Extracting Tokens

**Extract refresh_token using jq:**
```bash
cat ~/Library/Application\ Support/Granola/supabase.json | \
  jq -r '.workos_tokens | fromjson | .refresh_token'
```

**Extract client_id from the JWT access token:**
```bash
cat ~/Library/Application\ Support/Granola/supabase.json | \
  jq -r '.workos_tokens | fromjson | .access_token' | \
  cut -d. -f2 | base64 -d 2>/dev/null | jq -r '.iss' | \
  grep -o 'client_[^"]*'
```

The `client_id` is embedded in the JWT's `iss` (issuer) claim:
```
https://auth.granola.ai/user_management/client_XXXXX
```

#### Refresh Access Token

**Endpoint:** `POST https://api.workos.com/user_management/authenticate`

**Request Headers:**
```http
Content-Type: application/json
```

**Request Body:**
```json
{
  "client_id": "client_01J9ABC...",
  "grant_type": "refresh_token",
  "refresh_token": "22oWVolI9TRlthI2J5asHbfyx"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6...",
  "refresh_token": "NewRotatedRefreshToken123",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

#### Token Rotation (CRITICAL)

⚠️ **IMPORTANT**: Refresh tokens cannot be reused. Each token is valid for **ONE use only**.

- Each authentication request automatically invalidates the old refresh token
- You **MUST** save the new `refresh_token` from the response for subsequent requests
- Attempting to reuse an old refresh token will result in authentication failure
- This prevents token replay attacks
- Access tokens expire after **3600 seconds (1 hour)**

#### Token Lifecycle Management

**Recommended Practice:**
- Refresh tokens every **~5 minutes** to maintain session continuity
- Store the new refresh token immediately after each authentication
- Implement automatic token refresh before access token expiration

**Token Storage Update (Pseudocode):**
```
# After successful authentication
config.refresh_token = response.refresh_token
save_config(config)  # Persist immediately
```

---

## API Endpoints

All API endpoints require Bearer token authentication and standard headers.

### Standard Request Headers

The minimum required headers for API requests:

```http
Authorization: Bearer {access_token}
Content-Type: application/json
Accept: */*
User-Agent: Granola/5.354.0
X-Client-Version: 5.354.0
```

### Extended Headers (Optional)

The Electron desktop client sends additional headers that can be included for better compatibility:

```http
X-App-Version: 6.4.0
X-Client-Type: electron
X-Client-Platform: darwin
X-Client-Architecture: arm64
X-Client-Id: granola-electron-6.4.0
```

> **Note:** The minimum headers (`Authorization`, `Content-Type`, `User-Agent`, `X-Client-Version`) are sufficient for API access. The extended headers mimic the official Electron client more closely.

---

### Workspace Operations

#### Get Workspaces

Retrieves all workspaces (organizations) accessible to the authenticated user.

**Endpoint:** `POST /v1/get-workspaces`

**Request Body:**
```json
{}
```

**Response (Nested format):**
```json
{
  "workspaces": [
    {
      "workspace": {
        "workspace_id": "924ba459-d11d-4da8-88c8-789979794744",
        "slug": "my-workspace",
        "display_name": "My Personal Workspace",
        "is_locked": false,
        "created_at": "2024-01-15T10:00:00.000Z",
        "updated_at": "2024-01-15T10:00:00.000Z",
        "privacy_mode_enabled": false,
        "sharing_link_visibility": null
      },
      "role": "owner",
      "plan_type": "pro"
    }
  ]
}
```

**Response (Flat format - also observed):**
```json
[
  {
    "id": "924ba459-d11d-4da8-88c8-789979794744",
    "name": "My Personal Workspace",
    "created_at": "2024-01-15T10:00:00.000Z",
    "owner_id": "user_01J9ABC..."
  }
]
```

> **Note:** The API response format may vary. Handle both nested (`workspaces[].workspace`) and flat array formats.

**Response Fields (Nested format):**

| Field | Type | Description |
|-------|------|-------------|
| `workspace_id` | string | Unique workspace identifier (UUID) |
| `slug` | string | URL-friendly workspace identifier |
| `display_name` | string | Human-readable workspace name |
| `is_locked` | boolean | Whether workspace is locked/read-only |
| `created_at` | ISO8601 | Workspace creation timestamp |
| `updated_at` | ISO8601 | Last modification timestamp |
| `privacy_mode_enabled` | boolean | Privacy mode status |
| `sharing_link_visibility` | string | Sharing visibility setting |
| `role` | string | User's role in workspace (owner/member) |
| `plan_type` | string | Subscription plan type |

**Response Fields (Flat format):**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique workspace identifier (UUID) |
| `name` | string | Workspace name |
| `created_at` | ISO8601 | Workspace creation timestamp |
| `owner_id` | string | Owner user ID |

---

### Document List Operations

Document lists are Granola's folder system for organizing documents within workspaces.

#### Get Document Lists

Retrieves all document lists (folders) accessible to the user.

**Endpoint (v2 - Preferred):** `POST /v2/get-document-lists`  
**Endpoint (v1 - Fallback):** `POST /v1/get-document-lists`

**Request Body:**
```json
{}
```

**Response (v2):**
```json
[
  {
    "id": "9f3d3537-e001-401e-8ce6-b7af6f24a450",
    "title": "Sales calls",
    "workspace_id": "924ba459-d11d-4da8-88c8-789979794744",
    "owner_id": "user_01J9ABC...",
    "created_at": "2025-10-17T11:28:08.183Z",
    "is_favourite": false,
    "documents": [
      {
        "id": "doc_123",
        "title": "Client Meeting - Acme Corp",
        "created_at": "2025-10-17T14:30:00.000Z"
      }
    ]
  }
]
```

**Response (v1):**
```json
[
  {
    "id": "9f3d3537-e001-401e-8ce6-b7af6f24a450",
    "name": "Sales calls",
    "workspace_id": "924ba459-d11d-4da8-88c8-789979794744",
    "owner_id": "user_01J9ABC...",
    "created_at": "2025-10-17T11:28:08.183Z",
    "is_favourite": false,
    "document_ids": ["doc_123", "doc_456"]
  }
]
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique list identifier (UUID) |
| `title` / `name` | string | List name (v2/v1 respectively) |
| `workspace_id` | string | Parent workspace ID |
| `owner_id` | string | User ID of list creator |
| `created_at` | ISO8601 | List creation timestamp |
| `is_favourite` | boolean | User's favourite status |
| `documents` | array | Full document objects (v2 only) |
| `document_ids` | array | Document ID strings (v1 only) |

**Notes:**
- Try v2 endpoint first, fallback to v1 if not available
- v2 returns full document objects; v1 returns only IDs
- Use v1 response with `/v1/get-documents-batch` to fetch full documents
- A document can belong to multiple lists

---

### Document Operations

#### Get Documents (Paginated)

Retrieves a paginated list of documents owned by the authenticated user.

**Endpoint:** `POST /v2/get-documents`

**⚠️ LIMITATION**: This endpoint does **NOT** return shared documents. Use `/v1/get-documents-batch` for shared documents.

**Request Body (Offset-based pagination):**
```json
{
  "limit": 100,
  "offset": 0,
  "include_last_viewed_panel": true
}
```

**Request Body (Cursor-based pagination):**
```json
{
  "workspace_id": "924ba459-d11d-4da8-88c8-789979794744",
  "limit": 100,
  "cursor": "eyJpZCI6ImRvY18xMjMiLCJ0aW1lc3RhbXAiOjE3MDUzMjAwMDB9",
  "include_last_viewed_panel": true
}
```

**Request Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `workspace_id` | string | No | - | Filter by workspace ID |
| `limit` | integer | No | 100 | Number of documents per page (max: 100) |
| `offset` | integer | No | 0 | Pagination offset (alternative to cursor) |
| `cursor` | string | No | - | Pagination cursor from previous response |
| `include_last_viewed_panel` | boolean | No | false | Include document content (ProseMirror JSON) |

> **Note:** Both offset-based and cursor-based pagination are supported. Offset-based is simpler for sequential fetching; cursor-based is more reliable for consistency.

**Response:**
```json
{
  "docs": [
    {
      "id": "doc_123",
      "created_at": "2025-08-18T14:04:59.643Z",
      "notes": {
        "type": "doc",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "Meeting notes content..."
              }
            ]
          }
        ]
      },
      "title": "Team Standup - 2025-08-18",
      "user_id": "user_01J9ABC...",
      "cloned_from": null,
      "notes_plain": "Meeting notes content...",
      "transcribe": true,
      "google_calendar_event": {
        "id": "event_123",
        "summary": "Team Standup"
      },
      "updated_at": "2025-08-18T14:30:00.000Z",
      "deleted_at": null,
      "type": "meeting",
      "overview": "Discussed project milestones and blockers",
      "public": false,
      "people": {
        "creator": {
          "name": "John Doe",
          "email": "john@example.com",
          "details": {}
        },
        "attendees": []
      },
      "chapters": null,
      "meeting_end_count": 1,
      "notes_markdown": "# Meeting Notes\n\nDiscussed...",
      "selected_template": "template_456",
      "valid_meeting": true,
      "summary": "Brief summary of meeting content",
      "has_shareable_link": false,
      "show_private_notes": true,
      "attachments": [],
      "privacy_mode_enabled": false,
      "sharing_link_visibility": "private",
      "last_viewed_panel": {
        "content": {
          "type": "doc",
          "content": []
        }
      }
    }
  ],
  "next_cursor": "eyJpZCI6ImRvY18xMjQiLCJ0aW1lc3RhbXAiOjE3MDUzMjAwMDB9"
}
```

> **Note on `last_viewed_panel.content`:** The API returns this field as either
> a ProseMirror JSON document (desktop-authored notes, shown above) or a raw
> HTML string (meetings authored via the Granola mobile app's quick-notes
> feature). Clients should handle both shapes.

**Pagination:**
- Use `next_cursor` from response for subsequent requests
- When `next_cursor` is null or absent, no more pages exist
- Maximum `limit` is 100 documents per request

---

#### Get Documents Batch

Fetch multiple documents by their IDs. **This is the recommended method for fetching documents from folders and shared documents.**

**Endpoint:** `POST /v1/get-documents-batch`

**Request Body:**
```json
{
  "document_ids": ["doc_123", "doc_456", "doc_789"],
  "include_last_viewed_panel": true
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `document_ids` | array | Yes | Array of document IDs to fetch (max: 100) |
| `include_last_viewed_panel` | boolean | No | Include document content |

**Response:**
```json
{
  "documents": [
    {
      "id": "doc_123",
      "title": "Client Meeting - Acme Corp",
      "created_at": "2025-08-18T14:04:59.643Z",
      "updated_at": "2025-08-18T14:30:00.000Z",
      "workspace_id": "924ba459-d11d-4da8-88c8-789979794744",
      "notes_markdown": "# Meeting Notes\n\n...",
      "last_viewed_panel": {
        "content": {
          "type": "doc",
          "content": []
        }
      }
    }
  ]
}
```

**Notes:**
- Returns both owned and shared documents
- Batch size limit: typically 100 documents per request
- Response may use `documents` or `docs` field name depending on API version
- **Recommended workflow for folders:**
  1. Use `/v2/get-document-lists` to get folder contents (returns document IDs)
  2. Use `/v1/get-documents-batch` to fetch actual documents (including shared ones)

---

#### Get Document Metadata

Retrieves metadata for a specific document, including creator and attendee information.

**Endpoint:** `POST /v1/get-document-metadata`

**Request Body:**
```json
{
  "document_id": "doc_123"
}
```

**Response:**
```json
{
  "creator": {
    "name": "John Doe",
    "email": "john@example.com",
    "details": {
      "person": {
        "name": {
          "fullName": "John Doe"
        },
        "avatar": "https://example.com/avatar.jpg",
        "employment": {
          "title": "Product Manager",
          "name": "Acme Corp"
        }
      },
      "company": {
        "name": "Acme Corp"
      }
    }
  },
  "attendees": [
    {
      "name": "Jane Smith",
      "email": "jane@example.com"
    }
  ]
}
```

---

#### Get Document Transcript

Retrieves the audio transcript for a specific document, including timestamps and speaker information.

**Endpoint:** `POST /v1/get-document-transcript`

**Request Body:**
```json
{
  "document_id": "doc_123"
}
```

**Response:**
```json
[
  {
    "document_id": "doc_123",
    "start_timestamp": "2025-08-18T14:04:59.643Z",
    "text": "Hello everyone, let's start the meeting",
    "source": "microphone",
    "id": "segment_001",
    "is_final": true,
    "end_timestamp": "2025-08-18T14:05:01.183Z"
  },
  {
    "document_id": "doc_123",
    "start_timestamp": "2025-08-18T14:05:01.183Z",
    "text": "Thanks for joining",
    "source": "system",
    "id": "segment_002",
    "is_final": true,
    "end_timestamp": "2025-08-18T14:05:03.000Z"
  }
]
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `document_id` | string | Document identifier |
| `id` | string | Unique segment identifier |
| `text` | string | Transcribed text |
| `source` | string | Audio source: `microphone` or `system` |
| `start_timestamp` | ISO8601 | Utterance start time |
| `end_timestamp` | ISO8601 | Utterance end time |
| `is_final` | boolean | Whether transcription is finalized |

**Notes:**
- Returns `404` if document has no associated transcript
- Transcripts are generated from meeting recordings
- Returns empty array `[]` for documents without transcripts

---

#### Update Document

Updates a document's properties.

**Endpoint:** `POST /v1/update-document`

**Request Body:**
```json
{
  "document_id": "doc_123",
  "title": "Updated Meeting Title",
  "notes_markdown": "# Updated Notes\n\nNew content..."
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `document_id` | string | Yes | Document to update |
| `title` | string | No | New document title |
| `notes_markdown` | string | No | Document content in Markdown |

**Response:**
```json
{
  "success": true
}
```

---

#### Update Document Panel

Updates a specific panel within a document.

**Endpoint:** `POST /v1/update-document-panel`

**Request Body:**
```json
{
  "document_id": "doc_123",
  "panel_id": "panel_456",
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [
          {
            "type": "text",
            "text": "Panel content..."
          }
        ]
      }
    ]
  }
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `document_id` | string | Yes | Document containing the panel |
| `panel_id` | string | Yes | Panel to update |
| `content` | object | No | ProseMirror document content |

**Response:**
```json
{
  "success": true
}
```

---

### Template Operations

#### Get Panel Templates

Retrieves available panel templates for document organization.

**Endpoint:** `POST /v1/get-panel-templates`

**Request Body:**
```json
{}
```

**Response:**
```json
[
  {
    "id": "template_123",
    "is_granola": true,
    "created_at": "2024-01-15T10:00:00.000Z",
    "owner_id": null,
    "category": "meeting",
    "title": "Team Meeting",
    "deleted_at": null,
    "sections": [
      {
        "id": "section_001",
        "heading": "Agenda",
        "section_description": "Meeting topics and goals"
      },
      {
        "id": "section_002",
        "heading": "Action Items",
        "section_description": "Tasks and next steps"
      }
    ],
    "color": "#3B82F6",
    "symbol": "📝",
    "description": "Template for team meetings",
    "shared_with": "workspace",
    "copied_from": null,
    "updated_at": "2024-01-15T10:00:00.000Z",
    "user_types": [
      {
        "user_type": "manager"
      }
    ]
  }
]
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique template identifier |
| `is_granola` | boolean | Whether template is official Granola template |
| `title` | string | Template name |
| `category` | string | Template category |
| `sections` | array | Template sections with headings |
| `color` | string | Hex color code |
| `symbol` | string | Emoji or icon symbol |
| `description` | string | Template description |
| `shared_with` | string | Sharing scope |
| `owner_id` | string | Template creator (null for official) |

**Notes:**
- Returns empty array `[]` if no templates available
- Official Granola templates have `is_granola: true`
- Custom templates have `owner_id` set to creator's user ID

---

### Additional Operations

#### Get People

Retrieves people data and contacts.

**Endpoint:** `POST /v1/get-people`

**Request Body:**
```json
{}
```

**Response:** Implementation-specific, returns people/contacts data.

---

#### Get Feature Flags

Retrieves feature flags for the authenticated user.

**Endpoint:** `POST /v1/get-feature-flags`

**Request Body:**
```json
{}
```

**Response:** Feature flag configuration object.

---

#### Get Notion Integration

Retrieves Notion integration details.

**Endpoint:** `POST /v1/get-notion-integration`

**Request Body:**
```json
{}
```

**Response:** Notion integration configuration.

---

#### Get Subscriptions

Retrieves subscription information for the authenticated user.

**Endpoint:** `POST /v1/get-subscriptions`

**Request Body:**
```json
{}
```

**Response:** Subscription and billing information.

---

#### Refresh Google Events

Refreshes Google Calendar events integration.

**Endpoint:** `POST /v1/refresh-google-events`

**Request Body:**
```json
{}
```

**Response:**
```json
{
  "success": true
}
```

---

#### Check for Update

Checks for application updates (macOS).

**Endpoint:** `GET /v1/check-for-update/latest-mac.yml`

**Response:** YAML file with update information.

---

## Data Models

### Workspace

```typescript
interface Workspace {
  workspace_id: string;           // UUID
  slug: string;                   // URL-friendly identifier
  display_name: string;           // Human-readable name
  is_locked: boolean;             // Read-only status
  created_at: string;             // ISO8601 timestamp
  updated_at: string;             // ISO8601 timestamp
  privacy_mode_enabled: boolean;  // Privacy mode status
  sharing_link_visibility: string | null;  // Sharing setting
}

interface WorkspaceResponse {
  workspaces: Array<{
    workspace: Workspace;
    role: string;                 // "owner" | "member"
    plan_type: string;            // Subscription tier
  }>;
}
```

---

### Document List (Folder)

```typescript
interface DocumentList {
  id: string;                     // UUID
  title?: string;                 // v2 field
  name?: string;                  // v1 field
  workspace_id: string;           // Parent workspace
  owner_id: string;               // Creator user ID
  created_at: string;             // ISO8601 timestamp
  is_favourite: boolean;          // User's favourite status
  documents?: Document[];         // v2: Full document objects
  document_ids?: string[];        // v1: Document IDs only
}
```

---

### Document

```typescript
interface Document {
  id: string;                     // Unique identifier
  created_at: string;             // ISO8601 timestamp
  updated_at: string;             // ISO8601 timestamp
  title: string;                  // Document title
  user_id: string;                // Owner user ID
  workspace_id?: string;          // Parent workspace
  cloned_from: string | null;     // Source document if cloned
  notes: ProseMirrorDocument;     // Structured content
  notes_plain: string;            // Plain text content
  notes_markdown: string;         // Markdown content
  transcribe: boolean;            // Whether to transcribe
  google_calendar_event: object | null;  // Calendar integration
  deleted_at: string | null;      // Soft delete timestamp
  type: string | null;            // Document type
  overview: string | null;        // AI-generated overview
  public: boolean;                // Public visibility
  people: DocumentPeople;         // Creator and attendees
  chapters: any[] | null;         // Document chapters
  meeting_end_count: number;      // Meeting session count
  selected_template: string | null;  // Applied template ID
  valid_meeting: boolean;         // Meeting validation status
  summary: string | null;         // AI-generated summary
  has_shareable_link: boolean;    // Sharing link status
  show_private_notes: boolean;    // Private notes visibility
  attachments: any[];             // File attachments
  privacy_mode_enabled: boolean;  // Privacy mode status
  sharing_link_visibility: string;  // Sharing visibility
  last_viewed_panel?: {           // Panel content (optional)
    content: ProseMirrorDocument;
  };
}

interface DocumentPeople {
  creator: {
    name: string;
    email: string;
    details: object;
  };
  attendees: any[];
}

interface ProseMirrorDocument {
  type: "doc";
  content: Array<{
    type: string;
    content?: any[];
    [key: string]: any;
  }>;
}
```

---

### Document Metadata

```typescript
interface DocumentMetadata {
  creator: {
    name: string;
    email: string;
    details: {
      person?: {
        name: {
          fullName: string;
        };
        avatar?: string;
        employment?: {
          title: string;
          name: string;
        };
      };
      company?: {
        name: string;
      };
    };
  };
  attendees: any[];
}
```

---

### Transcript Segment

```typescript
interface TranscriptSegment {
  document_id: string;
  start_timestamp: string;        // ISO8601
  end_timestamp: string;          // ISO8601
  text: string;                   // Transcribed text
  source: "microphone" | "system";  // Audio source
  id: string;                     // Segment identifier
  is_final: boolean;              // Finalization status
}
```

---

### Panel Template

```typescript
interface PanelTemplate {
  id: string;
  is_granola: boolean;            // Official template
  created_at: string;             // ISO8601
  updated_at: string;             // ISO8601
  owner_id: string | null;        // null for official
  category: string;               // Template category
  title: string;                  // Template name
  deleted_at: string | null;      // Soft delete timestamp
  sections: Array<{
    id: string;
    heading: string;
    section_description: string;
  }>;
  color: string;                  // Hex color code
  symbol: string;                 // Emoji/icon
  description: string;            // Template description
  shared_with: string;            // Sharing scope
  copied_from: string;            // Source template
  user_types: Array<{
    user_type: string;
  }>;
}
```

---

## Client SDK

### TypeScript/JavaScript Client

**Installation:**

```bash
npm install granola-ts-client
# or
bun add granola-ts-client
```

**Basic Usage:**

```typescript
import GranolaClient from 'granola-ts-client';

// Initialize with token
const client = new GranolaClient('your-access-token');

// Or with options object (v0.11.0+)
const client = new GranolaClient({
  apiKey: 'your-access-token',
  baseUrl: 'https://api.granola.ai',
  httpOpts: {
    timeout: 10000,
    retries: 3
  }
});

// Fetch workspaces
const workspaces = await client.getWorkspaces();

// Fetch documents with pagination
const docs = await client.getDocuments({
  workspace_id: 'workspace-id',
  limit: 50
});

// Iterate through all documents
for await (const doc of client.listAllDocuments({ workspace_id: 'id' })) {
  console.log(doc.title);
}
```

**Token Extraction Utility:**

```typescript
import { extractGranolaToken } from 'granola-ts-client/utils';

// Extract token from Granola desktop app (Node.js/Bun only)
const tokenInfo = await extractGranolaToken();

if (tokenInfo?.isValid) {
  const client = new GranolaClient(tokenInfo.accessToken);
}
```

---

### Client Methods

#### New Method Names (v0.11.0+)

```typescript
// Authentication
client.setToken(token: string): void

// Workspaces
client.getWorkspaces(body?: object): Promise<WorkspaceResponse>

// Documents
client.getDocuments(options?: object): Promise<DocumentsResponse>
client.getDocumentMetadata(documentId: string): Promise<DocumentMetadata>
client.getDocumentTranscript(documentId: string): Promise<TranscriptSegment[]>
client.updateDocument(documentId: string, updates: object): Promise<any>
client.updateDocumentPanel(documentId: string, panelId: string, content?: any): Promise<any>

// Iteration
client.listAllDocuments(options?: object): AsyncGenerator<Document>

// Templates
client.getPanelTemplates(body?: object): Promise<PanelTemplate[]>

// Additional
client.getPeople(body?: object): Promise<any>
client.getFeatureFlags(body?: object): Promise<any>
client.getNotionIntegration(body?: object): Promise<any>
client.getSubscriptions(body?: object): Promise<any>
client.refreshGoogleEvents(body?: object): Promise<any>
client.checkForUpdate(): Promise<any>
```

#### Legacy Method Names (Backwards Compatible)

```typescript
client.v1_get_workspaces(body?: object)
client.v2_get_documents(body?: object)
client.v1_get_document_metadata(body: { document_id: string })
client.v1_get_document_transcript(body: { document_id: string })
client.v1_update_document(body: { document_id: string, ... })
client.v1_update_document_panel(body: { document_id: string, panel_id: string, content?: any })
client.v1_get_panel_templates(body?: object)
// ... and more
```

---

### HTTP Client Configuration

```typescript
interface HttpOpts {
  timeout?: number;               // Request timeout (default: 5000ms)
  retries?: number;               // Retry attempts (default: 3)
  appVersion?: string;            // App version (default: "6.4.0")
  clientType?: string;            // Client type (default: "electron")
  clientPlatform?: string;        // OS platform (default: "darwin")
  clientArchitecture?: string;    // CPU architecture (default: "arm64")
  electronVersion?: string;       // Electron version
  chromeVersion?: string;         // Chrome version
  nodeVersion?: string;           // Node.js version
  osVersion?: string;             // OS version
  osBuild?: string;               // OS build number
  clientHeaders?: Record<string, string>;  // Additional headers
}
```

---

## Error Handling

### HTTP Status Codes

| Code | Description | Action |
|------|-------------|--------|
| 200 | Success | Request completed successfully |
| 204 | No Content | Success with no response body |
| 400 | Bad Request | Check request parameters |
| 401 | Unauthorized | Token expired or invalid - refresh token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 429 | Too Many Requests | Rate limited - retry with backoff |
| 500 | Internal Server Error | Server error - retry with backoff |
| 502 | Bad Gateway | Temporary server issue - retry |
| 503 | Service Unavailable | Service down - retry later |

---

### Error Response Format

```json
{
  "error": {
    "code": "INVALID_TOKEN",
    "message": "The access token is invalid or expired",
    "details": {}
  }
}
```

---

### Client Error Handling

```typescript
try {
  const docs = await client.getDocuments();
} catch (error) {
  if (error.status === 401) {
    // Refresh access token
    await refreshAccessToken();
    // Retry request
  } else if (error.status === 429) {
    // Rate limited - implement exponential backoff
    await sleep(retryAfter * 1000);
  } else {
    // Handle other errors
    console.error('API Error:', error.message);
  }
}
```

---

### Automatic Retry Logic

The TypeScript client includes automatic retry logic:

- **Retryable errors**: 429, 500-599 status codes
- **Retry strategy**: Exponential backoff (250ms × 2^attempt)
- **Default retries**: 3 attempts
- **Configurable**: Via `HttpOpts.retries` parameter

```typescript
const client = new GranolaClient({
  apiKey: 'token',
  httpOpts: {
    retries: 5,        // Increase retry attempts
    timeout: 10000     // 10 second timeout
  }
});
```

---

## Rate Limiting

### Limits

- **Rate limit**: Not publicly documented
- **Retry-After header**: Included in 429 responses
- **Recommended behavior**: Implement exponential backoff

### Recommended Practice

```typescript
async function fetchWithBackoff(fetchFn: () => Promise<any>, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fetchFn();
    } catch (error) {
      if (error.status === 429 && attempt < maxRetries - 1) {
        const retryAfter = error.headers?.['retry-after'] || (2 ** attempt);
        await sleep(retryAfter * 1000);
        continue;
      }
      throw error;
    }
  }
}
```

---

## Best Practices

### 1. Token Management

**✅ DO:**
- Refresh access tokens every ~5 minutes to maintain session continuity
- Save new refresh tokens immediately after each authentication
- Implement automatic token refresh before expiration
- Store tokens securely (environment variables, secure storage)

**❌ DON'T:**
- Reuse refresh tokens (they're single-use only)
- Store tokens in client-side code or version control
- Let tokens expire without automatic refresh
- Share tokens between different users or applications

---

### 2. Pagination

**✅ DO:**
- Use cursors for consistent pagination
- Process results in batches
- Handle empty result sets gracefully

**❌ DON'T:**
- Use offset-based pagination (cursors are more reliable)
- Assume page size equals actual results
- Fetch all data at once (memory intensive)

**Example:**

```typescript
async function fetchAllDocuments(workspaceId: string) {
  const allDocs: Document[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.getDocuments({
      workspace_id: workspaceId,
      limit: 100,
      cursor
    });

    allDocs.push(...(response.docs || []));
    cursor = response.next_cursor;
  } while (cursor);

  return allDocs;
}

// Or use the built-in iterator
for await (const doc of client.listAllDocuments({ workspace_id: workspaceId })) {
  // Process each document
  console.log(doc.title);
}
```

---

### 3. Fetching Shared Documents

**⚠️ IMPORTANT**: The `/v2/get-documents` endpoint does NOT return shared documents.

**Recommended workflow:**

```typescript
// 1. Get folder contents
const folders = await client.getDocumentLists();
const folder = folders.find(f => f.title === 'Sales calls');

// 2. Extract document IDs
const docIds = folder.document_ids || folder.documents?.map(d => d.id);

// 3. Fetch documents in batches (including shared docs)
const batchSize = 100;
for (let i = 0; i < docIds.length; i += batchSize) {
  const batch = docIds.slice(i, i + batchSize);
  const response = await fetch('https://api.granola.ai/v1/get-documents-batch', {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      document_ids: batch,
      include_last_viewed_panel: true
    })
  });
  const { documents } = await response.json();
  // Process documents...
}
```

---

### 4. Error Handling

**✅ DO:**
- Implement comprehensive error handling
- Log errors with context
- Retry transient errors with backoff
- Validate input parameters

**❌ DON'T:**
- Silently swallow errors
- Retry non-retryable errors (400, 403, 404)
- Ignore rate limiting (429)

---

### 5. Performance Optimization

**✅ DO:**
- Batch requests when possible
- Cache frequently accessed data
- Use pagination for large datasets
- Include only necessary fields (`include_last_viewed_panel` when needed)

**❌ DON'T:**
- Make sequential requests when batch endpoints exist
- Fetch full document content unnecessarily
- Poll for updates (implement webhook listeners if available)

---

### 6. Data Consistency

**✅ DO:**
- Handle eventual consistency (workspace/folder assignments may lag)
- Validate response data structure
- Account for null/undefined fields

**❌ DON'T:**
- Assume immediate consistency across endpoints
- Skip null checks on optional fields

---

## Appendix: Token Extraction Guide

### Extract from Granola Desktop App (macOS)

**Location:**
```bash
~/Library/Application Support/Granola/supabase.json
```

**File Structure:**
```json
{
  "workos_tokens": "{\"access_token\":\"...\",\"refresh_token\":\"...\",\"expires_in\":3600,...}",
  "session_id": "...",
  "user_info": "{...}"
}
```

**Extract Refresh Token:**
```bash
cat ~/Library/Application\ Support/Granola/supabase.json | \
  jq -r '.workos_tokens | fromjson | .refresh_token'
```

**Extract Client ID from JWT:**
```bash
cat ~/Library/Application\ Support/Granola/supabase.json | \
  jq -r '.workos_tokens | fromjson | .access_token' | \
  cut -d. -f2 | base64 -d 2>/dev/null | \
  jq -r '.iss' | grep -o 'client_[^"]*'
```

**Preserve Session:**
1. Login to Granola app
2. Extract tokens from `supabase.json`
3. Quit Granola (Cmd+Q)
4. Remove app data: `rm -rf ~/Library/Application\ Support/Granola/`
5. Use extracted tokens in your application
6. Refresh tokens every ~5 minutes to maintain session

---

## Version History

- **v1.1** - Updated based on additional reverse engineering sources
  - Added token extraction methods from desktop app
  - Documented offset-based pagination
  - Added session preservation guidance
  - Clarified minimum required headers
- **v1.0** - Initial specification based on reverse engineering and TypeScript client v0.11.0

---

## Appendix: Session Preservation

### Preventing Token Invalidation

When the Granola desktop app starts, it may invalidate existing tokens. To preserve your extracted tokens for programmatic access:

1. **Login to Granola app** to generate a valid session
2. **Extract tokens** from `supabase.json` (see [Token Storage Location](#token-storage-location-macos))
3. **Quit Granola completely** (Cmd+Q on macOS)
4. **Remove application data** to prevent session conflicts:
   ```bash
   rm -rf ~/Library/Application\ Support/Granola/
   ```

**Why this works:** Once you remove the Granola app data, the app cannot invalidate your extracted refresh token when it starts again. Your script will keep the token alive through continuous rotation.

### Keeping Sessions Alive

Refresh tokens every ~5 minutes to maintain session continuity. Implement a background process or scheduler that periodically calls the token refresh endpoint.

**Why ~5 minutes?** While access tokens last 1 hour, refreshing frequently ensures:
- The refresh token doesn't expire from inactivity
- You always have a fresh, valid token
- Your session stays active even if Granola's backend has shorter session timeouts

---

## Credits

This specification was created through reverse engineering efforts:

- **Original reverse engineering research:** [Joseph Thacker - "Reverse Engineering Granola Notes"](https://josephthacker.com/hacking/2025/05/08/reverse-engineering-granola-notes.html)
  - Initial discovery of API endpoint structure
  - Token storage location identification
  - ProseMirror content format analysis
- **Python reference implementation:** [getprobo/reverse-engineering-granola-api](https://github.com/getprobo/reverse-engineering-granola-api)
  - Token rotation implementation
  - Batch document fetching
  - Workspace and folder API documentation
- **TypeScript client implementation:** granola-ts-client
- **API documentation:** Compiled from source code analysis, network traffic inspection, and API observations

### Methodology

The reverse engineering process involved:
1. Inspecting the Granola Electron app's network traffic
2. Analyzing the token storage file (`supabase.json`)
3. Decoding JWT tokens to understand authentication structure
4. Testing API endpoints with extracted tokens
5. Documenting request/response formats through trial and observation
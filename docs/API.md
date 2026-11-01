# API Documentation

This document describes the internal APIs and types used by Granola CLI.

The HTTP client uses Granola's unofficial desktop API at `https://api.granola.ai`. It does not use the official public API or public API keys.

## Types

All types are defined in `src/types.ts`.

### Person

```typescript
interface Person {
  name?: string;
  email?: string;
  details?: {
    employment?: {
      title?: string;
      name?: string;  // company name
    };
    company?: {
      name?: string;
    };
  };
}
```

### People

```typescript
interface People {
  creator?: Person;
  attendees?: Person[];
}
```

### Meeting

```typescript
interface Meeting {
  id: string;
  title: string;
  created_at: string;
  updated_at?: string;
  workspace_id?: string;
  folder_id?: string;
  last_viewed_panel?: {
    content?: ProseMirrorDoc;
  };
  people?: People;
}
```

### ProseMirrorDoc

The notes content uses ProseMirror's JSON format:

```typescript
interface ProseMirrorDoc {
  type: 'doc';
  content: ProseMirrorNode[];
}

interface ProseMirrorNode {
  type: string;
  content?: ProseMirrorNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}
```

Supported node types:
- `heading` (with `level` attribute: 1-6)
- `paragraph`
- `bulletList`, `orderedList`, `listItem`
- `blockquote`
- `codeBlock` (with `language` attribute)
- `horizontalRule`
- `hardBreak`

Supported mark types:
- `bold`, `italic`, `strike`, `underline`
- `code` (inline code)
- `link` (with `href` attribute)

### Utterance (Transcript)

```typescript
interface Utterance {
  speaker: string;
  text: string;
  timestamp?: number;
  source?: 'microphone' | 'system';
}
```

### Workspace

```typescript
interface Workspace {
  id: string;
  name: string;
  created_at: string;
}
```

### Folder

```typescript
interface Folder {
  id: string;
  name?: string;
  title?: string;
  workspace_id?: string;
  workspace_name?: string;
  owner_id?: string;
  created_at: string;
  document_ids?: string[];
  document_count?: number;
  is_favourite: boolean;
}
```

### Credentials

```typescript
interface Credentials {
  refreshToken: string;
  accessToken: string;
  clientId: string;
}
```

### Config

```typescript
interface Config {
  default_workspace?: string;
  pager?: string;
  aliases?: Record<string, string>;
}
```

## Services

### client.ts

Manages the Granola API client instance.

```typescript
// Get authenticated client (exits with code 2 if not authenticated)
async function getClient(): Promise<GranolaClient>

// Reset client (for testing)
function resetClient(): void
```

### meetings.ts

Meeting operations.

```typescript
interface FilterOptions {
  search?: string;    // Case-insensitive title search
  attendee?: string;  // Partial match on attendee name or email
  date?: Date;        // Filter to specific date
  since?: Date;       // Filter from date (inclusive)
  until?: Date;       // Filter up to date (inclusive)
}

interface ListOptions extends FilterOptions {
  limit?: number;
  offset?: number;
  workspace?: string;
  folder?: string;
}

// List meetings (with optional filtering)
async function list(options?: ListOptions): Promise<Meeting[]>

// Resolve partial meeting ID to full ID (prefix matching)
async function resolveId(partialId: string): Promise<string | null>

// Get the full document from a batch response, enriched with participant metadata
async function get(id: string): Promise<Meeting | null>

// Get manual meeting notes (user-written); non-404 errors propagate
async function getNotes(id: string): Promise<ProseMirrorDoc | null>

// Get AI-enhanced meeting notes (from last_viewed_panel); non-404 errors propagate
async function getEnhancedNotes(id: string): Promise<ProseMirrorDoc | null>

// Get meeting transcript; a missing transcript (HTTP 404) returns [].
// Authentication, server, and network errors propagate.
async function getTranscript(id: string): Promise<Utterance[]>
```

### workspaces.ts

Workspace operations.

```typescript
// List all workspaces
async function list(): Promise<Workspace[]>

// Get a single workspace
async function get(id: string): Promise<Workspace | null>
```

### folders.ts

Folder operations.

Folders come from `POST /v1/get-document-lists-metadata` with `include_document_ids: true` and `include_only_joined_lists: false`. The response contains a `lists` object keyed by folder ID. Normalization preserves explicit `document_ids` and maps the API's `is_favourited` field to `Folder.is_favourite`.

```typescript
interface ListOptions {
  workspace?: string;
}

// List folders
async function list(options?: ListOptions): Promise<Folder[]>

// Get a single folder
async function get(id: string): Promise<Folder | null>
```

## Libraries

### auth.ts

Credential management using system keychain.

```typescript
// Get stored credentials
async function getCredentials(): Promise<Credentials | null>

// Validate the stored session, refreshing rejected access tokens when possible
async function getAuthenticatedCredentials(): Promise<Credentials | null>

// Validate credentials with Granola's get-user-info endpoint
async function validateCredentials(creds: Credentials): Promise<boolean>

// Refresh through Granola's backend and persist rotated credentials
async function refreshAccessToken(): Promise<Credentials | null>

// Save credentials; session replacement callers must hold the refresh lock
async function saveCredentials(creds: Credentials): Promise<void>

// Delete credentials
async function deleteCredentials(): Promise<void>

// Parse desktop token stores and browser token responses
function parseSupabaseJson(json: string): Credentials | null
```

### browser-auth.ts

Browser sign-in uses PKCE and a one-time redirect code. The CLI verifies the final browser address and its sign-in state. The verifier stays in memory. Requests time out after 15 seconds, and interactive sign-in expires after five minutes.

`auth login` supports Google and Microsoft through `--provider google|microsoft`. `--browser` starts a new sign-in even when a valid CLI session exists.

On macOS, browser sign-in opens Chrome and uses `chrome-callback.ts` to read the matching redirect from any Chrome window by default. macOS Automation permission is required. Detection stops on completion, cancellation, failure, or after one minute. The CLI asks for manual paste if detection fails or times out. `--no-auto-callback` skips detection and opens the default browser. Other platforms use manual paste.

### config.ts

Configuration management using conf package.

```typescript
// Get entire config
function getConfig(): Config

// Get a config value
function getConfigValue<K extends keyof Config>(key: K): Config[K]

// Set a config value
function setConfigValue<K extends keyof Config>(key: K, value: Config[K]): void

// Reset config to defaults
function resetConfig(): void

// Alias management
function getAlias(name: string): string | undefined
function setAlias(name: string, command: string): void
function deleteAlias(name: string): void
function listAliases(): Record<string, string>
```

### output.ts

Table formatting and output utilities.

```typescript
interface ColumnDef<T> {
  key: keyof T;
  header: string;
  width?: number;
  format?: (value: unknown) => string;
}

// Format data as a table
function table<T extends object>(data: T[], columns: ColumnDef<T>[]): string

// Format ISO date string
function formatDate(isoDate: string): string

// Format duration in seconds
function formatDuration(seconds: number): string

// Truncate string to length
function truncate(str: string, length: number): string
```

### pager.ts

Pager integration for long content.

```typescript
// Pipe content through system pager
async function pipeToPager(content: string): Promise<void>
```

Uses `GRANOLA_PAGER`, then `PAGER` environment variable, then `less -R` as fallback.

### prosemirror.ts

Convert ProseMirror JSON to Markdown.

```typescript
// Convert ProseMirror document to Markdown string
function toMarkdown(doc: ProseMirrorDoc): string
```

### transcript.ts

Transcript formatting.

```typescript
interface FormatOptions {
  timestamps?: boolean;
  source?: 'microphone' | 'system' | 'all';
}

// Format transcript as readable text
function formatTranscript(utterances: Utterance[], options?: FormatOptions): string
```

### date-parser.ts

Natural language date parsing (zero dependencies).

```typescript
// Parse natural date string to Date object
// Supports: today, yesterday, tomorrow, last week, last month,
// N days/weeks/months ago, YYYY-MM-DD, Dec 20, 20 Dec 2024
function parseDate(input: string): Date | null

// Parse and validate date for CLI option, throws on invalid
function validateDateOption(value: string, optionName: string): Date
```

### filters.ts

Meeting filter utilities.

```typescript
interface FilterOptions {
  search?: string;
  attendee?: string;
  date?: Date;
  since?: Date;
  until?: Date;
}

// Case-insensitive partial match on meeting title
function matchesSearch(meeting: Meeting, query: string): boolean

// Partial match on attendee name or email (case-insensitive)
function matchesAttendee(meeting: Meeting, query: string): boolean

// Check if meeting falls on specific date
function matchesDate(meeting: Meeting, date: Date): boolean

// Check if meeting is within date range (inclusive)
function matchesDateRange(meeting: Meeting, since?: Date, until?: Date): boolean

// Check if any filters are active
function hasActiveFilters(options: FilterOptions): boolean

// Apply all filters to meeting list (AND logic)
function applyFilters(meetings: Meeting[], options: FilterOptions): Meeting[]
```

## Command Factory Functions

All commands export factory functions for testability:

```typescript
// Each command file exports:
export function createXxxCommand(): Command
export const xxxCommand: Command  // Pre-created instance
```

### Meeting Commands

- `createListCommand()` - `meeting list`
- `createViewCommand()` - `meeting view <id>`
- `createNotesCommand()` - `meeting notes <id>` (manual notes)
- `createEnhancedCommand()` - `meeting enhanced <id>` (AI-enhanced notes)
- `createTranscriptCommand()` - `meeting transcript <id>`
- `createExportCommand()` - `meeting export <id>`

### Workspace Commands

- `createListCommand()` - `workspace list`
- `createViewCommand()` - `workspace view <id>`

### Folder Commands

- `createListCommand()` - `folder list`
- `createViewCommand()` - `folder view <id>`

### Auth Commands

- `createLoginCommand()` - `login import/stdin`
- `createLogoutCommand()` - `auth logout`
- `createStatusCommand()` - `auth status`

### Config Command

- `createConfigCommand()` - `config list/get/set/reset`

### Alias Command

- `createAliasCommand()` - `alias list/set/delete`

## Exit Codes

| Code | Constant | Description |
|------|----------|-------------|
| 0 | - | Success |
| 1 | - | General error |
| 2 | - | Authentication required |
| 4 | - | Resource not found |

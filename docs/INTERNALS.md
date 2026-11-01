# Internals

This document provides a technical deep-dive into the architecture and implementation details of Granola CLI.

## Table of Contents

- [How It Works](#how-it-works)
- [Entry Point (main.ts)](#entry-point-maints)
- [Client Singleton Pattern](#client-singleton-pattern)
- [Service Layer](#service-layer)
- [Content Transformation](#content-transformation)
- [Output System](#output-system)
- [Configuration System](#configuration-system)
- [Authentication](#authentication)
- [Alias System](#alias-system)
- [Testing Infrastructure](#testing-infrastructure)

## How It Works

Granola CLI is a Node.js command-line application that provides a user-friendly interface for managing Granola meeting notes. It uses a native HTTP client to communicate with the Granola API. The architecture follows a layered approach:

1. **Entry Point** - Parses commands and handles alias expansion
2. **Command Layer** - Implements individual CLI commands using Commander.js
3. **Service Layer** - Abstracts API calls with type safety and error handling
4. **Client Layer** - Native HTTP/API client with automatic token refresh and retry logic
5. **Library Utilities** - Content transformation, output formatting, configuration management

Data flows from user input through commands to services, which interact with the API client. Responses are transformed and formatted for either human-readable or machine-readable output.

## Entry Point (main.ts)

The entry point creates the Commander program and wires together all components:

```typescript
const program = new Command();

program
  .name('granola')
  .description('CLI for Granola meeting notes')
  .version(packageJson.version)
  .option('--no-pager', 'Disable pager');

// Add commands
program.addCommand(authCommand);
program.addCommand(meetingCommand);
program.addCommand(workspaceCommand);
program.addCommand(folderCommand);
program.addCommand(configCommand);
program.addCommand(aliasCommand);
```

### Registered Commands

The CLI registers 6 top-level commands:

1. `auth` - Authentication management (login, logout, status)
2. `meeting` - Meeting operations (list, view, notes, enhanced, transcript, export)
3. `workspace` - Workspace operations (list, view)
4. `folder` - Folder operations (list, view)
5. `config` - Configuration management
6. `alias` - Alias management

### Global Flags

Global flags are available on all commands:

- `--no-pager` - Disable automatic paging of long output

Structured output is exposed on each command via `-o/--output <format>` (e.g., `json`, `yaml`, `toon`), which routes through the shared formatter.

### Alias Expansion

Before Commander parses arguments, the entry point checks for alias expansion:

```typescript
function expandAlias(args: string[]): string[] {
  if (args.length < 3) return args;

  const command = args[2];
  const alias = getAlias(command);

  if (alias) {
    const aliasArgs = parseAliasArguments(alias);
    return [...args.slice(0, 2), ...aliasArgs, ...args.slice(3)];
  }

  return args;
}

const expandedArgs = expandAlias(process.argv);
program.parseAsync(expandedArgs);
```

This allows users to define shortcuts like `ls` → `meeting list --limit 50`.

`parseAliasArguments()` lives in `src/lib/alias.ts` alongside validation helpers. It wraps the `shell-quote` parser so aliases can include quoted arguments while still rejecting pipes, redirects, or substitution syntax.

## Client Singleton Pattern

The API client is managed as a singleton in `services/client.ts`:

```typescript
import { createApiClient, type GranolaApi } from '../lib/api.js';
import { createHttpClient } from '../lib/http.js';

let client: GranolaApi | null = null;

export async function getClient(): Promise<GranolaApi> {
  if (client) return client;

  const creds = await getCredentials();
  if (!creds) {
    console.error('Not authenticated. Run: granola auth login');
    process.exit(2);
  }

  const httpClient = createHttpClient(creds.accessToken);
  client = createApiClient(httpClient);
  return client;
}

export function resetClient(): void {
  client = null;
}
```

### Design Rationale

- **Lazy Initialization**: Client is only created when first needed, avoiding unnecessary authentication checks
- **Single Instance**: Reused across all commands in a session to avoid multiple authentication flows
- **Auth Check**: Automatically validates credentials on first use and exits with code 2 if not authenticated
- **Test Support**: `resetClient()` allows tests to reset state between test cases
- **Native Implementation**: Uses a custom HTTP client with automatic retry logic for 429/5xx errors

## Service Layer

Services in `src/services/` provide type-safe wrappers around the native API client:

### Meetings Service (`services/meetings.ts`)

```typescript
async function fetchFolderMeetings(client: any, folderId: string): Promise<Meeting[]> {
  const ids = await getFolderDocumentIds(client, folderId);
  if (ids.length === 0) return [];
  return fetchMeetingsByIds(client, ids);
}

export async function list(opts: ListOptions = {}): Promise<Meeting[]> {
  const client = await getClient();
  const { limit = 20, offset = 0, workspace, folder } = opts;

  if (folder) {
    const folderMeetings = await fetchFolderMeetings(client as any, folder);
    const filtered = workspace
      ? folderMeetings.filter((m) => m.workspace_id === workspace)
      : folderMeetings;
    return filtered.slice(offset, offset + limit);
  }

  const res = await (client as any).getDocuments({
    limit,
    offset,
    include_last_viewed_panel: false,
  });

  let meetings = (res.docs || []) as Meeting[];
  if (workspace) {
    meetings = meetings.filter((m) => m.workspace_id === workspace);
  }

  return meetings;
}
```

### Folder Service (`services/folders.ts`)

```typescript
export async function list(opts: ListOptions = {}): Promise<Folder[]> {
  const client = await getClient();
  const documentLists = await client.getDocumentLists();
  const folders = documentLists.map(normalizeFolder);

  if (opts.workspace) {
    return folders.filter((folder) => folder.workspace_id === opts.workspace);
  }

  return folders;
}
```

`getDocumentLists()` calls the unofficial `/v1/get-document-lists-metadata` endpoint with `include_document_ids: true` and `include_only_joined_lists: false`. It converts the response's `lists` object into an array. `normalizeFolder()` preserves explicit `document_ids`, falls back to embedded `documents`, and maps `is_favourited` to `is_favourite`. Optional workspace fields and `document_count` support folder display. The `get()` helper uses the same API method to find a folder by ID.

### Service Responsibilities

1. **API Abstraction**: Hide client implementation details from commands
2. **Response Normalization**: Handle API response variations
3. **Type Safety**: Strongly-typed interfaces for all API interactions
4. **Business Logic**: Implement filtering, pagination, and data aggregation
5. **ID Resolution**: Resolve partial meeting IDs to full UUIDs via prefix matching
6. **Error Handling**: Preserve authentication and network failures for retry or error reporting. Transcript HTTP 404 responses return an empty array.

### ID Resolution

Meeting IDs displayed in `meeting list` are truncated to 8 characters for readability. The `resolveId()` function in `services/meetings.ts` enables commands to accept partial IDs:

```typescript
export async function resolveId(partialId: string): Promise<string | null> {
  // Optimization: Direct lookup for full UUIDs (36+ chars)
  if (partialId.length >= 36) {
    const metadata = await client.getDocumentMetadata(partialId);
    if (metadata) return partialId;
  }

  // Use cached meetings for prefix search
  const meetings = await getCachedMeetings(client);
  const matches = meetings.filter((m) => m.id.startsWith(partialId));

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Ambiguous ID: ${partialId} matches ${matches.length} meetings`);
  }
  return matches[0].id;
}
```

**Behavior:**
- If exactly one meeting matches the prefix, returns the full UUID
- If no matches found, returns `null` (command exits with code 4)
- If multiple matches found, throws an error (user must provide more characters)

**Performance Optimizations:**
- **Direct lookup for full UUIDs**: When the ID is 36+ characters (full UUID), attempts a direct `getDocumentMetadata()` call first, avoiding expensive pagination
- **In-memory caching**: Meetings list is cached for 60 seconds to reduce API calls when resolving multiple IDs in quick succession
- **Cache invalidation**: `clearMeetingsCache()` is exported for testing or manual cache clearing

**Used By:** `view`, `notes`, `enhanced`, `transcript`, `export` commands

### Native API Client

The CLI uses a native HTTP client (`src/lib/http.ts`) and API wrapper (`src/lib/api.ts`) that provide:

- **Type-safe methods**: All API methods have proper TypeScript types
- **Automatic retry**: Exponential backoff for 429 (rate limit) and 5xx errors
- **Token management**: Support for token refresh via `setToken()`
- **Consistent headers**: Matches Granola desktop app headers for compatibility

```typescript
export async function get(id: string): Promise<Meeting | null> {
  const client = await getClient();
  const res = await client.getDocumentsBatch({
    document_ids: [id],
    include_last_viewed_panel: false,
  });
  return res.documents?.[0] ?? null;
}
```

## Content Transformation

### Dual Notes Architecture

Granola maintains two distinct types of notes for each meeting:

1. **Manual Notes** (`meeting.notes`)
   - User-written notes entered during the meeting
   - Accessed via `meeting notes <id>` command
   - Retrieved using `meetings.getNotes(id)`

2. **AI-Enhanced Notes** (`meeting.last_viewed_panel.content`)
   - AI-generated summaries created by Granola
   - Include structured sections: key decisions, action items, discussion summaries
   - Accessed via `meeting enhanced <id>` command
   - Retrieved using `meetings.getEnhancedNotes(id)`

Both note types are stored in ProseMirror JSON format and converted to Markdown for display.

```typescript
// services/meetings.ts
export async function getNotes(id: string): Promise<ProseMirrorDoc | null> {
  const meeting = await get(id);
  return meeting?.notes ?? null;  // Manual notes only
}

export async function getEnhancedNotes(id: string): Promise<ProseMirrorDoc | null> {
  const meeting = await getWithPanel(id);
  return meeting?.last_viewed_panel?.content ?? null;  // AI-enhanced notes
}
```

### ProseMirror to Markdown (`lib/prosemirror.ts`)

Meeting notes are stored in ProseMirror document format and must be converted to Markdown for display:

```typescript
export function toMarkdown(doc: ProseMirrorDoc | null): string {
  if (!doc?.content) return '';
  return doc.content.map((n) => nodeToMd(n)).join('\n\n');
}

function nodeToMd(node: ProseMirrorNode): string {
  switch (node.type) {
    case 'heading': {
      const lvl = (node.attrs?.level as number) || 1;
      return '#'.repeat(lvl) + ' ' + inlineToMd(node.content);
    }
    case 'paragraph':
      return inlineToMd(node.content);
    case 'bulletList':
      return (node.content || []).map((li) => nodeToMd(li)).join('\n');
    case 'orderedList':
      return (node.content || [])
        .map((li, i) => nodeToMd(li).replace(/^- /, `${i + 1}. `))
        .join('\n');
    // ... more cases
  }
}
```

#### Supported Node Types

- **Headings**: `heading` → `# H1`, `## H2`, etc.
- **Paragraphs**: `paragraph` → plain text
- **Lists**: `bulletList`, `orderedList`, `listItem`
- **Blockquotes**: `blockquote` → `> quoted text`
- **Code Blocks**: `codeBlock` → ` ```language\ncode\n``` `
- **Horizontal Rules**: `horizontalRule` → `---`
- **Text**: `text` nodes with mark support

#### Supported Marks

Marks are applied to text nodes:

```typescript
function applyMarks(text: string, marks?: Array<{ type: string }>): string {
  if (!marks) return text;
  for (const m of marks) {
    if (m.type === 'bold' || m.type === 'strong') text = `**${text}**`;
    if (m.type === 'italic' || m.type === 'em') text = `*${text}*`;
    if (m.type === 'code') text = `\`${text}\``;
    if (m.type === 'strike') text = `~~${text}~~`;
  }
  return text;
}
```

### Transcript Formatting (`lib/transcript.ts`)

Transcripts are converted from utterance arrays to readable text:

```typescript
export function formatTranscript(
  utterances: Utterance[],
  opts: FormatOptions = {}
): string {
  const { timestamps = false, source = 'all' } = opts;

  let filtered = utterances;
  if (source !== 'all') {
    filtered = utterances.filter((u) => u.source === source);
  }

  const lines: string[] = [];

  for (const u of filtered) {
    const speaker = u.source === 'microphone' ? 'You' : 'Participant';

    if (timestamps) {
      const time = formatTimestamp(u.start_timestamp);
      lines.push(`[${time}] ${speaker}`);
      lines.push(u.text);
      lines.push('');
    } else {
      lines.push(`${speaker}: ${u.text}`);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}
```

#### Options

- **timestamps**: Include `[HH:MM:SS]` timestamps for each utterance
- **source**: Filter by audio source:
  - `'microphone'` - Only user speech
  - `'system'` - Only system audio
  - `'all'` - All sources (default)

#### Speaker Identification

The formatter maps audio sources to readable speaker labels:
- `microphone` → "You"
- `system` → "Participant"

### Participant Data

Meeting participant information is available through the `people` field on the `Meeting` type:

```typescript
interface People {
  creator?: Person;      // Meeting organizer
  attendees?: Person[];  // Other participants
}

interface Person {
  name?: string;
  email?: string;
  details?: {
    employment?: {
      title?: string;
      name?: string;  // company name
    };
  };
}
```

#### Data Flow

1. **API Source**: Participant data comes from `getDocumentMetadata()` API call
2. **Service Layer**: `meetings.get()` loads the full document with `getDocumentsBatch()`, then merges `creator` and `attendees` from `getDocumentMetadata()`. The document keeps its ID, title, dates, and content. Missing optional metadata does not hide the document.
3. **Command Layer**: Display formatting happens in `view.ts` and `export.ts`

#### Display Format

The `meeting view` command displays participants when available:

```
Organizer:    John Doe
Attendees:    2 participant(s)
              - Jane Smith (Product Designer)
              - Bob Wilson
```

The `meeting export` command includes `meeting.people` in JSON output. When that object is absent, it builds `people` from the meeting's top-level `creator` and `attendees` metadata.

## Output System

The CLI supports dual output modes: human-readable and machine-readable.

### Human-Readable Output

Commands use several formatting utilities from `lib/output.ts`:

#### Table Rendering

```typescript
export function table<T extends object>(
  data: T[],
  columns: Column<T>[]
): string {
  const colWidths = columns.map((c) => c.width ?? null);
  const t = new Table({
    head: columns.map((c) => chalk.bold(c.header)),
    colWidths,
    style: { head: [], border: [] },
    chars: { /* minimalist border characters */ },
  });

  for (const row of data) {
    t.push(
      columns.map((c) => {
        const val = row[c.key];
        return c.format ? c.format(val) : String(val ?? '');
      })
    );
  }

  return t.toString();
}
```

Tables are configured with:
- **Minimalist borders**: No box drawing characters, just spacing
- **Bold headers**: Using chalk for emphasis
- **Custom formatters**: Per-column value transformation
- **Fixed widths**: Prevent wrapping and maintain alignment

#### Utility Functions

- `formatDate(iso: string)`: ISO 8601 → "Dec 21, 2025"
- `formatDuration(start: string, end: string)`: Calculate duration in minutes
- `truncate(s: string, len: number)`: Truncate with ellipsis

### Machine-Readable Output

Commands inspect their local `-o/--output` option to determine the desired format:

```typescript
const format = opts.output || null;
if (format) {
  console.log(formatOutput(data, format as OutputFormat));
  return;
}
```


### Pager Integration (`lib/pager.ts`)

Long output is automatically paged using the user's preferred pager:

```typescript
export function getPagerCommand(): string {
  return process.env.GRANOLA_PAGER || process.env.PAGER || 'less -R';
}

export async function pipeToPager(content: string): Promise<void> {
  if (!process.stdout.isTTY) {
    process.stdout.write(content + '\n');
    return;
  }

  const pagerCmd = getPagerCommand();
  const [cmd, ...args] = pagerCmd.split(' ');

  return new Promise((resolve) => {
    const pager = spawn(cmd, args, {
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    pager.stdin.write(content);
    pager.stdin.end();

    pager.on('close', () => {
      resolve();
    });
  });
}
```

#### Pager Selection Priority

1. `GRANOLA_PAGER` environment variable (CLI-specific)
2. `PAGER` environment variable (system-wide)
3. `config.pager` (user-defined fallback)
4. `less -R` (default, with ANSI color support)

#### TTY Detection

The pager is skipped when output is piped or redirected:

```typescript
if (!process.stdout.isTTY) {
  process.stdout.write(content + '\n');
  return;
}
```

This ensures commands work correctly in scripts: `granola meeting list | grep "important"`

## Configuration System

Configuration is managed via the `conf` package in `lib/config.ts`:

```typescript
const config = new Conf<Config>({
  projectName: 'granola',
  defaults: {},
});
```

### Storage Locations

The `conf` package stores configuration in platform-specific locations:

- **macOS**: `~/Library/Preferences/granola-nodejs/`
- **Linux**: `~/.config/granola-nodejs/`
- **Windows**: `%APPDATA%\granola-nodejs\`

### Configuration Schema

```typescript
export interface Config {
  default_workspace?: string;
  pager?: string;
  aliases?: Record<string, string>;
}
```

### API

```typescript
// Get entire config
getConfig(): Config

// Set entire config (replaces existing)
setConfig(newConfig: Config): void

// Get single value
getConfigValue<K extends keyof Config>(key: K): Config[K]

// Set single value
setConfigValue<K extends keyof Config>(key: K, value: Config[K]): void

// Clear all config
resetConfig(): void
```

### Default Workspace & Pager Behavior

- `default_workspace` is automatically applied when workspace-aware commands (for example, `granola meeting list`) run without an explicit `--workspace` flag. Command-line options always take precedence.
- `pager` acts as the final fallback when neither `GRANOLA_PAGER` nor `PAGER` is defined, giving users a consistent pager without needing environment variables.

### Alias-Specific Functions

```typescript
// Get alias command
getAlias(name: string): string | undefined

// Set alias
setAlias(name: string, command: string): void

// Delete alias
deleteAlias(name: string): void

// List all aliases
listAliases(): Record<string, string>
```

## Authentication

Authentication credentials are stored securely in the system keychain via `cross-keychain`:

```typescript
const SERVICE_NAME = 'com.granola.cli';
const ACCOUNT_NAME = 'credentials';

export async function getCredentials(): Promise<Credentials | null> {
  try {
    const stored = await getPassword(SERVICE_NAME, ACCOUNT_NAME);
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    return {
      refreshToken: parsed.refreshToken,
      accessToken: parsed.accessToken || '',
      clientId: parsed.clientId,
    };
  } catch {
    return null;
  }
}
```

### Keychain Storage

- **macOS**: Keychain Access
- **Linux**: libsecret/gnome-keyring
- **Windows**: Credential Manager

### Credential Format

Credentials are stored as JSON:

```json
{
  "refreshToken": "...",
  "accessToken": "...",
  "clientId": "client_GranolaMac"
}
```

### Sign-in and session validation

`auth login` reuses an existing session after `getAuthenticatedCredentials()` validates it with `POST /v1/get-user-info`. Rejected access tokens trigger refresh through `POST /v1/refresh-access-token`. Refresh sends the current access token as a Bearer token and `{ refresh_token }` as the body. The CLI validates the refresh response and saves rotated credentials under the existing file lock.

If no valid session exists, login tries the legacy `supabase.json` store. `parseSupabaseJson()` supports stringified WorkOS or Cognito tokens and root-level legacy tokens. Login validates imports before storage.

When import cannot supply valid credentials, `lib/browser-auth.ts` creates an independent PKCE sign-in. Google is the default provider, and `--provider microsoft` selects Microsoft. The helper obtains the final browser address and validates the sign-in state before exchanging the one-time code. `--browser` starts a new sign-in immediately.

On macOS, browser sign-in opens Chrome by default. `lib/chrome-callback.ts` polls all Chrome windows through AppleScript for a Granola redirect containing this sign-in's state. Each query has a ten-second timeout. Detection requires macOS Automation permission and stops on completion, cancellation, failure, or after one minute. Failure or timeout opens the manual prompt without printing process details. The five-minute sign-in deadline includes both detection and manual input. `--no-auto-callback` skips detection and opens the default browser. Other platforms use manual paste.

The verifier stays in memory. Authentication requests have a 15-second timeout, and the prompt expires after five minutes. The CLI does not decrypt desktop credential stores. After validation, login saves the session under the same lock used by token refresh. Browser interaction stays outside the lock.

`auth status` reports authentication only after server validation. Verification and refresh outages produce errors.

## Alias System

Aliases provide command shortcuts stored in the configuration system.

### Storage Format

Aliases are stored in the config under the `aliases` key:

```json
{
  "aliases": {
    "ls": "meeting list",
    "recent": "meeting list --limit 10"
  }
}
```

### Expansion Mechanism

Alias expansion happens at the entry point, before Commander parses arguments:

```typescript
function expandAlias(args: string[]): string[] {
  // args = ['node', '/path/to/granola', 'ls', '--output', 'json']
  if (args.length < 3) return args;

  const command = args[2]; // 'ls'
  const alias = getAlias(command); // 'meeting list'

  if (alias) {
    const aliasArgs = parseAliasArguments(alias); // honours quoted args
    // Return: ['node', '/path/to/granola', 'meeting', 'list', '--output', 'json']
    return [...args.slice(0, 2), ...aliasArgs, ...args.slice(3)];
  }

  return args;
}
```

### Example

```bash
# Set alias
granola alias set ls "meeting list --limit 10"

# Use alias
granola ls --output json

# Expands to
granola meeting list --limit 10 --output json
```

### Limitations

- Aliases can only expand the first command argument
- Nested alias expansion is not supported
- Aliases cannot override built-in commands (they're checked first)

## Testing Infrastructure

The project uses Vitest with comprehensive coverage requirements.

### Test Structure

Tests mirror the source structure:

```
tests/
  commands/
    auth/
    meeting/
    workspace/
    folder/
  lib/
  services/
```

### Coverage Configuration

From `vitest.config.ts`:

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov', 'html'],
  include: ['src/**/*.ts'],
  exclude: [
    'src/types.ts',
    'src/commands/**/index.ts',
    'src/main.ts',
  ],
  thresholds: {
    lines: 95,
    functions: 95,
    branches: 90,
    statements: 95,
  },
}
```

### Coverage Thresholds

- **Lines**: 95%
- **Functions**: 95%
- **Branches**: 90%
- **Statements**: 95%

### Excluded Files

- `src/types.ts` - Type definitions only
- `src/commands/**/index.ts` - Simple command aggregation files
- `src/main.ts` - Entry point (tested via E2E)

### Mocking Strategy

Tests mock external dependencies:

1. **API Client**: Mock native HTTP/API client responses
2. **Keychain**: Mock `cross-keychain` for credential storage
3. **Process**: Mock `process.exit`, `process.stdout`, `process.env`
4. **Child Process**: Mock `spawn` for pager tests

### Test Utilities

Setup file at `tests/setup.ts` provides common test utilities and global mocks.

### Running Tests

```bash
# Watch mode
npm run test:watch

# Single run
npm test

# With coverage
npm run test:coverage
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         Entry Point                         │
│                         (main.ts)                           │
│  • Parse global flags (--no-pager)                        │
│  • Expand aliases                                           │
│  • Route to commands                                        │
└───────────────────────┬─────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
┌───────────▼──────────┐ ┌─────────▼──────────┐
│   Command Layer      │ │  Config/Alias      │
│   (commands/)        │ │  (lib/config.ts)   │
│                      │ │                    │
│  • Parse options     │ │  • Store settings  │
│  • Validate input    │ │  • Manage aliases  │
│  • Format output     │ └────────────────────┘
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│   Service Layer      │
│   (services/)        │
│                      │
│  • Normalize API     │
│  • Type casting      │
│  • Business logic    │
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│   Client Singleton   │
│   (services/client)  │
│                      │
│  • Lazy init         │
│  • Auth validation   │
│  • Single instance   │
└──────────┬───────────┘
           │
┌──────────▼───────────┐       ┌─────────────────────┐
│  Native API Client   │◄──────┤  Authentication     │
│  (lib/http + api)    │       │  (lib/auth + lock)  │
│                      │       │                     │
│  • HTTP with retry   │       │  • Keychain storage │
│  • Granola API       │       │  • Token refresh    │
└──────────────────────┘       │  • File-based lock  │
                               └─────────────────────┘
           │
┌──────────▼───────────┐
│   Content Transform  │
│   (lib/)             │
│                      │
│  • ProseMirror→MD    │
│  • Transcript format │
│  • Table rendering   │
│  • Pager integration │
└──────────────────────┘
```

## Key Design Decisions

### 1. Native API Implementation

The CLI uses a native HTTP client instead of an external dependency, providing:
- Full control over retry logic and error handling
- Type-safe API methods with complete TypeScript definitions
- Automatic exponential backoff for rate limits (429) and server errors (5xx)
- Compatibility headers matching the Granola desktop app

**Trade-off**: More code to maintain vs. independence from external packages and better control.

### 2. Singleton Client Pattern

A single client instance is shared across all commands to avoid redundant authentication flows.

**Trade-off**: Global state vs. performance. In a CLI context, global state is acceptable and improves UX by reducing authentication overhead.

### 3. Alias Expansion at Entry Point

Aliases are expanded before Commander parses arguments, allowing them to work seamlessly with all flags and options.

**Trade-off**: Simplicity vs. flexibility. This approach doesn't support nested aliases but keeps the implementation straightforward.

### 4. Service Layer Abstraction

Services provide a stable API for commands, insulating them from client library changes.

**Trade-off**: Additional layer vs. flexibility. The abstraction allows us to swap API clients or mock services easily in tests.

### 5. Platform-Specific Keychain Storage

Using `cross-keychain` for credential storage instead of file-based storage.

**Trade-off**: Complexity vs. security. Keychain integration is more complex but provides OS-level encryption and better security practices.

### 6. Pager Auto-Detection

Automatically page long output with TTY detection and environment variable support.

**Trade-off**: Complexity vs. UX. Auto-paging improves user experience while TTY detection ensures compatibility with scripts and pipes.

---

This document covers the internal architecture of Granola CLI. For API details, see [API.md](./API.md).

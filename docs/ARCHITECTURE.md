# Architecture

## Overview

Granola CLI is an unofficial, community-built TypeScript CLI for Granola.ai - an AI-powered meeting notes application. It provides terminal access to meetings, transcripts, and notes via the Granola API.

**Tech Stack:**
- TypeScript (strict mode) + Node.js 20+
- Commander.js (CLI framework)
- Native HTTP client with Granola API
- `conf` (Configuration management)
- `cross-keychain` (Secure credential storage)
- `cli-table3` (Table formatting)
- `chalk` (Terminal styling)
- ESM modules, bundled via `tsup`

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│                   CLI Entry Point                       │
│                      (main.ts)                          │
│          Commander Program + Alias Expansion            │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────┴───────────────────────────────────────┐
│                   Commands Layer                        │
│   ┌──────────┬──────────┬──────────┬────────┬────────┐ │
│   │   auth   │ meeting  │workspace │ folder │ config │ │
│   │          │          │          │        │ alias  │ │
│   └──────────┴──────────┴──────────┴────────┴────────┘ │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────┴───────────────────────────────────────┐
│                  Services Layer                         │
│   ┌──────────┬──────────┬──────────────┬────────────┐  │
│   │ client.ts│meetings.ts│workspaces.ts│ folders.ts │  │
│   │          │           │             │            │  │
│   └──────────┴──────────┴──────────────┴────────────┘  │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────┴───────────────────────────────────────┐
│                  Libraries Layer                        │
│  ┌────────┬────────┬────────┬────────┬─────────────┐   │
│  │auth.ts │config.ts│output.ts│pager.ts│prosemirror.ts│ │
│  │lock.ts │        │         │        │transcript.ts │ │
│  └────────┴────────┴────────┴────────┴─────────────┘   │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────┴───────────────────────────────────────┐
│              External Dependencies                      │
│         cross-keychain │ conf │ Granola API             │
└─────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── main.ts                 # Entry point with Commander setup
├── types.ts                # TypeScript interfaces (API + CLI types)
├── commands/               # Command implementations
│   ├── auth/              # Authentication commands
│   │   ├── index.ts       # Auth command group
│   │   ├── login.ts       # OAuth login flow
│   │   ├── logout.ts      # Clear credentials
│   │   └── status.ts      # Check auth status
│   ├── meeting/           # Meeting commands
│   │   ├── index.ts       # Meeting command group
│   │   ├── list.ts        # List meetings
│   │   ├── view.ts        # View meeting details
│   │   ├── notes.ts       # View manual notes
│   │   ├── enhanced.ts    # View AI-enhanced notes
│   │   ├── transcript.ts  # View transcript
│   │   └── export.ts      # Export meeting data
│   ├── workspace/         # Workspace commands
│   │   ├── index.ts       # Workspace command group
│   │   ├── list.ts        # List workspaces
│   │   └── view.ts        # View workspace details
│   ├── folder/            # Folder commands
│   │   ├── index.ts       # Folder command group
│   │   ├── list.ts        # List folders
│   │   └── view.ts        # View folder contents
│   ├── config.ts          # Config management (get/set/reset)
│   └── alias.ts           # Alias management (list/set/delete)
├── services/              # API abstractions
│   ├── client.ts          # API client singleton
│   ├── meetings.ts        # Meeting CRUD operations
│   ├── workspaces.ts      # Workspace operations
│   └── folders.ts         # Folder operations
└── lib/                   # Utilities
    ├── api.ts             # Granola API client wrapper
    ├── auth.ts            # Keychain credential management
    ├── browser-auth.ts    # Browser sign-in with PKCE
    ├── config.ts          # User preferences (via conf)
    ├── date-parser.ts     # Natural language date parsing
    ├── filters.ts         # Meeting filter utilities
    ├── http.ts            # HTTP client with retry logic
    ├── lock.ts            # File-based locking for token refresh
    ├── output.ts          # Table formatting utilities
    ├── pager.ts           # Terminal pager integration
    ├── prosemirror.ts     # ProseMirror → Markdown conversion
    └── transcript.ts      # Transcript formatting
```

## Command Hierarchy

```
granola [--no-pager]
├── auth
│   ├── login              # OAuth login flow
│   ├── logout             # Clear stored credentials
│   └── status             # Check authentication status
├── meeting
│   ├── list               # List meetings
│   │   [--limit <n>]
│   │   [--workspace <id>]
│   │   [--folder <id>]
│   │   [--search <query>]     # Title search
│   │   [--attendee <name>]    # Attendee filter
│   │   [--date <date>]        # Specific date
│   │   [--since <date>]       # From date
│   │   [--until <date>]       # Until date
│   ├── view <id>          # View meeting details
│   ├── notes <id>         # View manual notes (user-written)
│   ├── enhanced <id>      # View AI-enhanced notes
│   ├── transcript <id>    # View meeting transcript
│   │   [--timestamps]
│   │   [--source <type>]  # microphone|system|all
│   └── export <id>        # Export meeting data
│       [--format <fmt>]   # json|yaml|md
├── workspace
│   ├── list               # List workspaces
│   └── view <id>          # View workspace details
├── folder
│   ├── list               # List folders
│   │   [--workspace <id>]
│   └── view <id>          # View folder contents
├── config
│   ├── list               # View current config
│   ├── get <key>          # Get config value
│   ├── set <key> <value>  # Set config value
│   └── reset              # Reset to defaults
└── alias
    ├── list               # List aliases
    ├── set <name> <cmd>   # Create alias
    └── delete <name>      # Delete alias
```

## Data Flow

### Example: `granola meeting transcript <id>`

```
1. CLI Entry (main.ts)
   ├─ Commander parses arguments
   ├─ Alias expansion (if alias exists)
   └─ Routes to meeting command

2. Command Layer (commands/meeting/transcript.ts)
   ├─ Validates arguments (meeting ID)
   ├─ Extracts options (--timestamps, --source)
   └─ Calls services layer

3. Services Layer (services/meetings.ts)
   ├─ getClient() → Retrieves singleton API client
   └─ getTranscript(id) → Calls API

4. API Client (services/client.ts)
   ├─ Singleton pattern ensures one client instance
   ├─ Loads credentials from keychain (lib/auth.ts)
   └─ Creates the HTTP/API client with the access token

5. Libraries Layer
   ├─ formatTranscript() (lib/transcript.ts)
   │   ├─ Filters by source (microphone/system/all)
   │   ├─ Formats timestamps (if requested)
   │   └─ Returns formatted text
   └─ pipeToPager() (lib/pager.ts)
       ├─ Checks if TTY and pager enabled
       ├─ Spawns pager process (less -R)
       └─ Pipes content to pager

6. Output
   └─ Displays formatted transcript in pager
```

### Authentication Flow

```
1. User runs: granola auth login
   └─ commands/auth/login.ts

2. Login Command
   ├─ Reuses a server-validated CLI session when available
   ├─ Tries valid legacy desktop credentials from supabase.json
   └─ Otherwise starts browser sign-in with PKCE

3. Auth Library (lib/auth.ts)
   ├─ Validates credentials through /v1/get-user-info
   ├─ Refreshes expired sessions through /v1/refresh-access-token
   └─ Stores validated credentials in the OS keychain

4. Subsequent Commands
   ├─ Call getClient() (services/client.ts)
   ├─ getCredentials() reads from keychain
   ├─ Creates the native HTTP/API client
   └─ Caches client for reuse (singleton)
```

## Key Components

### Entry Point

**`main.ts`**
- Initializes Commander program
- Defines global flags (--no-pager)
- Registers command groups
- Implements alias expansion before parsing

### Commands Layer

Each command follows a consistent pattern:
1. Define command metadata (name, description, args, options)
2. Extract global options via `optsWithGlobals()`
3. Call service layer for business logic
4. Format and output results (JSON or formatted text)

**Command Groups:**
- **`auth/`** - Manages authentication lifecycle
- **`meeting/`** - Primary feature set (list, view, notes, transcript, export)
- **`workspace/`** - Workspace operations
- **`folder/`** - Folder operations
- **`config.ts`** - Configuration management
- **`alias.ts`** - Custom command shortcuts

### Services Layer

**`services/client.ts`**
- Singleton pattern for API client
- Lazy initialization on first use
- Auto-exits if credentials missing
- Provides `resetClient()` for logout

**`services/meetings.ts`**
- Abstracts meeting-related API calls
- Handles pagination and filtering
- Normalizes API responses (handles `docs` vs `documents`)
- Type-safe wrappers around API methods

**`services/workspaces.ts` & `services/folders.ts`**
- Similar patterns to meetings service
- Workspace and folder CRUD operations

### Libraries Layer

**`lib/auth.ts`** - Credential Management
- Uses `cross-keychain` for secure OS-level storage
- Validates sessions against Granola and imports legacy Supabase JSON
- Default client ID fallback
- Token refresh and login credential writes share a file lock (via `lock.ts`)

**`lib/browser-auth.ts`** - Browser Sign-in
- Generates an in-memory PKCE verifier and sign-in state
- Opens Google or Microsoft sign-in
- On macOS, opens Chrome and uses `chrome-callback.ts` to read the matching redirect across all windows by default; asks for manual paste after failure or one minute
- `--no-auto-callback` skips detection; other platforms use manual paste
- Checks the redirect state and exchanges the code for a CLI session
- Uses 15-second request timeouts and a five-minute prompt timeout

**`lib/lock.ts`** - File-based Locking
- Serializes token refresh and login credential writes across CLI processes
- Uses `O_CREAT | O_EXCL` for atomic lock acquisition
- Automatic stale lock cleanup (60s timeout)
- Lock location: `~/Library/Caches/granola/` (macOS) or system temp dir

**`lib/config.ts`** - Configuration
- Uses `conf` package for persistent storage
- Stores user preferences (default_workspace, pager, aliases)
- Type-safe config operations
- Alias CRUD operations
- Provides runtime fallbacks:
  - `default_workspace` is applied when workspace-aware commands omit `--workspace`
  - `pager` becomes the final fallback when pager-related env vars are unset

**`lib/output.ts`** - Formatting
- Table rendering with `cli-table3`
- Date/duration formatters
- Truncation utilities
- Consistent styling with chalk

**`lib/pager.ts`** - Terminal Pager
- Respects GRANOLA_PAGER and PAGER env vars
- Falls back to configured pager (if set) or `less -R`
- Gracefully handles non-TTY environments
- Pipes content via child process

**`lib/prosemirror.ts`** - Document Conversion
- Converts ProseMirror JSON to Markdown
- Handles all common node types (headings, lists, code blocks)
- Applies text marks (bold, italic, code, strikethrough)
- Used for notes export

**`lib/transcript.ts`** - Transcript Formatting
- Filters by source (microphone/system/all)
- Optional timestamp display
- Speaker labeling (You vs Participant)
- Clean text output

**`lib/date-parser.ts`** - Natural Date Parsing
- Zero external dependencies
- Parses keywords: `today`, `yesterday`, `tomorrow`
- Parses relative: `N days ago`, `last week`, `last month`
- Parses ISO: `YYYY-MM-DD`, `YYYY/MM/DD`
- Parses simple: `Dec 20`, `20 Dec 2024`

**`lib/filters.ts`** - Meeting Filters
- Title search (case-insensitive partial match)
- Attendee filter (partial name/email match)
- Date filter (specific date or range)
- Combines multiple filters with AND logic
- Used by meetings service for client-side filtering

## Type System

**`types.ts`** defines two categories:

**API Types**:
- `Person` - Participant details (name, email, employment info)
- `People` - Meeting participants (creator + attendees)
- `Meeting` - Meeting metadata, content, and participants
- `ProseMirrorDoc` - Document structure
- `ProseMirrorNode` - Document nodes
- `Utterance` - Transcript segments
- `Workspace` - Workspace metadata
- `Folder` - Folder metadata

**CLI Types**:
- `GlobalFlags` - Shared CLI options
- `Config` - User configuration schema
- `Credentials` - Authentication data structure

## Configuration & State

### Stored Configuration (via `conf`)

Location: `~/.config/granola/config.json` (platform-dependent)

```json
{
  "default_workspace": "workspace-id",
  "pager": "less -R",
  "aliases": {
    "ml": "meeting list",
    "mt": "meeting transcript"
  }
}
```

- `default_workspace` automatically scopes workspace-aware commands when `--workspace` is not provided.
- `pager` is respected when pager-related environment variables are absent, ensuring a consistent viewer.

### Stored Credentials (via `cross-keychain`)

Location: OS-level keychain (Keychain Access on macOS, Credential Manager on Windows, etc.)

Service: `com.granola.cli`
Account: `credentials`

```json
{
  "refreshToken": "refresh-token",
  "accessToken": "access-token",
  "clientId": "client_GranolaMac"
}
```

## Error Handling

Exit codes:
- `0` - Success
- `2` - Authentication required
- `4` - Resource not found (e.g., no transcript)
- Other - Command-specific errors

Errors are displayed using chalk for visibility:
- Red for errors
- Yellow for warnings
- Green for success messages
- Dim for informational messages

## Extension Points

### Adding New Commands

1. Create command file in `src/commands/{group}/{command}.ts`
2. Export command via `src/commands/{group}/index.ts`
3. Register in `src/main.ts`
4. Add service method if needed in `src/services/`
5. Add types to `src/types.ts` if needed

### Adding New Output Formats

1. Check for `global.json` flag in command
2. Add custom formatter in `lib/output.ts`
3. Support `--jq` for JSON filtering (handled by Commander)

### Adding New Config Options

1. Add to `Config` interface in `types.ts`
2. Add getters/setters in `lib/config.ts`
3. Use in relevant commands via `getConfigValue()`

## Build & Distribution

**Build Process:**
- `tsup` bundles TypeScript to ESM
- Outputs to `dist/main.js`
- Shebang (`#!/usr/bin/env node`) enables CLI execution
- Node 20+ required

**Package Structure:**
```json
{
  "type": "module",
  "bin": {
    "granola": "dist/main.js"
  },
  "files": ["dist"]
}
```

**Install Methods:**
- npm: `npm install -g granola-cli`
- Local: `npm link` in repo directory

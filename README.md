# Granola CLI

[![npm version](https://img.shields.io/npm/v/granola-cli.svg)](https://www.npmjs.com/package/granola-cli)
[![npm downloads](https://img.shields.io/npm/dm/granola-cli.svg)](https://www.npmjs.com/package/granola-cli)
[![license](https://img.shields.io/npm/l/granola-cli.svg)](https://github.com/magarcia/granola-cli/blob/main/LICENSE)
[![CI](https://github.com/magarcia/granola-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/magarcia/granola-cli/actions/workflows/ci.yml)

> [!IMPORTANT]
> **Disclaimer**: This is an **unofficial, open-source community project** and is **not affiliated with, endorsed by, or connected to Granola Labs, Inc.** (the company behind [Granola.ai](https://www.granola.ai/)). Granola is a registered trademark of Granola Labs, Inc. This CLI is an independent tool that uses the publicly available Granola API to provide command-line access to your own meeting data.

> [!NOTE]
> This tool has only been tested on **macOS**. It may work on Windows and Linux, but this has not been verified.

A command-line interface for [Granola](https://www.granola.ai/) meeting notes.

Access your meetings, notes, and transcripts directly from the terminal. Built with TypeScript and designed for both interactive use and scripting.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [Commands](#commands)
  - [meeting](#meeting)
  - [workspace](#workspace)
  - [folder](#folder)
  - [config](#config)
  - [alias](#alias)
- [Global Options](#global-options)
- [Output Formats](#output-formats)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Exit Codes](#exit-codes)
- [Examples](#examples)
- [Development](#development)

## Installation

```bash
npm install -g granola-cli
```

Or run directly with npx:

```bash
npx granola-cli meeting list
```

## Quick Start

```bash
# Authenticate with Granola
granola auth login

# List your recent meetings
granola meeting list

# View AI-enhanced summary from a meeting
granola meeting enhanced <meeting-id>

# View your manual notes
granola meeting notes <meeting-id>

# View the transcript
granola meeting transcript <meeting-id>
```

## Authentication

The CLI stores credentials securely in your system keychain.

### Login

```bash
granola auth login
```

The CLI reuses a valid stored session or imports valid credentials from an older desktop installation. Otherwise, it opens browser sign-in:

1. Complete sign-in in the browser.
2. Leave the final **Opening Granola** page open.
3. On macOS, the CLI opens Chrome and reads the matching callback automatically. Allow macOS Automation access when asked. If detection fails or takes more than one minute, the CLI asks you to copy the page's full address and paste it into the terminal. Other platforms use manual paste.

To start a new browser sign-in or use Microsoft:

```bash
granola auth login --browser
granola auth login --browser --provider microsoft
```

To use manual paste and your default browser on macOS:

```bash
granola auth login --browser --no-auto-callback
```

Automatic detection checks all Chrome windows for this sign-in's callback. The callback contains a one-time sign-in code.

Google is the default provider. Browser sign-in creates a CLI session and works independently of the desktop app's encrypted credential storage.

### Check Status

```bash
granola auth status
```

Output:

```
Authenticated
```

Status checks the session with Granola and refreshes an expired access token when possible. A stored credential alone does not count as authenticated.

### Logout

```bash
granola auth logout
```

### Token Management

- Access tokens are automatically refreshed when they expire
- Refresh tokens are single-use and rotated on each refresh
- If Granola rejects the refresh token, run `granola auth login --browser`
- Network and server failures report errors; retry when the service is available

### Troubleshooting

If you see authentication errors:

1. Run `granola auth status` to check credential status
2. Run `granola auth login --browser` to start a new sign-in

Browser sign-in requires an interactive terminal and expires after five minutes. On macOS, Chrome callback detection runs first. If it fails, paste the final redirect address when asked. Use `--no-auto-callback` to skip detection. You do not need to decrypt desktop files or remove desktop app data.

## Commands

### meeting

Work with meetings.

#### List meetings

```bash
granola meeting list [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `-l, --limit <n>` | Number of meetings to show (default: 20) |
| `-w, --workspace <id>` | Filter by workspace ID |
| `-f, --folder <id>` | Filter by folder ID |
| `-s, --search <query>` | Search in meeting titles (case-insensitive) |
| `-a, --attendee <name>` | Filter by attendee name or email (partial match) |
| `-d, --date <date>` | Filter meetings on a specific date |
| `--since <date>` | Filter meetings from date (inclusive) |
| `--until <date>` | Filter meetings up to date (inclusive) |

**Date formats supported:**
- Keywords: `today`, `yesterday`, `tomorrow`
- Relative: `3 days ago`, `2 weeks ago`, `last week`, `last month`
- ISO: `2024-12-20`, `2024/12/20`
- Simple: `Dec 20`, `Dec 20 2024`, `20 Dec`

**Examples:**

```bash
# Basic listing
$ granola meeting list --limit 5

Showing 5 meetings

ID          TITLE                           DATE
a1b2c3d4    Q4 Planning Session             Dec 18, 2025
e5f6g7h8    1:1 with Sarah                  Dec 18, 2025
i9j0k1l2    Sprint Retrospective            Dec 17, 2025

# Search by title
$ granola meeting list --search "planning"

# Filter by attendee
$ granola meeting list --attendee john

# Filter by date
$ granola meeting list --date today
$ granola meeting list --date yesterday
$ granola meeting list --date "Dec 20"

# Filter by date range
$ granola meeting list --since "last week"
$ granola meeting list --since 2024-12-01 --until 2024-12-15

# Combine filters
$ granola meeting list --search standup --attendee john --since yesterday
```

#### View meeting details

```bash
granola meeting view <id> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--web` | Open meeting in browser |

**Example:**

```bash
$ granola meeting view a1b2c3d4

Q4 Planning Session
Recorded Dec 18, 2025

Workspace:    Product Team
Organizer:    Sarah Chen
Attendees:    3 participant(s)
              - Mike Johnson (Engineering Manager)
              - Lisa Park (Product Designer)
              - Tom Wilson

View notes:       granola meeting notes a1b2c3d4
View transcript:  granola meeting transcript a1b2c3d4
```

The command displays meeting participants when available, including the organizer and attendees with their job titles.

#### View meeting notes (manual)

```bash
granola meeting notes <id>
```

Displays user-written meeting notes as markdown. These are notes you manually typed during the meeting. Output is piped through your system pager when running in a TTY. Use `-o markdown|json|yaml|toon` to switch between rendered markdown and the raw ProseMirror document.

**Example:**

```bash
$ granola meeting notes a1b2c3d4

# My Notes

- Remember to follow up on budget
- Sarah mentioned design concerns
```

Save to file:

```bash
granola meeting notes a1b2c3d4 > meeting-notes.md
```

#### View AI-enhanced notes

```bash
granola meeting enhanced <id>
```

Displays AI-generated meeting summaries. These are automatically created by Granola based on the transcript and include structured sections like key decisions, action items, and discussion summaries. Use `-o markdown|json|yaml|toon` to view either the rendered markdown or the structured ProseMirror output.

**Example:**

```bash
$ granola meeting enhanced a1b2c3d4

### Key Decisions

- Launch date moved to January 15th
- Budget approved for contractor support

### Action Items

- Mike: Update roadmap by Friday
- Sarah: Schedule design review

### Discussion Summary

The team reviewed Q4 deliverables and identified timeline concerns...
```

Save to file:

```bash
granola meeting enhanced a1b2c3d4 > ai-summary.md
```

#### View meeting transcript

```bash
granola meeting transcript <id> [options]
```

Use `-o text|json|yaml|toon` to choose between a pager-friendly transcript or structured output (JSON, YAML, or Toon format) for scripting.

**Options:**
| Option | Description |
|--------|-------------|
| `-t, --timestamps` | Include timestamps |
| `-s, --source <type>` | Filter by source: `microphone`, `system`, or `all` (default) |

**Example (default):**

```bash
$ granola meeting transcript a1b2c3d4

You: Let's start with the timeline.

Sarah Chen: We're about two weeks behind on the design phase.

Mike Johnson: I think we can make up some time in development.
```

**Example (with timestamps):**

```bash
$ granola meeting transcript a1b2c3d4 --timestamps

[00:00:12] You
Let's start with the timeline.

[00:00:18] Sarah Chen
We're about two weeks behind on the design phase.
```

#### Export meeting

```bash
granola meeting export <id> [options]
```

Exports complete meeting data including metadata, notes, and transcript.

**Options:**
| Option | Description |
|--------|-------------|
| `-f, --format <format>` | Output format: `json` (default) or `toon` |

**Example:**

```bash
# Export as JSON (default)
granola meeting export a1b2c3d4 > meeting.json

# Export as Toon (LLM-optimized format)
granola meeting export a1b2c3d4 --format toon > meeting.toon
```

### workspace

Work with workspaces.

#### List workspaces

```bash
granola workspace list
```

**Example:**

```bash
$ granola workspace list

ID          NAME              CREATED
924ba459    Personal          Jan 15, 2024
abc12345    Product Team      Mar 20, 2024
def67890    Engineering       Mar 20, 2024
```

#### View workspace

```bash
granola workspace view <id>
```

**Example:**

```bash
$ granola workspace view abc12345

Product Team
Created Mar 20, 2024

View all meetings:  granola meeting list --workspace abc12345
```

### folder

Work with folders.

> **Note:** Folder commands depend on the Granola Document Lists API. If your account or workspace does not expose folders yet, the CLI prints a warning instead of returning empty results.

#### List folders

```bash
granola folder list [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `-w, --workspace <id>` | Filter by workspace ID |

**Example:**

```bash
$ granola folder list

ID          NAME              WORKSPACE
9f3d3537    Sales Calls       abc12345
1fb1b706    Planning          abc12345

# Filter to a single workspace
granola folder list --workspace abc12345
```

#### View folder

```bash
granola folder view <id>
```

**Example:**

```bash
$ granola folder view 9f3d3537

Sales Calls
22 meetings · Workspace abc12345

Tip: Use `granola meeting list` (optionally with `--folder 9f3d3537`) to browse the meetings in this workspace.

# Export the IDs for scripting
granola meeting list --folder 9f3d3537 --output json | jq -r '.[].id'
```

### config

Manage CLI configuration.

#### List configuration

```bash
granola config list
```

#### Get a value

```bash
granola config get <key>
```

#### Set a value

```bash
granola config set <key> <value>
```

**Available keys:**
| Key | Description |
|-----|-------------|
| `default_workspace` | Default workspace ID for filtering (used when `--workspace` is omitted) |
| `pager` | Pager command (e.g., `less -R`). Used when `GRANOLA_PAGER` and `PAGER` are unset. |
| `aliases` | JSON object mapping alias names to commands (e.g., `{"meet":"meeting list --limit 10"}`) |

> Values are validated. Alias updates must be valid JSON objects whose values are string commands.

#### Reset configuration

```bash
granola config reset
```

### alias

Create command shortcuts.

#### List aliases

```bash
granola alias list
```

#### Create alias

```bash
granola alias set <name> <command>
```

**Example:**

```bash
granola alias set meetings "meeting list"
granola alias set today "meeting list --limit 10"
granola alias set notes "meeting notes"

Quoted arguments are fully supported (e.g., `granola alias set pod "meeting list --workspace \"Product Team\""`).  
For safety, aliases reject pipelines or shell substitutions—only literal arguments are allowed.
```

Now you can use:

```bash
granola meetings          # runs: granola meeting list
granola today             # runs: granola meeting list --limit 10
granola notes a1b2c3d4    # runs: granola meeting notes a1b2c3d4
```

#### Delete alias

```bash
granola alias delete <name>
```

## Global Options

Available on all commands:

| Option          | Description                  |
| --------------- | ---------------------------- |
| `--help`        | Show help for command        |
| `--no-pager`    | Disable pager for long output |
| `-V, --version` | Show version number          |

> **Note:** Structured output is configured per command via `-o, --output <format>`. See each command’s help for available formats (JSON, YAML, TOON, etc.).

## Output Formats

### Human-readable (default)

Tables and formatted text optimized for terminal reading:

```bash
granola meeting list
```

### JSON (`--output json`)

Machine-readable output for scripting:

```bash
granola meeting list --output json
```

```json
[
  {
    "id": "a1b2c3d4",
    "title": "Q4 Planning Session",
    "created_at": "2025-12-18T14:00:00Z",
    "workspace_id": "abc12345"
  }
]
```

The `meeting export` command includes participant data:

```bash
granola meeting export a1b2c3d4 --format json
```

```json
{
  "id": "a1b2c3d4",
  "title": "Q4 Planning Session",
  "people": {
    "creator": {
      "name": "Sarah Chen",
      "email": "sarah@example.com"
    },
    "attendees": [
      { "name": "Mike Johnson", "email": "mike@example.com" }
    ]
  },
  "notes_markdown": "...",
  "transcript": [...]
}
```

### Toon (`--format toon`)

[TOON](https://toonformat.dev/) (Token-Oriented Object Notation) is a compact, LLM-friendly format that uses ~40% fewer tokens than JSON while maintaining the same data structure. Ideal for piping meeting data to AI tools:

```bash
# Export in Toon format for LLM consumption
granola meeting export a1b2c3d4 --format toon | llm "summarize this meeting"
```

## Configuration

Configuration is stored using the [conf](https://www.npmjs.com/package/conf) package at the standard config location for your OS:

- **macOS**: `~/Library/Preferences/granola-cli-nodejs/config.json`
- **Linux**: `~/.config/granola-cli-nodejs/config.json`
- **Windows**: `%APPDATA%/granola-cli-nodejs/Config/config.json`

### Configuration Options

| Key                 | Type   | Description          |
| ------------------- | ------ | -------------------- |
| `default_workspace` | string | Default workspace ID |
| `pager`             | string | Pager command        |
| `aliases`           | object | Command aliases      |

## Environment Variables

| Variable        | Description                              |
| --------------- | ---------------------------------------- |
| `DEBUG`         | Enable debug logging (e.g., `granola:*`) |
| `GRANOLA_PAGER` | Override pager command                   |
| `PAGER`         | System pager (fallback)                  |
| `NO_COLOR`      | Disable colored output                   |

## Debug Logging

The CLI includes comprehensive debug logging for troubleshooting. Enable it with the `DEBUG` environment variable.

### Enable All Debug Output

```bash
DEBUG=granola:* granola meeting list
```

### Selective Debug Output

```bash
# Authentication and API client only
DEBUG=granola:lib:auth,granola:service:client granola meeting list

# All service layer logs
DEBUG=granola:service:* granola meeting list

# Specific command debugging
DEBUG=granola:cmd:meeting:list granola meeting list

# CLI startup and alias expansion
DEBUG=granola:cli:* granola meetings
```

### Available Namespaces

| Namespace           | Description                  |
| ------------------- | ---------------------------- |
| `granola:cli`       | CLI entry point, startup     |
| `granola:cli:alias` | Alias expansion              |
| `granola:service:*` | All service layer operations |
| `granola:lib:*`     | All library utilities        |
| `granola:cmd:*`     | All command handlers         |

## Exit Codes

| Code | Description             |
| ---- | ----------------------- |
| `0`  | Success                 |
| `1`  | General error           |
| `2`  | Authentication required |
| `4`  | Resource not found      |

## Examples

### Daily Workflow

```bash
# See today's meetings
granola meeting list --date today

# See yesterday's meetings
granola meeting list --date yesterday

# Find meetings from last week
granola meeting list --since "last week"

# Find all standups
granola meeting list --search standup

# Find meetings with a specific person
granola meeting list --attendee "sarah"

# Review AI-enhanced summary from a meeting
granola meeting enhanced a1b2c3d4

# Check your manual notes
granola meeting notes a1b2c3d4

# Search transcript for a topic
granola meeting transcript a1b2c3d4 | grep -i "budget"
```

### Export for Sharing

```bash
# Save AI summary as markdown
granola meeting enhanced a1b2c3d4 > meeting-summary.md

# Save manual notes
granola meeting notes a1b2c3d4 > my-notes.md

# Full export for archival
granola meeting export a1b2c3d4 > meeting-archive.json
```

### Scripting

```bash
# Get all meeting IDs from a folder
granola meeting list --folder 9f3d3537 --output json | jq -r '.[].id'

# Export all meetings from a workspace
for id in $(granola meeting list --workspace abc12345 --output json | jq -r '.[].id'); do
  granola meeting export "$id" > "meetings/${id}.json"
done

# Export all meetings from last month
for id in $(granola meeting list --since "last month" --output json | jq -r '.[].id'); do
  granola meeting export "$id" > "meetings/${id}.json"
done

# Find meetings with title search (built-in)
granola meeting list --search "planning"

# Find meetings with a specific attendee
granola meeting list --attendee "john.smith@example.com" --output json
```

### Integration with Other Tools

```bash
# Pipe AI summary to another LLM for further analysis
granola meeting enhanced a1b2c3d4 | llm "extract action items from this"

# Pipe transcript to an LLM summarizer
granola meeting transcript a1b2c3d4 | llm "summarize this meeting"

# Search across multiple transcripts
granola meeting list --output json | jq -r '.[].id' | while read id; do
  echo "=== $id ==="
  granola meeting transcript "$id" 2>/dev/null | grep -i "deadline" || true
done
```

## Development

### Prerequisites

- Node.js 20+
- npm or yarn

### Setup

```bash
git clone https://github.com/magarcia/granola-cli.git
cd granola-cli
npm install
```

To use this checkout through the installed `granola` command:

```bash
npm run build
npm link
granola --version
```

Rebuild after source changes; the linked command uses `dist/main.js` from this checkout.

### Scripts

| Command                 | Description                    |
| ----------------------- | ------------------------------ |
| `npm run build`         | Build the project              |
| `npm run dev`           | Build in watch mode            |
| `npm test`              | Run tests                      |
| `npm run test:watch`    | Run tests in watch mode        |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run typecheck`     | Type-check without emitting    |
| `npm run test:e2e`      | Test the built CLI against your Granola account |

### Testing

The project uses [Vitest](https://vitest.dev/) for testing with high code coverage (95%+ threshold).

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

`npm run test:e2e` runs the built CLI with your existing Granola session. It reports command results without printing meeting contents. Checks that need unavailable folders or recent meeting content are reported as `SKIP`. Command failures, timeouts, and invalid output fail the run with a safe diagnostic. Fresh browser sign-in and forced token expiry are not part of this smoke test.

### Project Structure

```
granola-cli/
├── src/
│   ├── main.ts              # CLI entry point
│   ├── types.ts             # Type definitions
│   ├── commands/            # Command implementations
│   │   ├── auth/            # login, auth logout/status
│   │   ├── meeting/         # meeting list/view/notes/enhanced/transcript/export
│   │   ├── workspace/       # workspace list/view
│   │   ├── folder/          # folder list/view
│   │   ├── config.ts        # config list/get/set/reset
│   │   └── alias.ts         # alias list/set/delete
│   ├── services/            # API service layer
│   │   ├── client.ts        # API client singleton
│   │   ├── meetings.ts      # Meeting operations
│   │   ├── workspaces.ts    # Workspace operations
│   │   └── folders.ts       # Folder operations
│   └── lib/                 # Utility libraries
│       ├── api.ts           # Granola API client
│       ├── auth.ts          # Credential management
│       ├── browser-auth.ts  # Browser sign-in with PKCE
│       ├── config.ts        # Configuration management
│       ├── date-parser.ts   # Natural date parsing
│       ├── debug.ts         # Debug logging utilities
│       ├── filters.ts       # Meeting filter utilities
│       ├── http.ts          # HTTP client with retry
│       ├── output.ts        # Table formatting
│       ├── pager.ts         # Pager integration
│       ├── prosemirror.ts   # ProseMirror to Markdown
│       └── transcript.ts    # Transcript formatting
├── tests/                   # Test files (mirrors src/)
├── dist/                    # Build output
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

### Dependencies

**Runtime:**

- [commander](https://www.npmjs.com/package/commander) - CLI framework
- [chalk](https://www.npmjs.com/package/chalk) - Terminal colors
- [cli-table3](https://www.npmjs.com/package/cli-table3) - Table formatting
- [conf](https://www.npmjs.com/package/conf) - Configuration storage
- [cross-keychain](https://www.npmjs.com/package/cross-keychain) - Secure credential storage
- [debug](https://www.npmjs.com/package/debug) - Debug logging
- [open](https://www.npmjs.com/package/open) - Open URLs in browser
- [@toon-format/toon](https://www.npmjs.com/package/@toon-format/toon) - TOON format encoder

**Development:**

- [typescript](https://www.typescriptlang.org/) - TypeScript compiler
- [tsup](https://tsup.egoist.dev/) - Fast bundler
- [vitest](https://vitest.dev/) - Test runner

## About Granola.ai

[Granola](https://www.granola.ai/) is an AI-powered meeting notes application developed by Granola Labs, Inc. The app runs in your menu bar and automatically transcribes meetings, generating concise summaries without requiring bots to join your calls.

Key features include:

- Automatic recording and transcription
- AI-powered meeting summaries
- Action item detection
- Searchable meeting archive
- Team workspaces and shared folders (Granola 2.0)

**This CLI is an unofficial community project and is not developed or maintained by Granola Labs, Inc.**

## Related

- [Granola](https://www.granola.ai/) - The official AI notepad for meetings

## License

MIT

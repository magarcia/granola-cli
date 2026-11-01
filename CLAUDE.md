# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run build          # Bundle TypeScript to ESM (outputs dist/main.js)
npm run dev            # Watch mode build during development
npm test               # Run full test suite with vitest
npm run test:watch     # Watch mode tests
npm run test:coverage  # Tests with coverage report (95% threshold)
npm run test:e2e       # Build and test the CLI against the stored Granola account
npm run typecheck      # Type-check without emitting
npm run lint           # Lint with biome
npm run lint:fix       # Auto-fix linting issues
npm run check          # Biome check (lint + format combined)
npm run check:fix      # Auto-fix check issues
```

**Running a single test file:**
```bash
npx vitest run tests/lib/auth.test.ts
```

**Requirements:** Node.js 20+, npm 9+

## Architecture

This is a CLI tool for Granola (meeting notes app) built with Commander.js, TypeScript, and ESM modules.

### Layer Structure

```
main.ts (CLI entry, command registration, alias expansion)
    ↓
src/commands/ (parse args → call service → format output)
    ↓
src/services/ (API abstraction, singleton client, token refresh)
    ↓
src/lib/ (utilities: auth, config, http, output, pager, etc.)
```

### Key Components

- **Commands** (`src/commands/`): 6 groups - auth, meeting, workspace, folder, config, alias
- **Services** (`src/services/`): meetings.ts, workspaces.ts, folders.ts, client.ts
- **Libraries** (`src/lib/`):
  - `auth.ts` - OS keychain credential storage (cross-keychain)
  - `browser-auth.ts` - Interactive browser sign-in with PKCE
  - `chrome-callback.ts` - Default macOS Chrome callback detection with Automation permission and manual fallback
  - `config.ts` - User preferences via conf package
  - `http.ts` - HTTP client with retry logic (3 retries, exponential backoff)
  - `api.ts` - Granola API client wrapper
  - `output.ts` - Table formatting, date/duration formatters
  - `pager.ts` - Terminal pager integration
  - `prosemirror.ts` - ProseMirror → Markdown conversion
  - `transcript.ts` - Transcript formatting with filtering
  - `alias.ts` - Safe alias parsing (rejects shell syntax)

### Data Flow Example

```
main.ts (Commander)
  → commands/meeting/transcript.ts (parse args)
  → services/meetings.ts (getTranscript)
  → services/client.ts (getClient + withTokenRefresh)
  → lib/http.ts (fetch with retry)
  → lib/transcript.ts (format)
  → lib/pager.ts (display)
```

## Key Patterns

### Command Pattern
```typescript
import { createGranolaDebug } from '../../lib/debug.js';
const debug = createGranolaDebug('cmd:name');

export function createXCommand(): Command {
  return new Command('x')
    .description('...')
    .action(async (_, cmd) => {
      const opts = cmd.optsWithGlobals();
      // ...
    });
}
export const xCommand = createXCommand();
```

### Service Pattern
```typescript
import { getClient } from './client.js';

export async function getSomething(id: string) {
  const client = await getClient();
  return await client.someMethod(id);
}
```

### ESM Imports
All imports use `.js` extension (required for ESM):
```typescript
import { something } from './path.js';
```

## Testing

- **Setup**: `tests/setup.ts` provides global mocks (cross-keychain, conf, open)
- **Utilities**: `captureConsole()`, `mockProcessExit()` in test files
- **Coverage**: 95% lines/functions/statements, 90% branches
- **Fixtures**: `tests/fixtures/` mirror API response structures

### Test Pattern
```typescript
import { Command } from 'commander';
import { createXCommand } from '../../src/commands/x.js';

describe('x command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should do something', async () => {
    const program = new Command().addCommand(createXCommand());
    await program.parseAsync(['node', 'test', 'x', 'args']);
    // assertions
  });
});
```

## Exit Codes

- `0` - Success
- `1` - General error
- `2` - Authentication required
- `4` - Not found

## Debug Logging

Enable with `DEBUG=granola:*` environment variable. Namespaces: `granola:cli`, `granola:service:*`, `granola:lib:*`, `granola:cmd:*`

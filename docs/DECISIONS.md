# Design Decisions

Architectural decisions documented from the codebase implementation, with rationale and trade-offs.

## 1. Commander.js for CLI Framework

**Decision:** Use Commander.js over alternatives (yargs, oclif, clipanion)

**Rationale:**
- Lightweight with minimal dependency footprint
- Declarative command definition that's easy to read and maintain
- Built-in help generation and version management
- Wide ecosystem adoption and strong community support
- Simple API surface area reduces learning curve
- Native TypeScript support

**Implementation:**
```typescript
// src/main.ts
program
  .name('granola')
  .description('CLI for Granola meeting notes')
  .version(packageJson.version)
  .option('--no-pager', 'Disable pager');
```

## 2. Singleton Client Pattern

**Decision:** Single cached client instance across all commands

**Rationale:**
- Avoids repeated authentication checks and token validation
- Memory efficient - one client instance serves all operations
- Consistent state across operations within a session
- Simpler mental model for credential management
- Faster command execution after initial client creation

**Implementation:**
```typescript
// src/services/client.ts
let client: GranolaClientInstance | null = null;

export async function getClient(): Promise<GranolaClientInstance> {
  if (client) return client;
  // Initialize once and cache
}
```

**Trade-offs:**
- Cannot easily switch between different authenticated users in a session
- Requires explicit reset mechanism for testing (`resetClient()`)

## 3. OS Keychain for Credentials

**Decision:** Use cross-keychain instead of file-based storage

**Rationale:**
- Platform-native security (encrypted at rest by OS)
- No plaintext secrets on disk
- User-familiar security model (Keychain on macOS, Credential Manager on Windows)
- Integration with system security policies
- Proper secret lifecycle management

**Implementation:**
```typescript
// src/lib/auth.ts
import { getPassword, setPassword, deletePassword } from 'cross-keychain';

const SERVICE_NAME = 'com.granola.cli';
const ACCOUNT_NAME = 'credentials';
```

**Trade-offs:**
- Requires OS-specific permissions on first access
- More complex testing setup (needs mocking)
- Cannot easily inspect credentials manually for debugging

## 4. Separation of Services and Libraries

**Decision:** Split API operations (services/) from utilities (lib/)

**Rationale:**
- Clear responsibility boundaries and separation of concerns
- Services handle external communication with Granola API
- Libraries provide internal utilities and business logic
- Easier testing and mocking - can test layers independently
- Better code organization and discoverability
- Supports dependency injection patterns

**Structure:**
```
src/
├── services/        # External API communication
│   ├── client.ts
│   ├── meetings.ts
│   ├── workspaces.ts
│   └── folders.ts
└── lib/            # Internal utilities
    ├── auth.ts
    ├── config.ts
    ├── output.ts
    ├── pager.ts
    └── prosemirror.ts
```

## 5. Factory Functions for Commands

**Decision:** Use `createXCommand()` factory pattern

**Rationale:**
- Enables isolated testing - each test gets fresh command instance
- Fresh command instances per test avoid shared state issues
- Easier to test with different configurations
- Supports command composition and reuse
- Clear separation between command definition and registration

**Implementation:**
```typescript
// src/commands/meeting/list.ts
export function createListCommand() {
  return new Command('list')
    .description('List meetings')
    .option('-l, --limit <n>', 'Number of meetings', '20')
    .action(async (opts, cmd) => { /* ... */ });
}

export const listCommand = createListCommand();
```

**Used in tests:**
```typescript
// tests/commands/meeting/list.test.ts
const program = new Command();
program.addCommand(createListCommand());
```

## 6. Structured Output Mode

**Decision:** Support both table output and per-command `-o/--output <format>`

**Rationale:**
- Human-readable for interactive use (colored tables, formatted dates)
- Machine-readable for scripting and automation when `-o json|yaml|toon` is provided
- Unix philosophy compatibility (compose with other tools)
- Enable integration with jq, grep, and other CLI tools
- Progressive enhancement - start simple, pipe for advanced usage

**Implementation:**
```typescript
const format = opts.output || null;
if (format) {
  console.log(formatOutput(data, format as OutputFormat));
  return;
}

const output = table(data, [/* columns */]);
console.log(output);
```

**Trade-offs:**
- Dual code paths increase maintenance burden
- Must ensure format outputs stay in sync

## 7. ProseMirror to Markdown Conversion

**Decision:** Convert server format to Markdown locally

**Rationale:**
- Universal readable format that works everywhere
- Works with existing tools (less, grep, editors)
- Preserves semantic structure (headings, lists, code blocks)
- No server-side dependencies or API changes needed
- User can pipe output to any markdown processor

**Implementation:**
```typescript
// src/lib/prosemirror.ts
export function toMarkdown(doc: ProseMirrorDoc | null): string {
  if (!doc?.content) return '';
  return doc.content.map((n) => nodeToMd(n)).join('\n\n');
}
```

**Trade-offs:**
- Conversion logic must be maintained when API changes
- Some ProseMirror features may not have markdown equivalents
- No round-trip conversion (markdown → ProseMirror not implemented)

## 8. Pager Integration

**Decision:** Pipe long output through system pager

**Rationale:**
- Better UX for large content (notes, transcripts)
- Respects user preferences (PAGER environment variable)
- Smart TTY detection - only page when interactive
- Consistent with Unix tools (git, man, less)
- Custom override via GRANOLA_PAGER for tool-specific needs

**Implementation:**
```typescript
// src/lib/pager.ts
export function getPagerCommand(): string {
  return process.env.GRANOLA_PAGER || process.env.PAGER || 'less -R';
}

export async function pipeToPager(content: string): Promise<void> {
  if (!process.stdout.isTTY) {
    process.stdout.write(content + '\n');
    return;
  }
  // Spawn pager process
}
```

**Trade-offs:**
- Requires spawning child process
- Platform-specific pager behavior
- More complex testing (needs TTY mocking)

## 9. ESM-Only Module System

**Decision:** Use ES modules exclusively (no CommonJS)

**Rationale:**
- Modern JavaScript standard supported natively in Node.js
- Better tree-shaking for smaller bundle sizes
- Native async/await support without transformation
- Node 20+ requirement is acceptable for modern CLI tool
- Simpler build process (no dual-format complexity)
- Future-proof as ecosystem moves to ESM

**Configuration:**
```json
// package.json
{
  "type": "module",
  "engines": {
    "node": ">=20"
  }
}

// tsconfig.json
{
  "compilerOptions": {
    "module": "ESNext",
    "target": "ES2022"
  }
}
```

**Trade-offs:**
- Cannot support older Node.js versions
- Some legacy tools may not work
- Requires .js extensions in imports

## 10. Strict TypeScript Configuration

**Decision:** Enable all strict type checking options

**Rationale:**
- Catch errors at compile time before deployment
- Better IDE support with accurate autocomplete
- Self-documenting code through explicit types
- Reduced runtime errors and safer refactoring
- Forces handling of null/undefined cases
- Industry best practice for TypeScript projects

**Configuration:**
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true
  }
}
```

**Trade-offs:**
- Initial development may be slower
- More verbose code in some cases
- Requires type casting for undocumented API methods (see Decision #12)

## 11. High Test Coverage Thresholds (95%)

**Decision:** Enforce 95%+ coverage for lines/functions/statements

**Rationale:**
- Confidence in refactoring without breaking changes
- Documentation through tests (living specification)
- Catch edge cases early in development
- Forces thinking about error paths
- Reduces production bugs and support burden
- Quality signal for contributors

**Configuration:**
```typescript
// vitest.config.ts
coverage: {
  thresholds: {
    lines: 95,
    functions: 95,
    branches: 90,
    statements: 95,
  }
}
```

**Trade-offs:**
- Increased test maintenance burden
- May encourage "coverage theater" vs meaningful tests
- Some code paths difficult to test (error conditions, network failures)
- CI/CD runs take longer

## 12. Alias System in Config

**Decision:** Store command aliases in user config file

**Rationale:**
- Persistent shortcuts across sessions
- User customization without modifying shell configuration
- No need to learn shell alias syntax
- Portable across different shells (bash, zsh, fish)
- Can be version-controlled in dotfiles
- Built-in list/delete functionality

**Implementation:**
```typescript
// src/lib/config.ts
export function setAlias(name: string, command: string): void {
  const aliases = config.get('aliases') || {};
  aliases[name] = command;
  config.set('aliases', aliases);
}

// src/main.ts
function expandAlias(args: string[]): string[] {
  const command = args[2];
  const alias = getAlias(command);
  if (alias) {
    const aliasArgs = parseAliasArguments(alias);
    return [...args.slice(0, 2), ...aliasArgs, ...args.slice(3)];
  }
  return args;
}
```

**Trade-offs:**
- Additional feature to maintain and document
- Potential confusion when aliases shadow real commands
- Requires shell-quote parser dependency for accurate splitting

## Trade-offs Acknowledged

### Native API Client Implementation

**Issue:** Initially considered using `granola-ts-client` but it lacked complete TypeScript types and retry logic

**Current approach:**
```typescript
// Native HTTP client with type-safe API wrapper
const httpClient = createHttpClient(creds.accessToken);
const client = createApiClient(httpClient);
const res = await client.getDocumentsBatch({
  document_ids: [id],
  include_last_viewed_panel: false,
});
```

**Benefits:**
- **Type Safety:** Full TypeScript types for all API methods
- **Retry Logic:** Automatic exponential backoff for 429/5xx errors
- **Control:** Direct control over headers and error handling
- **No External Dependency:** Reduces supply chain risk

### Plaintext Config Storage

**Issue:** Non-sensitive configuration stored in plaintext JSON

**Current approach:**
```typescript
// Using 'conf' package for config storage
const config = new Conf<Config>({
  projectName: 'granola',
  defaults: {},
});
```

**Trade-offs:**
- **Convenience:** Easy to inspect and debug configuration
- **Security:** Acceptable for non-sensitive data (aliases, preferences)
- **Credentials:** Handled separately via OS keychain (secure)

### Independent sign-in and token refresh

The CLI uses browser PKCE sign-in to create its own session. Legacy desktop credentials can still be imported after server validation. Browser sign-in works independently of encrypted desktop stores and the desktop app's token rotation.

Granola's `/v1/refresh-access-token` endpoint renews rejected access tokens. A file lock serializes refreshes, and the CLI saves rotated credentials immediately. `auth status` validates the session with `/v1/get-user-info` rather than checking only whether a keychain entry exists.

This uses unofficial desktop API endpoints, which can change. It preserves the existing CLI commands without requiring the paid-plan API keys used by Granola's separate public API. Browser sign-in requires an interactive terminal. On macOS, Chrome callback detection runs first, with manual paste as a fallback. Other platforms use manual paste.

Contributor investigations in [#1](https://github.com/magarcia/granola-cli/pull/1), [#4](https://github.com/magarcia/granola-cli/pull/4), [#6](https://github.com/magarcia/granola-cli/pull/6), and [#8](https://github.com/magarcia/granola-cli/pull/8) informed the folder response and authentication fixes.

### No Built-in Update Mechanism

**Issue:** CLI doesn't check for or install updates

**Current approach:** Users must update via npm/package manager

**Trade-offs:**
- **Simplicity:** Fewer dependencies and moving parts
- **User control:** Explicit update decision
- **Alternative:** Could add update check on startup (may be intrusive)

## Consistency Patterns

### Error Handling
- Services return null/empty arrays on errors
- Commands handle null cases with user-friendly messages
- Exit code 2 for authentication errors

### Testing
- Factory pattern for all commands
- Vitest for all tests
- Mock external dependencies (API client, keychain)
- 95%+ coverage enforced

### Naming Conventions
- Commands use kebab-case (meeting-list)
- TypeScript uses camelCase for variables/functions
- Types use PascalCase
- Constants use UPPER_SNAKE_CASE

### File Organization
- Index files for command groups
- One command per file
- Tests mirror source structure
- Fixtures centralized in tests/fixtures/

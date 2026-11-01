# Security

## Overview

This document describes Granola CLI's security architecture, including credential handling, data storage, and security measures in place.

## Authentication & Credential Storage

### Keychain Integration

Granola CLI uses platform-native secure storage for credentials via the `cross-keychain` library:

- **macOS**: Keychain
- **Windows**: Credential Manager
- **Linux**: Secret Service

**Storage Details:**
- Service name: `com.granola.cli`
- Account: `credentials`
- Format: JSON containing `refreshToken`, `accessToken`, and `clientId`

### Sign-in and validation

`granola auth login` first validates an existing CLI session. If no valid session exists, it can import credentials from an older desktop installation:

- **Source**: `~/Library/Application Support/Granola/supabase.json`
- **Format**: Supabase JSON format
- **Process**: Parses credentials, validates them with `POST /v1/get-user-info`, then stores them in the keychain

When no valid import is available, the CLI starts browser sign-in with PKCE. `--browser` forces a new sign-in, and `--provider google|microsoft` selects the provider. The CLI keeps the verifier in memory and checks that the redirect address contains the matching sign-in state before exchanging its one-time code. New credentials are validated before storage.

On macOS, browser sign-in opens Chrome and tries to read its callback through AppleScript by default. This requires macOS Automation permission. The script searches all Chrome windows and returns only a Granola redirect containing the current sign-in state. The CLI validates its origin, path, and state before exchanging the code. It does not log detected URLs or script errors. If detection fails, permission is denied, or no callback arrives within one minute, the CLI asks for manual paste. `--no-auto-callback` skips detection and opens the default browser. Other platforms use manual paste.

The prompt expires after five minutes. Authentication requests have a 15-second timeout. The CLI does not decrypt the desktop app's encrypted stores or require deletion of desktop app data.

`auth status` validates the session with Granola and attempts refresh when the access token is rejected. A rejected session reports unauthenticated. Network, server, and protocol failures produce errors.

These authentication endpoints belong to Granola's unofficial desktop API, which this CLI uses. They are separate from Granola's official public API and its API keys.

### Token Refresh

The CLI automatically handles token expiration:

**Location**: `lib/auth.ts`, `lib/lock.ts`, `services/client.ts`

**How it works:**
- `refreshAccessToken()` calls Granola's backend to refresh expired tokens
- `withTokenRefresh()` wrapper automatically retries operations on 401 errors
- All API-calling service methods are wrapped with automatic token refresh
- New credentials are saved immediately after refresh

**Token Rotation Flow:**
1. API call fails with 401 (Unauthorized)
2. `withTokenRefresh` catches the error and calls `refreshAccessToken()`
3. File-based lock is acquired to prevent race conditions (via `lib/lock.ts`)
4. Credentials are re-read inside the lock (another process may have updated them)
5. CLI posts `{ "refresh_token": "..." }` to `https://api.granola.ai/v1/refresh-access-token` with the current Bearer access token
6. Granola returns a new `access_token` and a rotated `refresh_token`
7. New credentials are saved to keychain
8. Lock is released
9. Original operation is retried with fresh token

Refresh tokens rotate. The CLI validates refresh responses and saves new credentials immediately. File-based locking prevents multiple CLI processes from refreshing the same stored token concurrently.

### Race Condition Prevention

**Location**: `lib/lock.ts`

When multiple CLI processes run concurrently (e.g., in scripts), they may both encounter expired tokens and attempt to refresh simultaneously. Without protection, this causes a race condition:
1. Process A reads refresh token T1
2. Process B reads refresh token T1
3. Process A refreshes and invalidates T1, gets T2
4. Process B tries to refresh with T1 (now invalid) and fails

The CLI prevents this using file-based locking:
- Lock file: `~/Library/Caches/granola/granola-token-refresh.lock` (macOS) or system temp dir
- Uses `O_CREAT | O_EXCL` for atomic lock acquisition
- 30-second timeout waiting for lock
- Stale lock cleanup after 60 seconds
- Credentials are re-read inside the lock to use any updates from other processes

Login uses this same lock for the final credential write after validation. Browser interaction stays outside the lock. An ongoing refresh finishes before login replaces the session.

Malformed access tokens are rejected with a fixed error message before they can appear in a native HTTP header error or be saved to the keychain.

## Configuration Storage

Non-sensitive configuration is stored using the `conf` library:

- **Linux**: `~/.config/granola/`
- **macOS**: `~/Library/Application Support/granola/`
- **Format**: Plaintext JSON (non-sensitive data only)

## Security Measures

### Pager Command Validation

**Location**: `lib/pager.ts`

The CLI validates pager commands to prevent command injection:

- Whitelist of allowed pagers: `less`, `more`, `cat`, `head`, `tail`, `bat`, `most`
- Blocks commands containing shell metacharacters (`;`, `|`, `&`, `$`, `` ` ``, etc.)
- Falls back to direct stdout output if pager command is invalid

```typescript
const ALLOWED_PAGERS = ['less', 'more', 'cat', 'head', 'tail', 'bat', 'most'];
const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>\\!#*?]/;

export function validatePagerCommand(cmd: string): boolean {
  if (SHELL_METACHARACTERS.test(cmd)) return false;
  const [binary] = cmd.split(' ');
  const binaryName = binary.split('/').pop() || '';
  return ALLOWED_PAGERS.includes(binaryName);
}
```

### Alias Command Validation

**Location**: `lib/config.ts`, `lib/alias.ts`

Aliases are validated to prevent command injection:

- `parseAliasArguments()` wrapper around `shell-quote`
- `validateAliasCommand()` rejects pipelines, redirects, or substitution syntax
- Quoted arguments are supported, but only literal argv tokens reach Commander

```typescript
export function parseAliasArguments(command: string): string[] {
  const parsed = parseShellQuote(command);
  if (parsed.length === 0) throw new Error('Alias cannot be empty');
  if (parsed.some((token) => typeof token !== 'string')) {
    throw new Error('Alias command contains unsupported shell syntax.');
  }
  return parsed as string[];
}
```

### Debug Logging

**Location**: `lib/auth.ts`

Authentication errors are logged via the [`debug`](https://www.npmjs.com/package/debug) library:

- Developers can inspect credential-loading issues by enabling `granola:*` namespaces
- Use `DEBUG` or `GRANOLA_DEBUG` environment variables
- Maintains graceful degradation (returns null for non-blocking errors)

Example:

```bash
DEBUG=granola:lib:auth granola auth status
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Authentication required |
| 4 | Resource not found |

## Security Best Practices for Users

- **Never share your refresh token**: Your refresh token provides long-term access to your account.

- **Logout on shared machines**: Always run `granola auth logout` when finished using the CLI on shared or public computers.

- **Be cautious with environment variables**: Avoid setting `GRANOLA_PAGER` to untrusted values or commands from unknown sources.

- **Keep the CLI updated**: Regularly update to the latest version to receive security patches and improvements.

- **Review stored credentials**: Periodically verify that credentials are stored securely in your system's keychain.

## Reporting Security Vulnerabilities

If you discover a security vulnerability in Granola CLI, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Contact the maintainers privately
3. Provide detailed information about the vulnerability
4. Allow reasonable time for a fix before public disclosure

## Additional Resources

- [OWASP Command Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html)
- [Secure Credential Storage Best Practices](https://www.owasp.org/index.php/Password_Storage_Cheat_Sheet)

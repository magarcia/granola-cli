# Contributing to Granola CLI

Thank you for your interest in contributing to Granola CLI! This document provides guidelines and information for contributors.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Testing](#testing)
- [Code Style](#code-style)
- [Adding New Commands](#adding-new-commands)
- [Pull Request Process](#pull-request-process)

## Development Setup

### Prerequisites

- Node.js 20 or higher
- npm 9 or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/magarcia/granola-cli.git
cd granola-cli

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

### Development Workflow

```bash
# Start development mode (watch for changes)
npm run dev

# In another terminal, run the CLI
node dist/main.js meeting list

# Or link globally for testing
npm link
granola meeting list
```

## Project Architecture

### Directory Structure

```
src/
├── main.ts              # Entry point, CLI setup, alias expansion
├── types.ts             # Shared TypeScript types
├── commands/            # Command implementations
├── services/            # API layer
└── lib/                 # Shared utilities
```

### Design Principles

1. **Separation of Concerns**
   - Commands handle CLI interaction (parsing, output)
   - Services handle API communication
   - Libraries provide shared utilities

2. **Testability**
   - All commands export factory functions for fresh instances
   - Dependencies are injectable via module mocking
   - No global state

3. **User Experience**
   - Human-readable output by default
   - Structured output via `-o/--output <format>` for scripting
   - Pager integration for long content
   - Consistent exit codes

### Command Structure

Each command follows this pattern:

```typescript
// src/commands/example/action.ts
import { Command } from 'commander';
import { formatOutput, type OutputFormat } from '../../lib/output.js';

export function createActionCommand() {
  return new Command('action')
    .description('Do something')
    .argument('<id>', 'Resource ID')
    .option('-p, --option <value>', 'An option')
    .option('-o, --output <format>', 'Output format (json, yaml, toon)')
    .action(async (id: string, opts, cmd) => {
      const global = cmd.optsWithGlobals();

      // Get data from service
      const data = await service.get(id);

      // Handle not found
      if (!data) {
        console.error(chalk.red(`Resource ${id} not found`));
        process.exit(4);
      }

      // Structured output mode
      const format = opts.output || null;
      if (format) {
        console.log(formatOutput(data, format as OutputFormat));
        return;
      }

      // Human-readable output
      console.log(chalk.bold(data.title));
    });
}

export const actionCommand = createActionCommand();
```

### Service Structure

Services wrap the Granola API client:

```typescript
// src/services/example.ts
import { getClient } from './client.js';

export async function list(options?: { limit?: number }) {
  const client = await getClient();
  const response = await (client as any).examples.list({
    limit: options?.limit ?? 20,
  });
  return response.data;
}

export async function get(id: string) {
  const client = await getClient();
  try {
    const response = await (client as any).examples.get(id);
    return response.data;
  } catch (error: any) {
    if (error.status === 404) return null;
    throw error;
  }
}
```

## Testing

### Test Philosophy

We use Test-Driven Development (TDD) with a target of 100% code coverage:

1. Write failing tests first
2. Implement minimum code to pass
3. Refactor with confidence
4. Verify coverage

### Running Tests

```bash
# Run tests in watch mode
npm run test:watch

# Run tests once
npm test

# Run with coverage report
npm run test:coverage

# Build and test the CLI against your existing Granola session
npm run test:e2e
```

### Test Structure

Tests mirror the source structure:

```
tests/
├── setup.ts              # Global mocks
├── fixtures/             # Mock data
├── lib/                  # Library tests
├── services/             # Service tests
└── commands/             # Command tests
```

### Writing Command Tests

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { createActionCommand } from '../../../src/commands/example/action.js';

// Mock dependencies
vi.mock('../../../src/services/example.js', () => ({
  get: vi.fn(),
}));

import * as example from '../../../src/services/example.js';

describe('action command', () => {
  let consoleLogs: string[] = [];
  let originalLog: typeof console.log;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogs = [];
    originalLog = console.log;
    console.log = (...args: unknown[]) => consoleLogs.push(args.map(String).join(' '));
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('should display resource details', async () => {
    vi.mocked(example.get).mockResolvedValue({ id: '123', title: 'Test' });

    const program = new Command();
    program.addCommand(createActionCommand());
    await program.parseAsync(['node', 'test', 'action', '123']);

    expect(example.get).toHaveBeenCalledWith('123');
    expect(consoleLogs.some((log) => log.includes('Test'))).toBe(true);
  });

  it('should output JSON when --output json is set', async () => {
    vi.mocked(example.get).mockResolvedValue({ id: '123', title: 'Test' });

    const program = new Command();
    program.addCommand(createActionCommand());
    await program.parseAsync(['node', 'test', 'action', '123', '--output', 'json']);

    const jsonOutput = consoleLogs.find((log) => {
      try { JSON.parse(log); return true; } catch { return false; }
    });
    expect(jsonOutput).toBeDefined();
  });

  it('should exit with code 4 when not found', async () => {
    vi.mocked(example.get).mockResolvedValue(null);
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    const program = new Command();
    program.addCommand(createActionCommand());

    await expect(
      program.parseAsync(['node', 'test', 'action', 'nonexistent'])
    ).rejects.toThrow('process.exit');
    expect(mockExit).toHaveBeenCalledWith(4);

    mockExit.mockRestore();
  });
});
```

### Coverage Requirements

The project enforces these coverage thresholds:

| Metric | Threshold |
|--------|-----------|
| Statements | 95% |
| Branches | 90% |
| Functions | 95% |
| Lines | 95% |

## Code Style

### TypeScript

- Use strict TypeScript (`strict: true`)
- Prefer `const` over `let`
- Use explicit return types for exported functions
- Avoid `any` except when interfacing with untyped libraries

### Formatting

- 2 spaces for indentation
- Single quotes for strings
- Trailing commas in multiline
- No semicolons (handled by formatter)

### Comments

- Focus on "why" not "what"
- Document public APIs
- Keep comments up to date

## Adding New Commands

### 1. Create the Command File

```bash
# Create directory if needed
mkdir -p src/commands/mycommand

# Create the command file
touch src/commands/mycommand/action.ts
```

### 2. Implement the Command

Follow the [command structure](#command-structure) pattern above.

### 3. Create the Index File

```typescript
// src/commands/mycommand/index.ts
import { Command } from 'commander';
import { actionCommand } from './action.js';

export const myCommand = new Command('mycommand')
  .description('My command description');

myCommand.addCommand(actionCommand);
```

### 4. Register in main.ts

```typescript
import { myCommand } from './commands/mycommand/index.js';

program.addCommand(myCommand);
```

### 5. Write Tests

Create corresponding test files:

```bash
mkdir -p tests/commands/mycommand
touch tests/commands/mycommand/action.test.ts
```

### 6. Update Documentation

- Add command to README.md
- Include examples and options

## Pull Request Process

### Before Submitting

1. **Run all checks locally:**
   ```bash
   npm run typecheck
   npm run test:coverage
   npm run build
   ```

2. **Ensure tests pass** with coverage thresholds met

3. **Update documentation** if adding features

4. **Keep commits focused** - one logical change per commit

### PR Guidelines

- **Title**: Clear, concise description of the change
- **Description**: Explain what and why, not just how
- **Tests**: Include tests for new functionality
- **Breaking Changes**: Document in the PR description

### Code Review

- Address all review comments
- Keep discussions constructive
- Ask questions if feedback is unclear

## Questions?

If you have questions about contributing, please open an issue for discussion.

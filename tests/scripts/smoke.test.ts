import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const fakeCli = `#!/usr/bin/env node
const args = process.argv.slice(2).filter((arg) => arg !== '--no-pager');
const mode = process.env.SMOKE_TEST_MODE;
if (args[0] === '--version') console.log('0.2.0');
else if (args[0] === '--help') console.log('Usage: granola');
else if (args[0] === 'auth' && args[1] === 'status') {
  if (mode === 'auth-error') { console.error('private-error-output'); process.exit(2); }
  console.log(JSON.stringify({ authenticated: true }));
} else if (args[0] === 'auth') console.log('Already authenticated');
else if (args[0] === 'folder' && args[1] === 'list' && mode === 'invalid-folder') console.log(JSON.stringify([{ id: 'folder' }]));
else if (args[0] === 'folder' && args[1] === 'list' && mode === 'invalid-json') console.log('private-invalid-json');
else if (args[0] === 'folder' && mode === 'timeout') setTimeout(() => {}, 10000);
else if (args[0] === 'meeting' && args[1] === 'list' && args.includes('0')) process.exit(1);
else if (args[1] === 'view') process.exit(4);
else if (args.includes('json')) console.log('[]');
else console.log('No results found.');
`;

describe('real CLI smoke harness', () => {
  let directory: string;
  let script: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'granola-smoke-test-'));
    await mkdir(join(directory, 'scripts'));
    await mkdir(join(directory, 'dist'));
    script = join(directory, 'scripts', 'smoke.mjs');
    await copyFile(new URL('../../scripts/smoke.mjs', import.meta.url), script);
    const cli = join(directory, 'dist', 'main.js');
    await writeFile(cli, fakeCli);
    await chmod(cli, 0o755);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function run(mode: string) {
    try {
      const { stdout } = await execFileAsync(process.execPath, [script], {
        env: { ...process.env, SMOKE_TEST_MODE: mode },
        timeout: 5000,
      });
      return { code: 0, stdout };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && 'stdout' in error) {
        return { code: error.code, stdout: String(error.stdout) };
      }
      throw error;
    }
  }

  it('accepts valid empty responses and reports unavailable fixtures as skipped', async () => {
    const result = await run('empty');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('SKIP');
    expect(result.stdout).toContain('0 failed');
    expect(result.stdout).toContain('skipped');
    expect(result.stdout).not.toContain('FAIL');
  });

  it('reports authentication exit codes without exposing command output', async () => {
    const result = await run('auth-error');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('CLI exited with code 2');
    expect(result.stdout).not.toContain('private-error-output');
  });

  it('identifies invalid JSON without exposing its contents', async () => {
    const result = await run('invalid-json');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('invalid JSON output');
    expect(result.stdout).not.toContain('private-invalid-json');
  });

  it('does not treat missing document IDs as an unavailable fixture', async () => {
    const result = await run('invalid-folder');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL folder list JSON');
    expect(result.stdout).toContain('unexpected CLI result');
  });

  it('identifies command timeouts separately', async () => {
    const source = await readFile(script, 'utf8');
    await writeFile(script, source.replace('timeout: 30_000', 'timeout: 100'));
    const result = await run('timeout');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('command timed out');
  });
});

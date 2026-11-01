#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, DEBUG: '', NO_COLOR: '1' };
delete env.FORCE_COLOR;

let passed = 0;
let failed = 0;
let skipped = 0;

class SmokeFailure extends Error {}
class MissingFixture extends Error {}

function ensure(condition) {
  if (!condition) throw new SmokeFailure('unexpected CLI result');
}

function requireFixture(value, description) {
  if (!value) throw new MissingFixture(description);
  return value;
}

function expectSuccess(result) {
  if (result.code === 0) return;
  if (result.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    throw new SmokeFailure('command output exceeded the size limit');
  }
  if (result.timedOut) throw new SmokeFailure('command timed out');
  throw new SmokeFailure(
    typeof result.code === 'number' ? `CLI exited with code ${result.code}` : 'CLI could not run',
  );
}

function parseJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    throw new SmokeFailure('invalid JSON output');
  }
}

function run(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cli, '--no-pager', ...args],
      { cwd, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        resolve({ code: error ? error.code : 0, timedOut: error?.killed === true, stdout });
      },
    );
  });
}

async function check(label, action) {
  try {
    const result = await action();
    passed += 1;
    console.log(`PASS ${label}`);
    return result;
  } catch (error) {
    if (error instanceof MissingFixture) {
      skipped += 1;
      console.log(`SKIP ${label}: ${error.message}`);
      return;
    }
    failed += 1;
    console.log(
      `FAIL ${label}: ${error instanceof SmokeFailure ? error.message : 'verification error'}`,
    );
    throw error;
  }
}

async function json(args) {
  const result = await run(args);
  expectSuccess(result);
  return parseJson(result.stdout);
}

async function text(args) {
  const result = await run(args);
  expectSuccess(result);
  return result.stdout.trim();
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasId(value) {
  return isObject(value) && typeof value.id === 'string' && value.id.length > 0;
}

function isNote(value) {
  return (
    (typeof value === 'string' && value.trim().length > 0) ||
    (isObject(value) && value.type === 'doc' && Array.isArray(value.content))
  );
}

async function findContent(kind, candidates) {
  for (const meeting of candidates) {
    const result = await run(['meeting', kind, meeting.id, '--output', 'json']);
    if (result.code === 4) continue;
    expectSuccess(result);
    const data = parseJson(result.stdout);
    if (kind === 'transcript') {
      ensure(Array.isArray(data));
      if (!data.some((segment) => typeof segment.text === 'string' && segment.text.trim())) {
        continue;
      }
      ensure(
        data.every(
          (segment) =>
            typeof segment.text === 'string' &&
            ['microphone', 'system'].includes(segment.source) &&
            Number.isFinite(Date.parse(segment.start_timestamp)),
        ),
      );
      return { meeting, data };
    }

    ensure(isNote(data));
    const rendered = await text(['meeting', kind, meeting.id, '--output', 'markdown']);
    if (rendered.length > 0) return { meeting, data, rendered };
  }
  throw new MissingFixture(`no ${kind} content in the ten most recent meetings`);
}

async function main() {
  await check('--version', async () => {
    ensure(/^\d+\.\d+\.\d+/.test(await text(['--version'])));
  });
  await check('--help', async () => {
    ensure((await text(['--help'])).includes('Usage: granola'));
  });
  await check('auth status JSON (existing session required)', async () => {
    ensure((await json(['auth', 'status', '--output', 'json'])).authenticated === true);
  });
  await check('auth login (reuse existing session)', async () => {
    ensure((await text(['auth', 'login'])).includes('Already authenticated'));
  });

  const workspaces = await check('workspace list JSON', async () => {
    const data = await json(['workspace', 'list', '--output', 'json']);
    ensure(Array.isArray(data) && data.every(hasId));
    return data;
  });
  const workspace = workspaces[0];
  await check('workspace list table', async () => {
    const output = await text(['workspace', 'list']);
    ensure(workspace ? output.includes(workspace.id.slice(0, 8)) : output.length > 0);
  });
  await check('workspace view JSON', async () => {
    requireFixture(workspace, 'no workspace available');
    ensure(
      (await json(['workspace', 'view', workspace.id, '--output', 'json'])).id === workspace.id,
    );
  });
  await check('workspace view text', async () => {
    requireFixture(workspace, 'no workspace available');
    ensure((await text(['workspace', 'view', workspace.id])).includes(workspace.name));
  });

  const folder = await check('folder list JSON (document IDs required)', async () => {
    const data = await json(['folder', 'list', '--output', 'json']);
    ensure(Array.isArray(data) && data.every(hasId));
    ensure(
      data.every(
        (item) =>
          Array.isArray(item.document_ids) &&
          item.document_ids.every((id) => typeof id === 'string'),
      ),
    );
    const selected = data.find(
      (item) => Array.isArray(item.document_ids) && item.document_ids.length > 0,
    );
    requireFixture(selected, 'no folder with documents available');
    ensure(selected.document_ids.every((id) => typeof id === 'string'));
    return selected;
  });
  await check('folder list table', async () => {
    const output = await text(['folder', 'list']);
    ensure(folder ? output.includes(folder.id.slice(0, 8)) : output.length > 0);
  });
  await check('folder view JSON (preserves document IDs)', async () => {
    requireFixture(folder, 'no folder with documents available');
    const data = await json(['folder', 'view', folder.id, '--output', 'json']);
    ensure(data.id === folder.id && Array.isArray(data.document_ids));
    ensure(
      data.document_ids.length === folder.document_ids.length &&
        data.document_ids.every((id, index) => id === folder.document_ids[index]),
    );
  });
  await check('folder view text', async () => {
    requireFixture(folder, 'no folder with documents available');
    ensure((await text(['folder', 'view', folder.id])).includes(folder.name || folder.title));
  });
  await check('meeting list --folder JSON', async () => {
    requireFixture(folder, 'no folder with documents available');
    const data = await json([
      'meeting',
      'list',
      '--folder',
      folder.id,
      '--limit',
      '1',
      '--output',
      'json',
    ]);
    ensure(Array.isArray(data) && data.length === 1 && hasId(data[0]));
    ensure(folder.document_ids.includes(data[0].id));
  });

  const meetings = await check('meeting list JSON', async () => {
    const data = await json(['meeting', 'list', '--limit', '10', '--output', 'json']);
    ensure(Array.isArray(data) && data.length <= 10 && data.every(hasId));
    return data;
  });
  const meeting = meetings[0];
  await check('meeting list table', async () => {
    const output = await text(['meeting', 'list', '--limit', '10']);
    ensure(meeting ? output.includes(meeting.id.slice(0, 8)) : output.length > 0);
  });
  await check('meeting view JSON', async () => {
    requireFixture(meeting, 'no meeting available');
    ensure((await json(['meeting', 'view', meeting.id, '--output', 'json'])).id === meeting.id);
  });
  await check('meeting view text', async () => {
    requireFixture(meeting, 'no meeting available');
    ensure((await text(['meeting', 'view', meeting.id])).includes(meeting.title));
  });

  const notes = await check('meeting notes JSON (nonempty fixture required)', () =>
    findContent('notes', meetings),
  );
  await check('meeting notes Markdown', async () => {
    requireFixture(notes, 'no manual notes available');
    ensure((await text(['meeting', 'notes', notes.meeting.id])).length > 0);
  });
  const enhanced = await check('meeting enhanced JSON (nonempty fixture required)', () =>
    findContent('enhanced', meetings),
  );
  await check('meeting enhanced Markdown', async () => {
    requireFixture(enhanced, 'no enhanced notes available');
    ensure((await text(['meeting', 'enhanced', enhanced.meeting.id])).length > 0);
  });
  const transcript = await check('meeting transcript JSON (nonempty fixture required)', () =>
    findContent('transcript', meetings),
  );
  const segment = transcript?.data.find((item) => item.text.trim());
  await check('meeting transcript text', async () => {
    requireFixture(transcript, 'no transcript available');
    ensure((await text(['meeting', 'transcript', transcript.meeting.id])).includes(segment.text));
  });
  await check('meeting transcript timestamps', async () => {
    requireFixture(transcript, 'no transcript available');
    const output = await text(['meeting', 'transcript', transcript.meeting.id, '--timestamps']);
    ensure(/^\[\d{2}:\d{2}:\d{2}\]/m.test(output) && output.includes(segment.text));
  });
  await check('meeting transcript source filter', async () => {
    requireFixture(transcript, 'no transcript available');
    const output = await text([
      'meeting',
      'transcript',
      transcript.meeting.id,
      '--source',
      segment.source,
    ]);
    const expected = transcript.data
      .filter((item) => item.source === segment.source)
      .map((item) => `${item.source === 'microphone' ? 'You' : 'Participant'}: ${item.text}`)
      .join('\n\n')
      .trim();
    ensure(output === expected);
  });
  await check('meeting export JSON', async () => {
    requireFixture(notes, 'no manual notes available');
    const data = await json(['meeting', 'export', notes.meeting.id, '--format', 'json']);
    const details = await json(['meeting', 'view', notes.meeting.id, '--output', 'json']);
    ensure(data.id === notes.meeting.id && data.title === notes.meeting.title);
    ensure(typeof data.created_at === 'string' && typeof data.updated_at === 'string');
    ensure(isNote(data.notes_raw) && data.notes_markdown === notes.rendered);
    ensure(Array.isArray(data.transcript));
    const people =
      details.people ??
      (details.creator || details.attendees
        ? {
            creator: details.creator,
            attendees: details.attendees,
          }
        : undefined);
    ensure(JSON.stringify(data.people) === JSON.stringify(people));
  });

  await check('meeting list invalid limit (exit 1)', async () => {
    ensure((await run(['meeting', 'list', '--limit', '0'])).code === 1);
  });
  await check('meeting view missing UUID (exit 4)', async () => {
    ensure((await run(['meeting', 'view', randomUUID(), '--output', 'json'])).code === 4);
  });
}

try {
  await main();
} catch {
  process.exitCode = 1;
}
console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped.`);

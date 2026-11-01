import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForChromeCallback } from '../../src/lib/chrome-callback.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const state = '28b6d570-9709-42a2-8f29-d30320b0ba49';
const callback = `https://granola.ai/app-redirect?code=private-code&signInClickId=${state}`;

function reply(stdout: string, error: Error | null = null) {
  vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
    const complete = args.at(-1);
    if (typeof complete !== 'function') throw new Error('Missing process callback');
    complete(error, stdout, 'private-script-output');
    return {} as ReturnType<typeof execFile>;
  });
}

afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe('Chrome callback detection', () => {
  it('returns the matching URL using a bounded, cancellable Chrome query', async () => {
    reply(`${callback}\n`);
    const controller = new AbortController();
    await expect(waitForChromeCallback(state, controller.signal)).resolves.toBe(callback);
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      ['-e', expect.any(String), state],
      expect.objectContaining({ signal: controller.signal, timeout: 10000, maxBuffer: 16384 }),
      expect.any(Function),
    );
  });

  it('polls again when sign-in has not reached the callback', async () => {
    vi.useFakeTimers();
    reply('');
    reply(callback);
    const result = waitForChromeCallback(state, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe(callback);
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('stops polling when cancelled between queries', async () => {
    vi.useFakeTimers();
    reply('');
    const controller = new AbortController();
    const result = expect(waitForChromeCallback(state, controller.signal)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await result;
    await vi.advanceTimersByTimeAsync(1000);
    expect(execFile).toHaveBeenCalledOnce();
  });

  it('rejects permission and script failures without returning process details', async () => {
    reply('', new Error('private-code from process failure'));
    await expect(waitForChromeCallback(state, new AbortController().signal)).rejects.toThrow(
      'Chrome callback detection is unavailable.',
    );
    expect(execFile).toHaveBeenCalledOnce();
  });
});

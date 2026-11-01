import { createHash } from 'node:crypto';
import { platform } from 'node:os';
import { createInterface } from 'node:readline/promises';
import open from 'open';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginWithBrowser } from '../../src/lib/browser-auth.js';
import { waitForChromeCallback } from '../../src/lib/chrome-callback.js';

vi.mock('node:os', () => ({ platform: vi.fn(() => 'darwin') }));
vi.mock('node:readline/promises', () => ({ createInterface: vi.fn() }));
vi.mock('../../src/lib/chrome-callback.js', () => ({ waitForChromeCallback: vi.fn() }));

const credentials = {
  accessToken: 'test-browser-access',
  refreshToken: 'test-browser-refresh',
  clientId: 'client_GranolaMac',
};

describe('browser authentication', () => {
  const originalTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const prompt = {
    question: vi.fn(),
    close: vi.fn(),
    once: vi.fn(),
  };
  const listeners = new Map<string, () => void>();
  const fetchMock = vi.fn<typeof fetch>();

  function loginUrl(): URL {
    return new URL(String(vi.mocked(open).mock.calls[0][0]));
  }

  function callbackUrl(base = 'https://granola.ai/app-redirect'): string {
    const url = new URL(base);
    url.searchParams.set('code', 'one-time-browser-code');
    url.searchParams.set('signInClickId', loginUrl().searchParams.get('sign_in_click_id') ?? '');
    return url.toString();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(waitForChromeCallback).mockRejectedValue(new Error('Chrome unavailable'));
    listeners.clear();
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.mocked(createInterface).mockReturnValue(prompt as never);
    prompt.once.mockImplementation((event, listener) => {
      listeners.set(event, listener);
      return prompt;
    });
    prompt.question.mockImplementation(async () => callbackUrl());
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: credentials.accessToken,
          refresh_token: credentials.refreshToken,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (originalTty) {
      Object.defineProperty(process.stdin, 'isTTY', originalTty);
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY');
    }
  });

  it('generates PKCE, opens Google sign-in, and exchanges the matching callback', async () => {
    await expect(loginWithBrowser()).resolves.toEqual(credentials);

    const url = loginUrl();
    expect(url.origin + url.pathname).toBe('https://api.granola.ai/v1/auth');
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('platform')).toBe('macOS');
    expect(url.searchParams.get('version')).toBe('7.0.0');
    expect(url.searchParams.get('redirect')).toBe('https://notes.granola.ai/#/login-in-progress');
    expect(url.searchParams.get('sign_in_click_id')).toMatch(/^[\da-f-]{36}$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, request] = fetchMock.mock.calls[0];
    expect(endpoint).toBe('https://api.granola.ai/v1/workos-auth-complete');
    expect(request?.method).toBe('POST');
    expect(request?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(request?.body));
    expect(body.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createHash('sha256').update(body.codeVerifier).digest('base64url')).toBe(
      url.searchParams.get('code_challenge'),
    );
    expect(body).toMatchObject({
      code: 'one-time-browser-code',
      platform: 'macOS',
      isDev: false,
      sso: false,
      ssoCode: '',
      signInClickId: url.searchParams.get('sign_in_click_id'),
    });
    expect(createInterface).toHaveBeenCalledWith({ input: process.stdin, output: process.stderr });
    expect(prompt.close).toHaveBeenCalledOnce();
  });

  it('supports Microsoft sign-in', async () => {
    await loginWithBrowser({ provider: 'microsoft' });
    expect(loginUrl().searchParams.get('provider')).toBe('microsoft');
  });

  it('reads the current login callback from Chrome by default without asking for paste', async () => {
    vi.mocked(waitForChromeCallback).mockImplementation(async (state) => {
      expect(state).toBe(loginUrl().searchParams.get('sign_in_click_id'));
      return callbackUrl();
    });
    await expect(loginWithBrowser()).resolves.toEqual(credentials);
    expect(open).toHaveBeenCalledWith(expect.any(String), { app: { name: 'Google Chrome' } });
    expect(prompt.question).not.toHaveBeenCalled();
    expect(vi.mocked(waitForChromeCallback).mock.calls[0][1].aborted).toBe(true);
    expect(prompt.close).toHaveBeenCalledOnce();
    expect(process.stderr.write).not.toHaveBeenCalledWith(
      expect.stringContaining('one-time-browser-code'),
    );
  });

  it('asks for paste after one minute without a detected callback', async () => {
    vi.useFakeTimers();
    vi.mocked(waitForChromeCallback).mockImplementation(
      (_state, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('detection aborted')));
        }),
    );
    const result = loginWithBrowser();
    await vi.advanceTimersByTimeAsync(59999);
    expect(prompt.question).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(credentials);
    expect(vi.mocked(waitForChromeCallback).mock.calls[0][1].aborted).toBe(true);
    expect(prompt.question).toHaveBeenCalledOnce();
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Chrome callback detection is unavailable'),
    );
  });

  it('falls back to manual paste when Chrome automation is denied', async () => {
    vi.mocked(waitForChromeCallback).mockImplementation(async () => {
      expect(prompt.question).not.toHaveBeenCalled();
      throw new Error('private OS details');
    });
    await expect(loginWithBrowser()).resolves.toEqual(credentials);
    expect(prompt.question).toHaveBeenCalledOnce();
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Chrome callback detection is unavailable'),
    );
    expect(process.stderr.write).not.toHaveBeenCalledWith(
      expect.stringContaining('private OS details'),
    );
  });

  it('falls back to the default browser when Chrome cannot be opened', async () => {
    vi.mocked(open).mockRejectedValueOnce(new Error('Chrome missing'));
    await expect(loginWithBrowser()).resolves.toEqual(credentials);
    expect(open).toHaveBeenCalledTimes(2);
    expect(vi.mocked(open).mock.calls[1]).toHaveLength(1);
    expect(waitForChromeCallback).not.toHaveBeenCalled();
  });

  it('uses manual paste on other operating systems', async () => {
    vi.mocked(platform).mockReturnValue('linux');
    await expect(loginWithBrowser()).resolves.toEqual(credentials);
    expect(waitForChromeCallback).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(expect.any(String));
  });

  it('uses manual paste in the default browser when detection is disabled', async () => {
    await loginWithBrowser({ autoCallback: false });
    expect(waitForChromeCallback).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(expect.any(String));
    expect(prompt.question).toHaveBeenCalledOnce();
  });

  it('validates detected callbacks before exchanging them', async () => {
    prompt.question.mockReturnValue(new Promise(() => {}));
    vi.mocked(waitForChromeCallback).mockResolvedValue(
      'https://granola.ai/app-redirect?code=private-code&signInClickId=another-login',
    );
    await expect(loginWithBrowser({ autoCallback: true })).rejects.toThrow(/does not match/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prompt.close).toHaveBeenCalledOnce();
  });

  it.each(['SIGINT', 'close'])('cancels during Chrome detection on %s', async (event) => {
    vi.mocked(waitForChromeCallback).mockImplementation(
      (_state, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('detection aborted')));
          queueMicrotask(() => listeners.get(event)?.());
        }),
    );
    await expect(loginWithBrowser()).rejects.toThrow(/cancelled/i);
    expect(prompt.question).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.mocked(waitForChromeCallback).mock.calls[0][1].aborted).toBe(true);
    expect(prompt.close).toHaveBeenCalledOnce();
  });

  it.each([
    'https://www.granola.ai/app-redirect',
    'granola://login-complete',
  ])('accepts the known callback %s', async (base) => {
    prompt.question.mockImplementation(async () => callbackUrl(base));
    await expect(loginWithBrowser()).resolves.toEqual(credentials);
  });

  it.each([
    '#',
    '#/login-in-progress?',
  ])('reads callback parameters from a fragment %s', async (hash) => {
    prompt.question.mockImplementation(async () => {
      const callback = new URL(callbackUrl());
      callback.hash = hash + callback.search.slice(1);
      callback.search = '';
      return callback.toString();
    });
    await expect(loginWithBrowser()).resolves.toEqual(credentials);
  });

  it('preserves callback authContext and SSO parameters in the exchange', async () => {
    prompt.question.mockImplementation(async () => {
      const callback = new URL(callbackUrl());
      callback.searchParams.set('authContext', 'callback-auth-context');
      callback.searchParams.set('sso', 'true');
      callback.searchParams.set('ssoCode', 'callback-sso-code');
      return callback.toString();
    });
    await loginWithBrowser();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      authContext: 'callback-auth-context',
      sso: true,
      ssoCode: 'callback-sso-code',
    });
  });

  it('rejects a callback from another sign-in without exchanging it', async () => {
    prompt.question.mockImplementation(async () => {
      const callback = new URL(callbackUrl());
      callback.searchParams.set('signInClickId', 'another-login');
      return callback.toString();
    });
    await expect(loginWithBrowser()).rejects.toThrow(/does not match/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prompt.close).toHaveBeenCalledOnce();
  });

  it.each([
    'https://example.com/app-redirect',
    'http://granola.ai/app-redirect',
    'https://granola.ai/not-a-callback',
    'https://attacker@granola.ai/app-redirect',
    'granola://other-command',
  ])('rejects an unexpected callback URL %s', async (base) => {
    prompt.question.mockImplementation(async () => callbackUrl(base));
    await expect(loginWithBrowser()).rejects.toThrow(/callback URL/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed callback URL', async () => {
    prompt.question.mockResolvedValue('not a URL');
    await expect(loginWithBrowser()).rejects.toThrow(/callback URL/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a callback with no authorization code', async () => {
    prompt.question.mockImplementation(async () => {
      const callback = new URL(callbackUrl());
      callback.searchParams.delete('code');
      return callback.toString();
    });
    await expect(loginWithBrowser()).rejects.toThrow(/missing/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects noninteractive input before opening a browser', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    await expect(loginWithBrowser()).rejects.toThrow(/interactive terminal/i);
    expect(open).not.toHaveBeenCalled();
    expect(createInterface).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports browser-launch failure without exposing its arguments', async () => {
    vi.mocked(open).mockRejectedValueOnce(new Error('private browser arguments'));
    await expect(loginWithBrowser({ autoCallback: false })).rejects.toThrow(/could not open/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows cancellation without making an exchange request', async () => {
    prompt.question.mockResolvedValue('cancel');
    await expect(loginWithBrowser()).rejects.toThrow(/cancelled/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prompt.close).toHaveBeenCalledOnce();
  });

  it.each([
    false,
    true,
  ])('bounds sign-in to five minutes (auto callback: %s)', async (autoCallback) => {
    vi.useFakeTimers();
    prompt.question.mockImplementation(
      (_question, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('question aborted')), {
            once: true,
          });
        }),
    );
    const result = expect(loginWithBrowser({ autoCallback })).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await result;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prompt.close).toHaveBeenCalledOnce();
    if (autoCallback) {
      expect(vi.mocked(waitForChromeCallback).mock.calls[0][1].aborted).toBe(true);
    }
  });

  it.each([
    false,
    true,
  ])('cancels on terminal interrupt (auto callback: %s)', async (autoCallback) => {
    prompt.question.mockImplementation(
      (_question, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('question aborted')), {
            once: true,
          });
          queueMicrotask(() => listeners.get('SIGINT')?.());
        }),
    );
    await expect(loginWithBrowser({ autoCallback })).rejects.toThrow(/cancelled/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports exchange HTTP failure without including its response body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('secret exchange response', { status: 401 }));
    await expect(loginWithBrowser()).rejects.toThrow(/HTTP 401/);
    expect(process.stderr.write).not.toHaveBeenCalledWith(
      expect.stringContaining('secret exchange'),
    );
  });

  it('reports a network failure without exposing request details', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private request details'));
    await expect(loginWithBrowser()).rejects.toThrow(/check your connection/i);
  });

  it.each([false, true])('cancels on closed input (auto callback: %s)', async (autoCallback) => {
    prompt.question.mockImplementation(
      (_question, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('question aborted')), {
            once: true,
          });
          queueMicrotask(() => listeners.get('close')?.());
        }),
    );
    await expect(loginWithBrowser({ autoCallback })).rejects.toThrow(/cancelled/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { access_token: 'access', refresh_token: '' },
    { access_token: '', refresh_token: 'refresh' },
    { access_token: 123, refresh_token: 'refresh' },
    { access_token: 'access', refresh_token: 123 },
  ])('rejects invalid exchange credentials %j', async (payload) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    await expect(loginWithBrowser()).rejects.toThrow(/valid credentials/i);
  });

  it('rejects malformed exchange JSON without exposing it', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not-json-with-private-data', { status: 200 }));
    await expect(loginWithBrowser()).rejects.toThrow(/invalid response/i);
  });

  it('keeps credentials and the callback out of terminal output', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await loginWithBrowser();
    const stderr = vi
      .mocked(process.stderr.write)
      .mock.calls.map(([value]) => String(value))
      .join('');
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toContain(credentials.accessToken);
    expect(stderr).not.toContain(credentials.refreshToken);
    expect(stderr).not.toContain('one-time-browser-code');
    expect(stderr).not.toContain('code_verifier');
  });
});

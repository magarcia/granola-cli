import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { platform } from 'node:os';
import { createInterface } from 'node:readline/promises';
import open from 'open';
import type { Credentials } from '../types.js';
import { parseSupabaseJson } from './auth.js';
import { waitForChromeCallback } from './chrome-callback.js';

const API_ORIGIN = 'https://api.granola.ai';
const APP_VERSION = '7.0.0';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const AUTO_CALLBACK_TIMEOUT_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

export interface BrowserLoginOptions {
  provider?: 'google' | 'microsoft';
  autoCallback?: boolean;
}

function parseCallback(input: string, expectedState: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Invalid Granola callback URL. Copy the full browser address after sign-in.');
  }

  const native = url.protocol === 'granola:' && url.hostname === 'login-complete';
  const web =
    url.protocol === 'https:' &&
    ['granola.ai', 'www.granola.ai'].includes(url.hostname) &&
    url.pathname === '/app-redirect';
  if ((!native && !web) || url.username || url.password || url.port) {
    throw new Error('Invalid Granola callback URL. Copy the full browser address after sign-in.');
  }

  const parameters = new URLSearchParams(url.search);
  const fragment = url.hash.slice(1);
  const queryAt = fragment.indexOf('?');
  const fragmentParameters = new URLSearchParams(
    queryAt === -1 ? fragment : fragment.slice(queryAt + 1),
  );
  for (const [name, value] of fragmentParameters) {
    if (!parameters.has(name)) parameters.append(name, value);
  }

  const code = parameters.get('code');
  const state = parameters.get('signInClickId');
  if (!code || !state) {
    throw new Error(
      'The callback URL is missing sign-in parameters. Copy the full browser address.',
    );
  }
  if (state !== expectedState) {
    throw new Error('The callback does not match this sign-in. Run granola auth login again.');
  }
  return {
    code,
    signInClickId: state,
    sso: parameters.get('sso') === 'true',
    ssoCode: parameters.get('ssoCode') ?? '',
    authContext: parameters.get('authContext'),
  };
}

async function readCallback(expectedState: string, autoCallback: boolean): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LOGIN_TIMEOUT_MS);
  prompt.once('SIGINT', () => controller.abort());
  prompt.once('close', () => controller.abort());

  try {
    if (autoCallback) {
      const detection = new AbortController();
      const cancelDetection = () => detection.abort();
      controller.signal.addEventListener('abort', cancelDetection, { once: true });
      const detectionTimer = setTimeout(cancelDetection, AUTO_CALLBACK_TIMEOUT_MS);
      try {
        return await waitForChromeCallback(expectedState, detection.signal);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        process.stderr.write(
          'Chrome callback detection is unavailable. Copy the final browser address and paste it below.\n',
        );
      } finally {
        clearTimeout(detectionTimer);
        controller.signal.removeEventListener('abort', cancelDetection);
        detection.abort();
      }
    }
    const input = await prompt.question('Paste the callback URL (or "cancel"): ', {
      signal: controller.signal,
    });
    if (input.trim() === 'cancel') throw new Error('Sign-in cancelled.');
    return input;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        timedOut ? 'Browser sign-in timed out after five minutes.' : 'Sign-in cancelled.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    prompt.close();
  }
}

export async function loginWithBrowser(options: BrowserLoginOptions = {}): Promise<Credentials> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'Browser sign-in requires an interactive terminal. Run granola auth login there.',
    );
  }

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const signInClickId = randomUUID();
  const os = platform();
  const clientPlatform = os === 'darwin' ? 'macOS' : os === 'win32' ? 'Windows' : os;
  const url = new URL('/v1/auth', API_ORIGIN);
  url.search = new URLSearchParams({
    dev: 'false',
    code_challenge: challenge,
    platform: clientPlatform,
    version: APP_VERSION,
    sign_in_click_id: signInClickId,
    intent: 'download',
    provider: options.provider ?? 'google',
    redirect: 'https://notes.granola.ai/#/login-in-progress',
  }).toString();

  let autoCallback = options.autoCallback !== false && os === 'darwin';
  try {
    if (autoCallback) {
      try {
        await open(url.toString(), { app: { name: 'Google Chrome' } });
      } catch {
        autoCallback = false;
        process.stderr.write(
          'Could not open Chrome. Opening your default browser for manual paste.\n',
        );
        await open(url.toString());
      }
    } else {
      await open(url.toString());
    }
  } catch {
    throw new Error('Could not open your browser. Check your default browser and try again.');
  }
  process.stderr.write(
    autoCallback
      ? 'Complete sign-in in Chrome and leave the Opening Granola page open. macOS may ask for Automation permission.\nWaiting for the matching callback in all Chrome windows (up to one minute). Press Ctrl+C to cancel.\n'
      : 'Complete sign-in in your browser, then copy its final address and paste it below.\n',
  );
  const callback = parseCallback(await readCallback(signInClickId, autoCallback), signInClickId);
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}/v1/workos-auth-complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Version': APP_VERSION,
        'X-Granola-Platform': clientPlatform,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        code: callback.code,
        codeVerifier: verifier,
        platform: clientPlatform,
        isDev: false,
        sso: callback.sso,
        ssoCode: callback.ssoCode,
        signInClickId: callback.signInClickId,
        ...(callback.authContext ? { authContext: callback.authContext } : {}),
      }),
    });
  } catch {
    throw new Error('Could not complete browser sign-in. Check your connection and try again.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Browser sign-in failed (HTTP ${response.status}). Run granola auth login again.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Granola returned an invalid response during browser sign-in.');
  }
  const credentials = parseSupabaseJson(JSON.stringify(payload));
  if (!credentials?.accessToken || !credentials.refreshToken) {
    throw new Error('Granola did not return valid credentials during browser sign-in.');
  }
  return credentials;
}

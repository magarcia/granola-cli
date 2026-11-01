import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const CALLBACK_SCRIPT = `
on run argv
  set expectedState to item 1 of argv
  if application "Google Chrome" is not running then error "Chrome is not running"
  tell application "Google Chrome"
    repeat with browserWindow in windows
      repeat with browserTab in tabs of browserWindow
        set tabURL to URL of browserTab
        if tabURL starts with "https://granola.ai/app-redirect?" or tabURL starts with "https://granola.ai/app-redirect#" or tabURL starts with "https://www.granola.ai/app-redirect?" or tabURL starts with "https://www.granola.ai/app-redirect#" then
          if tabURL contains ("signInClickId=" & expectedState) then return tabURL
        end if
      end repeat
    end repeat
  end tell
  return ""
end run
`;

export async function waitForChromeCallback(
  expectedState: string,
  signal: AbortSignal,
): Promise<string> {
  while (true) {
    signal.throwIfAborted();
    const callback = await new Promise<string>((resolve, reject) => {
      execFile(
        '/usr/bin/osascript',
        ['-e', CALLBACK_SCRIPT, expectedState],
        { signal, timeout: 10000, maxBuffer: 16384, encoding: 'utf8' },
        (error, stdout) => {
          if (error) reject(new Error('Chrome callback detection is unavailable.'));
          else resolve(stdout.trim());
        },
      );
    });
    if (callback) return callback;
    await delay(1000, undefined, { signal });
  }
}

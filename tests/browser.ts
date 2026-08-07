import { chromium, type Browser } from 'playwright';

// This image ships a prebuilt Chromium (chromium-1194) that does not match the
// revision the installed Playwright expects, so the default launch path misses.
// PLAYWRIGHT_CHROMIUM_PATH overrides; /opt/pw-browsers/chromium is a stable
// symlink to the bundled binary. Falling back to undefined lets Playwright use
// its own download when running somewhere that has one.
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (process.env.PLAYWRIGHT_BROWSERS_PATH ? '/opt/pw-browsers/chromium' : undefined);

export function launchBrowser(): Promise<Browser> {
  return chromium.launch({ executablePath });
}

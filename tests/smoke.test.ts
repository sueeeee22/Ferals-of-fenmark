import { afterAll, beforeAll, expect, test } from 'vitest';
import type { Browser } from 'playwright';
import { launchBrowser } from './browser';

let browser: Browser;

beforeAll(async () => {
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser?.close();
});

test('chromium renders a page', async () => {
  const page = await browser.newPage();
  await page.setContent('<h1>Ferals of Fenmark</h1>');
  expect(await page.textContent('h1')).toBe('Ferals of Fenmark');
  await page.close();
});

import { test, expect } from '@playwright/test';
import * as path from 'path';

/**
 * Hi-res screenshots for the README. Server must be running on 127.0.0.1:7790
 * with HOME pointed at scripts/gen-demo-home.py output (so all data is fake).
 *
 *   python3 scripts/gen-demo-home.py /tmp/pawscope-demo-home
 *   HOME=/tmp/pawscope-demo-home ./target/release/pawscope serve \
 *     --bind 127.0.0.1:7790 --no-open
 *   npx playwright test e2e/screenshots.spec.ts
 */
const BASE = 'http://127.0.0.1:7790';
const OUT = path.resolve(__dirname, '../docs/screenshots');
const VW = { width: 1600, height: 1000 };

test.use({ viewport: VW });

async function setup(page: import('@playwright/test').Page) {
  await page.setViewportSize(VW);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav', { timeout: 10_000 });
  await page.waitForTimeout(1500);
}

async function clickTopNav(page: import('@playwright/test').Page, label: RegExp) {
  // Top tabs live in the first <nav> in the sidebar.
  const tab = page.locator('nav').first().getByRole('button', { name: label }).first();
  await tab.click();
  await page.waitForTimeout(1500);
}

test('01-overview', async ({ page }) => {
  await setup(page);
  await page.screenshot({ path: path.join(OUT, '01-overview.png'), fullPage: false });
});

test('02-session', async ({ page }) => {
  await setup(page);
  // Click the first real session card (skip the search/filter/star buttons by
  // anchoring to a known session title).
  const card = page.getByText('Build TODO app with React + Tailwind').first();
  await card.click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, '02-session.png'), fullPage: false });
});

test('03-flow', async ({ page }) => {
  await setup(page);
  const card = page.getByText('Build TODO app with React + Tailwind').first();
  await card.click();
  await page.waitForTimeout(1200);
  // Switch to the Conversation tab inside the session.
  const convTab = page.getByRole('button', { name: /^Conversation$|对话流/ }).first();
  await convTab.click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, '03-flow.png'), fullPage: false });
});

test('04-skills', async ({ page }) => {
  await setup(page);
  await clickTopNav(page, /Skills|技能/);
  await page.screenshot({ path: path.join(OUT, '04-skills.png'), fullPage: false });
});

test('05-prompts', async ({ page }) => {
  await setup(page);
  await clickTopNav(page, /Prompts|提示/);
  await page.screenshot({ path: path.join(OUT, '05-prompts.png'), fullPage: false });
});

test('06-config', async ({ page }) => {
  await setup(page);
  await clickTopNav(page, /Config|配置/);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, '06-config.png'), fullPage: false });
});

test('07-store', async ({ page }) => {
  await setup(page);
  await clickTopNav(page, /Store|商店/);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, '07-store.png'), fullPage: false });
});

test('08-instructions', async ({ page }) => {
  await setup(page);
  // Click a session and capture the detail view showing system prompt
  const card = page.getByText('Add Stripe webhook handler').first();
  await card.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, '08-instructions.png'), fullPage: false });
});

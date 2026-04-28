import { test } from '@playwright/test';
test('snap', async ({ page }) => {
  await page.goto('http://127.0.0.1:7777/');
  await page.waitForSelector('aside button', { timeout: 5000 });
  await page.locator('aside button').first().click();
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.screenshot({ path: '/tmp/agent-lens-snap.png', fullPage: false });
});

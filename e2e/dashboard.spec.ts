import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';

let proc: ChildProcess;

test.beforeAll(async () => {
  proc = spawn('../target/release/agent-lens', ['serve', '--no-open'], {
    env: { ...process.env, COPILOT_STATE_DIR: '../tests/fixtures/copilot' },
    stdio: 'pipe'
  });
  await new Promise(r => setTimeout(r, 1500));
});
test.afterAll(() => { proc.kill('SIGTERM'); });

test('dashboard shows fixture session', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside button').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('aside button').first()).toContainText('4dac1bf8');
});

test('selecting a session shows detail', async ({ page }) => {
  await page.goto('/');
  await page.locator('aside button').first().click();
  await expect(page.getByText(/Turns/i)).toBeVisible();
});

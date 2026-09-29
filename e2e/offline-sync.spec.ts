import { test, expect } from '@playwright/test';

// Scenario: engineer signs in with network, loses signal, records findings, regains signal -> auto sync.
test('findings captured offline sync automatically when the network returns', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('Username').fill('engineer1');
  await page.getByLabel('Password').fill('Field@123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('sync-status')).toContainText('All synced');

  // --- go offline (like entering a no-signal area) ---
  await context.setOffline(true);
  await expect(page.getByTestId('sync-status')).toContainText('Offline');

  for (let i = 0; i < 3; i++) {
    if (i === 0) await page.getByLabel('Expedition').selectOption({ index: 1 });
    await page.getByLabel('Latitude').fill(String(22.5 + i * 0.01));
    await page.getByLabel('Longitude').fill(String(72.5 + i * 0.01));
    await page.getByLabel('Depth (m)').fill(String(40 + i));
    await page.getByRole('button', { name: 'Save finding' }).click();
    await expect(page.getByTestId('sync-status')).toContainText(`${i + 1} waiting to sync`);
  }
  await expect(page.getByTestId('sync-status')).toContainText('3 waiting to sync');

  // --- back online: sync must start on its own ---
  await context.setOffline(false);
  await expect(page.getByTestId('sync-status')).toContainText('All synced', { timeout: 15_000 });

  await page.getByRole('link', { name: 'Findings' }).click();
  await expect(page.locator('.badge.pending')).toHaveCount(0);
  expect(await page.locator('.badge.synced').count()).toBeGreaterThanOrEqual(3);
});

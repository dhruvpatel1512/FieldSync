import { test, expect } from '@playwright/test';

const API = 'http://localhost:5080/api';

// Scenario: two devices edit the same finding; the analyst signs in, lands on the dashboard and keeps the device edit.
test('analyst resolves a sync conflict from the admin dashboard', async ({ page, request }) => {
  const { token } = await (await request.post(`${API}/auth/login`, { data: { username: 'engineer1', password: 'Field@123' } })).json();
  const push = async (deviceId: string, finding: object) =>
    (await (await request.post(`${API}/sync/push`, { headers: { Authorization: `Bearer ${token}` }, data: { deviceId, findings: [finding] } })).json()).results[0];

  const at = (s: number) => new Date(Date.now() + s * 1000).toISOString();
  const base = {
    id: crypto.randomUUID(), expeditionId: 1, latitude: 22.9, longitude: 72.9, gpsAccuracyM: 5, materialType: 'Shale',
    hydrocarbonIndicator: 'None', depthM: 10, notes: 'e2e conflict', capturedAt: at(0), clientUpdatedAt: at(0), baseServerVersion: null, isDeleted: false,
  };
  const v1 = (await push('e2e-device-A', base)).serverVersion;
  await push('e2e-device-B', { ...base, depthM: 20, baseServerVersion: v1, clientUpdatedAt: at(1) });
  expect((await push('e2e-device-A', { ...base, depthM: 30, baseServerVersion: v1, clientUpdatedAt: at(2) })).status).toBe('conflict');

  // Analyst login routes to the dashboard, not the capture form
  await page.goto('/');
  await page.getByLabel('Username').fill('analyst1');
  await page.getByLabel('Password').fill('Office@123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('link', { name: 'Capture' })).toHaveCount(0);

  const card = page.getByTestId('conflict').filter({ hasText: base.id.slice(0, 8) });
  // Only depth differs: server kept device B's 20, device A wants 30 (retries until the analyst's pull has landed)
  await expect(card.locator('tr.diff')).toHaveCount(1);
  await expect(card.locator('tr.diff td')).toHaveText(['20', '30']);
  await card.getByRole('button', { name: 'Keep device edit' }).click();
  await expect(card).toHaveCount(0);

  // Engineers can't open the dashboard
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Username').fill('engineer1');
  await page.getByLabel('Password').fill('Field@123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.goto('/admin');
  await expect(page).not.toHaveURL(/\/admin$/);
});

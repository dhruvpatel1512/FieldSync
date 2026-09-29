import { defineConfig } from '@playwright/test';

// Start the API (dotnet run) and the web app (ng serve) first, then: npx playwright test
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4200', trace: 'retain-on-failure' },
});

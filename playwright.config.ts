import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const launchOptions = exe ? { executablePath: exe, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] };

export default defineConfig({
  testDir: 'e2e',
  timeout: 20_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199/', launchOptions },
  projects: [
    { name: 'iphone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { name: 'small-android', use: { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    {
      // A real production build served under /weddingapp/, exactly like GitHub Pages.
      name: 'pages-subpath',
      use: { baseURL: 'http://localhost:5198/weddingapp/', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    {
      command:
        'npx tsx scripts/build-vault.ts data/published.sample.json .e2e/vault FOREVER && VAULT_DIR=.e2e/vault npx vite --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command:
        'BASE_PATH=/weddingapp/ npx vite build --outDir .e2e/dist-pages --emptyOutDir && npx tsx scripts/build-vault.ts data/published.sample.json .e2e/dist-pages/vault FOREVER && BASE_PATH=/weddingapp/ npx vite preview --outDir .e2e/dist-pages --port 5198 --strictPort',
      url: 'http://localhost:5198/weddingapp/',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

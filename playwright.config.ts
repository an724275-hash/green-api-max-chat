import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5178",
    headless: true,
    viewport: { width: 1280, height: 850 },
    launchOptions: {
      ...(process.env.CHROMIUM_PATH && {
        executablePath: process.env.CHROMIUM_PATH,
      }),
    },
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5178 --strictPort",
    url: "http://127.0.0.1:5178",
    reuseExistingServer: false,
  },
});

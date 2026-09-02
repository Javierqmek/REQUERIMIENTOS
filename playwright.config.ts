import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/visual", testMatch: "*.spec.ts",
  fullyParallel: false, workers: 1,
  outputDir: ".qa/playwright",
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3099", channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, screenshot: "only-on-failure" },
  webServer: { command: "npx tsx tests/visual/server.ts", url: "http://127.0.0.1:3099", reuseExistingServer: false, timeout: 60000 },
});

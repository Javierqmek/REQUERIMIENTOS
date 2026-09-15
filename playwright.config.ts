import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/visual", testMatch: "*.spec.ts",
  fullyParallel: false, workers: 1,
  outputDir: ".qa/playwright",
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3099", headless: true, screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium", channel: process.env.PLAYWRIGHT_CHANNEL || undefined, extraHTTPHeaders: { "x-qa-project": "chromium" } } },
    { name: "firefox", use: { browserName: "firefox", extraHTTPHeaders: { "x-qa-project": "firefox" } } },
    { name: "webkit", use: { browserName: "webkit", extraHTTPHeaders: { "x-qa-project": "webkit" } } },
  ],
  webServer: { command: "npx tsx tests/visual/server.ts", url: "http://127.0.0.1:3099", reuseExistingServer: false, timeout: 60000 },
});
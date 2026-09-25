import { defineConfig } from "@playwright/test";
// Corre contra el build de producción REAL (next build && next start): headers reales (CSP,
// nonce, nonce), middleware real -- a diferencia de tests/visual, que usa un servidor de pruebas
// aislado sin Next.js ni cabeceras reales. Ver tests/production/youtube-player.spec.ts.
export default defineConfig({
  testDir: "./tests/production", testMatch: "*.spec.ts",
  fullyParallel: false, workers: 1,
  outputDir: ".qa/playwright-production",
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3100", headless: true },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    timeout: 180000,
  },
});

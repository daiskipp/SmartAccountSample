import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "https://localhost:5173",
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    port: 5173,
    reuseExistingServer: true,
  },
});

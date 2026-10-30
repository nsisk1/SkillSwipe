import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  outputDir: "../../../../generated-artifacts/account-tests",
  reporter: "line",
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  webServer: process.env.CI ? {
    command: "pnpm exec tsx tests/accounts/serve-ci.ts",
    url: "https://localhost:4173",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 30_000,
  } : undefined,
  use: {
    viewport: { width: 402, height: 874 },
    launchOptions: {
      // Nix development environments may supply a system-wrapped Chromium.
      // CI leaves this unset and uses Playwright's matching installed browser.
      executablePath: process.env.ACCOUNTS_TEST_CHROMIUM_EXECUTABLE || undefined,
    },
    // Raw traces are managed explicitly and scrubbed before CI upload.
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});

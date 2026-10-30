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
  use: {
    viewport: { width: 402, height: 874 },
    // Auth tickets, session cookies, and deck content must not enter artifacts.
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});

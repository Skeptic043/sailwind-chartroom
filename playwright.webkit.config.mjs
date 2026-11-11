import { defineConfig } from "@playwright/test";

// The same browser tests in WebKit, the engine family the macOS app's web view uses.
export default defineConfig({
  testDir: "tests/browser",
  testMatch: "*.spec.mjs",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    browserName: "webkit",
    viewport: { width: 1440, height: 900 }
  }
});

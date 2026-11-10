import { defineConfig } from "@playwright/test";

// Uses the installed Microsoft Edge, the same engine as the WebView2 runtime the app embeds.
export default defineConfig({
  testDir: "tests/browser",
  testMatch: "*.spec.mjs",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    channel: "msedge",
    viewport: { width: 1440, height: 900 }
  }
});

import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const types = { ".html": "text/html", ".css": "text/css", ".mjs": "text/javascript", ".txt": "text/plain", ".png": "image/png", ".jpg": "image/jpeg" };
// The same served names and headers as desktop/MainForm.cs, so the page runs under the shipped CSP.
const served = { "/LICENSE.txt": "LICENSE", "/THIRD-PARTY-NOTICES.txt": "THIRD-PARTY-NOTICES.md" };
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

// Stands in for the WebView2 host: answers "ready" with the latest saved workspace and records saves.
// The workspace survives reloads in sessionStorage, as the real host keeps it in memory. Update checks
// answer with the given releases; an install reports progress and then the given failure.
function fakeHost({ seed, updates }) {
  const key = "fake-host-workspace";
  if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, JSON.stringify(seed ?? null));
  const listeners = new Set();
  const dispatch = (data) => setTimeout(() => listeners.forEach((listener) => listener({ data })));
  // settingsReply, when a test sets it, is what the native Settings window sends back on OK.
  const host = { messages: [], saves: 0, zooms: [], settingsOpened: null, settingsReply: null };
  Object.defineProperty(host, "workspace", { get: () => JSON.parse(sessionStorage.getItem(key)) });
  window.__host = host;
  window.chrome = {
    webview: {
      postMessage(message) {
        const data = JSON.parse(JSON.stringify(message));
        host.messages.push(data.type);
        if (data.type === "ready") dispatch({ type: "init", workspace: host.workspace, dataFolder: "D:/Charts", version: "9.9.9" });
        if (data.type === "save") {
          sessionStorage.setItem(key, JSON.stringify(data.workspace));
          host.saves += 1;
          dispatch({ type: "saved", ok: true });
        }
        if (data.type === "pin") dispatch({ type: "pinned", value: true });
        if (data.type === "set-zoom") host.zooms.push(data.factor);
        if (data.type === "set-appearance") host.appearance = data.dark ? "dark" : "light";
        if (data.type === "open-settings") {
          host.settingsOpened = data;
          if (host.settingsReply) dispatch({ type: "settings-changed", settings: host.settingsReply });
        }
        if (data.type === "check-updates") dispatch({ type: "updates", ok: true, current: "9.9.9", newer: [], all: [], ...updates });
        if (data.type === "install-update") {
          dispatch({ type: "update-progress", status: "Downloading… 40%", fraction: 0.4, cancelable: true });
          setTimeout(() => dispatch({ type: "update-failed", message: "The download failed." }), 50);
        }
      },
      addEventListener: (type, listener) => listeners.add(listener),
      removeEventListener: (type, listener) => listeners.delete(listener)
    }
  };
}

export const test = base.extend({
  chartroom: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("https://chartroom.app/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const file = served[path] ?? path.slice(1);
      try {
        const body = await readFile(new URL(file, root));
        const extension = path.slice(path.lastIndexOf("."));
        await route.fulfill({ body, headers: { "content-type": types[extension] ?? "application/octet-stream", "content-security-policy": csp } });
      } catch {
        await route.fulfill({ status: 404, body: "" });
      }
    });
    const chartroom = new Chartroom(page);
    await use(chartroom);
    expect(errors, "page errors").toEqual([]);
  }
});

export { expect };

export class Chartroom {
  constructor(page) {
    this.page = page;
    this.canvas = page.locator("#chart-canvas");
  }

  async open(workspace = null, { updates } = {}) {
    await this.page.addInitScript(fakeHost, { seed: workspace, updates });
    await this.page.goto("https://chartroom.app/index.html");
    await expect(this.page.locator("#app-version")).toHaveText("9.9.9");
  }

  // Waits for the debounced save to reach the host, then returns what it holds.
  async saved() {
    await expect(this.page.locator("#save-status")).toContainText("Saved");
    return this.page.evaluate(() => window.__host.workspace);
  }

  async chart() {
    const workspace = await this.saved();
    return workspace.charts.find((chart) => chart.id === workspace.activeChartId);
  }

  async clickChart(x, y, options) {
    const box = await this.canvas.boundingBox();
    await this.page.mouse.click(box.x + x, box.y + y, options);
  }

  async dragChart(from, to, { modifiers = [] } = {}) {
    const box = await this.canvas.boundingBox();
    for (const key of modifiers) await this.page.keyboard.down(key);
    await this.page.mouse.move(box.x + from.x, box.y + from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(box.x + (from.x + to.x) / 2, box.y + (from.y + to.y) / 2, { steps: 4 });
    await this.page.mouse.move(box.x + to.x, box.y + to.y, { steps: 4 });
    await this.page.mouse.up();
    for (const key of modifiers) await this.page.keyboard.up(key);
  }

  messages() {
    return this.page.evaluate(() => window.__host.messages);
  }

  async press(key) {
    await this.page.evaluate(() => document.activeElement?.blur());
    await this.page.keyboard.press(key);
  }

  items() {
    return this.page.locator("#feature-list .feature-row");
  }
}

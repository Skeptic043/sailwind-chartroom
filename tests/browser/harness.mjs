import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve, sep } from "node:path";

const root = process.env.SAILWIND_PAIR_WEB_DIR
  ? pathToFileURL(resolve(process.env.SAILWIND_PAIR_WEB_DIR) + sep)
  : new URL("../../", import.meta.url);
const types = { ".html": "text/html", ".css": "text/css", ".mjs": "text/javascript", ".txt": "text/plain", ".png": "image/png", ".jpg": "image/jpeg" };
// The same served names and headers as desktop/MainForm.cs, so the page runs under the shipped CSP.
const served = { "/LICENSE.txt": "LICENSE", "/THIRD-PARTY-NOTICES.txt": "THIRD-PARTY-NOTICES.md" };
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://skeptic043.github.io; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

// Stands in for the WebView2 host: answers "ready" with the latest saved workspace and records saves.
// The workspace survives reloads in sessionStorage, as the real host keeps it in memory. Update checks
// answer with the given releases; an install reports progress and then the given failure.
function fakeHost({ seed, updates, platform, recording, devices, exportWithLink, importChoices }) {
  const key = "fake-host-workspace";
  if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, JSON.stringify(seed ?? null));
  const listeners = new Set();
  const dispatch = (data) => setTimeout(() => listeners.forEach((listener) => listener({ data })));
  // settingsReply, when a test sets it, is what the native Settings window sends back on OK.
  const host = { messages: [], saves: 0, zooms: [], exports: [], settingsOpened: null, settingsReply: null, sync: [] };
  // Lets a test speak for the host, as when a device joins or sends its changes.
  host.emit = dispatch;
  Object.defineProperty(host, "workspace", { get: () => JSON.parse(sessionStorage.getItem(key)) });
  window.__host = host;
  window.chrome = {
    webview: {
      postMessage(message) {
        const data = JSON.parse(JSON.stringify(message));
        host.messages.push(data.type);
        if (data.type === "ready") dispatch({ type: "init", workspace: host.workspace, dataFolder: "D:/Charts", version: "9.9.9", platform, liveTrack: true, devices, exportWithLink, importFilePicker: Boolean(importChoices) });
        host.imports = host.imports ?? [];
        if (data.type === "pick-import-file") {
          host.imports.push({ file: data.file, pick: data.pick });
          if (importChoices && data.file === undefined && !data.pick) dispatch({ type: "import-choices", files: importChoices });
        }
        if (data.type === "save") {
          sessionStorage.setItem(key, JSON.stringify(data.workspace));
          host.saves += 1;
          dispatch({ type: "saved", ok: true });
        }
        if (data.type === "export-file") host.exports.push(data);
        if (data.type === "sync-send" || data.type === "sync-broadcast") host.sync.push(data);
        if (data.type === "pin") dispatch({ type: "pinned", value: true });
        // Following answers with the newest position, then more as if the game had written them. The
        // default recording is Coordinate Viewer's; a test can give a file name and runs of lines instead.
        // A recording with choices is offered as Voyage Recorder logs first, and followed once one is picked.
        host.follows = host.follows ?? [];
        if (data.type === "follow-track") host.follows.push({ log: data.log, pick: data.pick });
        if (data.type === "follow-track" && recording?.choices && data.log === undefined && !data.pick) {
          dispatch({ type: "track-choices", chartId: data.chartId, logs: recording.choices });
        } else if (data.type === "follow-track") {
          const { name, runs } = recording ?? { name: "coords_0.txt", runs: ["Day: 3\n40.1 0.5 9.5 90\n", "Day: 3\n40.2 0.6 10 92\n"] };
          dispatch({ type: "track-following", name, chartId: data.chartId, resumed: false });
          runs.forEach((text, index) => setTimeout(() => dispatch({ type: "track-lines", text }), index * 50));
        }
        if (data.type === "stop-track") dispatch({ type: "track-stopped" });
        if (data.type === "copy-text") host.copied = data.text;
        if (data.type === "open-link") (host.links ??= []).push(data.url);
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

// Stands in for Chartroom on the PC as a phone sees it: the page's WebSocket to the PC. A test reads what the
// page sent from window.__pc.sent and answers with __pc.deliver; __pc.drop loses the connection.
function fakePc() {
  const pc = { sockets: [], sent: [] };
  window.__pc = pc;
  window.WebSocket = class {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      pc.sockets.push(this);
      pc.socket = this;
      setTimeout(() => this.fire("open", {}));
    }
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
    fire(type, event) { for (const listener of this.listeners[type] ?? []) listener(event); }
    send(text) { pc.sent.push(JSON.parse(text)); }
    close() { setTimeout(() => this.fire("close", {})); }
  };
  pc.deliver = (message) => pc.socket.fire("message", { data: JSON.stringify(message) });
  pc.drop = () => pc.socket.fire("close", {});
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

  // The page as Chartroom on the PC serves it to a phone or tablet on the same network.
  async openDevice(hash = "") {
    await this.page.route("http://chartroom-pc:47821/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const file = path === "/" ? "index.html" : served[path] ?? path.slice(1);
      try {
        let body = await readFile(new URL(file, root));
        if (file === "index.html") body = body.toString("utf8").replace("<head>", '<head><meta name="chartroom-device" content="1">');
        const extension = file.slice(file.lastIndexOf("."));
        await route.fulfill({ body, headers: { "content-type": types[extension] ?? "application/octet-stream", "content-security-policy": csp.replace("connect-src 'self'", "connect-src 'self' ws:") } });
      } catch {
        await route.fulfill({ status: 404, body: "" });
      }
    });
    await this.page.addInitScript(fakePc);
    await this.page.goto(`http://chartroom-pc:47821/${hash}`);
  }

  // platform "mac" makes the stand-in answer as the macOS host does.
  // devices makes the stand-in a host that phones and tablets can connect to.
  async open(workspace = null, { updates, platform, recording, devices, exportWithLink, importChoices } = {}) {
    await this.page.addInitScript(fakeHost, { seed: workspace, updates, platform, recording, devices, exportWithLink, importChoices });
    await this.page.goto("https://chartroom.app/index.html");
    await expect(this.page.locator("#app-version")).toHaveText("9.9.9");
  }

  // Waits for the debounced save to reach the host, then returns what it holds.
  async saved() {
    await expect(this.page.locator("#save-status")).toHaveAttribute("title", "Saved");
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

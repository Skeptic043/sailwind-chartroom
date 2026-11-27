// The page's only connection to where charts are stored. In the desktop apps that is the native host,
// which writes workspace.json in the player's data folder; opened in a plain browser it is localStorage.

import { isSiteLink } from "./site.mjs";

const STORAGE_KEY = "sailwind-chartroom:v1";
// The macOS app serves the page under this scheme, so a page loaded from it must reach its host.
const MAC_APP_SCHEME = "chartroom:";
const HANDSHAKE_TIMEOUT_MS = 15000;

export async function connectHost() {
  const transport = nativeTransport();
  if (transport) return connectDesktop(transport);
  // Served by Chartroom on the player's PC to a phone or tablet on the same network.
  if (document.querySelector('meta[name="chartroom-device"]')) return connectDevice();
  if (globalThis.location?.protocol === MAC_APP_SCHEME) {
    throw fatal("Sailwind Chartroom could not reach its app window, so nothing can be saved. Quit and open Chartroom again.");
  }
  return connectBrowser();
}

// How the page and its host exchange messages: WebView2 on Windows, WKWebView on macOS.
function nativeTransport() {
  const webview = globalThis.chrome?.webview;
  if (webview) {
    return {
      post: (message) => webview.postMessage(message),
      listen: (callback) => webview.addEventListener("message", (event) => callback(event.data))
    };
  }
  const handler = globalThis.webkit?.messageHandlers?.chartroom;
  if (handler) {
    const callbacks = [];
    // The macOS host calls this with each message.
    globalThis.chartroomReceive = (message) => { for (const callback of callbacks) callback(message); };
    return {
      post: (message) => handler.postMessage(JSON.stringify(message)),
      listen: (callback) => callbacks.push(callback)
    };
  }
  return null;
}

// Replaces the page with the message; the app is unusable without its host.
function fatal(message) {
  const notice = document.createElement("p");
  notice.textContent = message;
  notice.style.cssText = "margin: 20vh auto; max-width: 32em; padding: 0 24px; font: 16px/1.5 system-ui, sans-serif; text-align: center;";
  document.body.replaceChildren(notice);
  return new Error(message);
}

function createListeners() {
  const listeners = new Map();
  return {
    on(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    emit(type, data) {
      for (const callback of listeners.get(type) ?? []) callback(data);
    }
  };
}

// The host answers "ready" with the latest charts on every page load, including a reload.
async function connectDesktop({ post, listen }) {
  const events = createListeners();
  const init = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(fatal("Sailwind Chartroom's app window did not answer, so nothing can be saved. Quit and open Chartroom again.")), HANDSHAKE_TIMEOUT_MS);
    let started = false;
    listen((message) => {
      if (typeof message?.type !== "string") return;
      if (started) events.emit(message.type, message);
      else if (message.type === "init") {
        started = true;
        clearTimeout(timeout);
        resolve(message);
      }
    });
    post({ type: "ready" });
  });
  return {
    desktop: true,
    // "mac" in the macOS app. The Windows host sends nothing.
    platform: String(init.platform ?? "windows"),
    workspace: init.workspace ?? null,
    dataFolder: String(init.dataFolder ?? ""),
    version: String(init.version ?? ""),
    textScale: Number(init.textScale) || 100,
    // Both desktop hosts can follow a Voyage Recorder or Coordinate Viewer file as the game writes it.
    liveTrack: init.liveTrack === true,
    // Hosts that open a submission link and reveal the file after SaveFileDialog succeeds, then reply "export-result".
    exportWithLink: init.exportWithLink === true,
    // Hosts that open a native file picker defaulted to the Scrambled Seas folder for chart/map imports.
    importFilePicker: init.importFilePicker === true,
    on: events.on,
    // The host shows the Settings window and answers OK or Apply with "settings-changed".
    openSettings: (settings, defaults) => post({ type: "open-settings", settings, defaults }),
    setZoom: (factor) => post({ type: "set-zoom", factor }),
    // Lets the host match its windows to the page. followsSystem is true while the page tracks the system setting.
    setAppearance: (dark, followsSystem) => post({ type: "set-appearance", dark, followsSystem }),
    // The host writes the file shortly after the last change and replies with "saved".
    save: (workspace) => post({ type: "save", workspace }),
    // The host asks where to save and writes the file.
    exportFile: (name, contents, _type, options = {}) => post({
      type: "export-file",
      name,
      contents,
      ...(options?.id && { id: options.id }),
      ...(options?.openUrl && { openUrl: options.openUrl }),
      ...(options?.reveal && { reveal: true })
    }),
    pickImportFile: (choice = {}) => post({ type: "pick-import-file", ...choice }),
    // Without a choice the host offers the Voyage Recorder logs it finds with "track-choices", or asks for a
    // file when it finds none. The page answers with { log } for an offered log or { pick: true } for a file.
    // Following then sends "track-following", "track-lines" with each new run of lines, and "track-stopped".
    followTrack: (chartId, choice = {}) => post({ type: "follow-track", chartId, ...choice }),
    stopTrack: () => post({ type: "stop-track" }),
    togglePin: () => post({ type: "pin" }),
    openFolder: () => post({ type: "open-folder" }),
    copyText: (text) => post({ type: "copy-text", text }),
    // Windows answers with "updates", then "update-progress" and "update-failed" while installing.
    // macOS shows its own update windows; background checks stay silent unless an update is found.
    checkUpdates: (background = false) => post({ type: "check-updates", background }),
    installUpdate: () => post({ type: "install-update" }),
    cancelUpdate: () => post({ type: "cancel-update" }),
    openReleases: () => post({ type: "open-releases" }),
    // Opens a Chartroom Voyages page or form in the player's browser. The host opens only that site's links.
    openLink: (url) => post({ type: "open-link", url }),
    // Phones and tablets on the player's network (hub.mjs). The host reports "device-joined", "device-left"
    // and each "device-message", again for every connected device after a reload, and relays these.
    devices: init.devices === true,
    syncSend: (deviceId, message) => post({ type: "sync-send", deviceId, message }),
    syncBroadcast: (ops) => post({ type: "sync-broadcast", ops }),
    // The Mobile device link dialog (devices.mjs). The host answers each with "devices-state", and sends it
    // again whenever a device connects or leaves.
    devicesOpen: () => post({ type: "devices-open" }),
    devicesEnable: (enabled) => post({ type: "devices-enable", enabled }),
    devicesPair: (address = "") => post({ type: "devices-pair", address }),
    devicesPairStop: () => post({ type: "devices-pair-stop" }),
    devicesRename: (id, name) => post({ type: "devices-rename", id, name }),
    devicesRemove: (id) => post({ type: "devices-remove", id })
  };
}

function connectBrowser() {
  const events = createListeners();
  let workspace = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    workspace = raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Could not restore Chartroom data", error);
  }
  return {
    desktop: false,
    platform: "browser",
    workspace,
    dataFolder: "",
    version: "",
    textScale: 100,
    liveTrack: false,
    on: events.on,
    openSettings() {},
    setZoom() {},
    setAppearance() {},
    save(value) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        setTimeout(() => events.emit("saved", { ok: true }), 180);
      } catch {
        setTimeout(() => events.emit("saved", { ok: false, error: "Browser storage is unavailable. Export your chart to keep it." }), 0);
      }
    },
    // A plain browser downloads the file.
    exportFile(name, contents, type) {
      const url = URL.createObjectURL(new Blob([contents], { type }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    togglePin() {},
    openFolder() {},
    openLink(url) {
      if (isSiteLink(url)) window.open(url, "_blank", "noopener");
    },
    copyText: (text) => navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error("No clipboard"))
  };
}

// A phone or tablet: the page came from Chartroom on the player's PC, and stays connected to it over a
// WebSocket. The first connection pairs with the code the PC shows (in the link a scanned code opens, or typed
// in); later ones use the token from pairing. The charts come from the PC, and this device's own settings,
// panels and views stay here (remote.mjs keeps the charts in step). A copy of the last charts lets the page
// open while the PC can't be reached.
const DEVICE_KEY = "sailwind-chartroom:device";
const DEVICE_PREFS_KEY = "sailwind-chartroom:device-prefs";
const DEVICE_COPY_KEY = "sailwind-chartroom:device-charts";
const RECONNECT_MS = 3000;

function readStored(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function deviceName() {
  const agent = navigator.userAgent;
  if (/iPad/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone/.test(agent)) return "iPhone";
  if (/Android/.test(agent)) return /Mobile/.test(agent) ? "Android phone" : "Android tablet";
  return "Browser";
}

// The device's own preferences laid over charts from the PC: settings, panels, the open chart, and each
// chart's view and layers. Without any yet, as on first connecting, the PC's are kept, except that the
// track key starts hidden: on a small screen it covers the chart.
export function withDevicePrefs(workspace, prefs) {
  if (!prefs) return { ...workspace, settings: { ...workspace.settings, trackKey: false } };
  const charts = prefs.charts ?? {};
  return {
    ...workspace,
    settings: prefs.settings ?? workspace.settings,
    layout: prefs.layout ?? workspace.layout,
    activeChartId: workspace.charts.some((chart) => chart.id === prefs.activeChartId) ? prefs.activeChartId : workspace.activeChartId,
    charts: workspace.charts.map((chart) => charts[chart.id] ? { ...chart, ...charts[chart.id] } : chart)
  };
}

export function devicePrefs() {
  return readStored(DEVICE_PREFS_KEY);
}

function prefsOf(workspace) {
  return {
    settings: workspace.settings,
    layout: workspace.layout,
    activeChartId: workspace.activeChartId,
    charts: Object.fromEntries(workspace.charts.map((chart) => [chart.id, { view: chart.view, layers: chart.layers }]))
  };
}

// Asks for the code shown on the PC, over the page, until the device is paired.
function askForCode(problem = "") {
  return new Promise((resolve) => {
    document.getElementById("device-pairing")?.remove();
    const form = document.createElement("form");
    form.id = "device-pairing";
    form.className = "device-pairing";
    const card = document.createElement("div");
    card.className = "dialog-card";
    const heading = Object.assign(document.createElement("h2"), { textContent: "Connect to Chartroom" });
    const steps = Object.assign(document.createElement("p"), { textContent: "On your PC, open Chartroom and choose File > Mobile device link. Turn on Allow mobile devices on this network, choose Connect a device, then enter the code it shows here." });
    const trouble = Object.assign(document.createElement("p"), { className: "device-pairing-problem", textContent: problem });
    const label = Object.assign(document.createElement("label"), { textContent: "Code " });
    const input = Object.assign(document.createElement("input"), { name: "code", inputMode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]{6}", maxLength: 6, required: true });
    label.append(input);
    const actions = Object.assign(document.createElement("div"), { className: "dialog-actions" });
    actions.append(Object.assign(document.createElement("button"), { className: "primary", type: "submit", textContent: "Connect" }));
    card.append(Object.assign(document.createElement("div"), { className: "eyebrow", textContent: "Mobile device link" }), heading, steps, trouble, label, actions);
    form.append(card);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      form.remove();
      resolve(input.value.trim());
    });
    document.body.append(form);
    input.focus();
  });
}

// Covers the empty page while a device without a copy of the charts waits for the PC's.
async function waitFor(charts) {
  const notice = Object.assign(document.createElement("div"), { className: "device-pairing" });
  const card = Object.assign(document.createElement("div"), { className: "dialog-card" });
  card.append(
    Object.assign(document.createElement("h2"), { textContent: "Connecting to Chartroom on your PC…" }),
    Object.assign(document.createElement("p"), { textContent: "Chartroom needs to be open on your PC, with Allow mobile devices on this network turned on, and this device on the same Wi-Fi." })
  );
  notice.append(card);
  document.body.append(notice);
  try { return await charts; } finally { notice.remove(); }
}

async function connectDevice() {
  const events = createListeners();
  let socket = null;
  let connected = false;
  // Pairing asks the player again rather than retrying on its own.
  let asking = false;
  let pairCode = /^#pair=(\d{6})$/.exec(location.hash)?.[1] ?? null;
  if (pairCode) history.replaceState(null, "", location.pathname);
  let paired = readStored(DEVICE_KEY);
  if (!paired?.token && !pairCode) pairCode = await askForCode();
  const copy = readStored(DEVICE_COPY_KEY);
  let first = null;
  const firstCharts = new Promise((resolve) => { first = resolve; });

  const send = (message) => {
    if (connected) socket.send(JSON.stringify(message));
  };
  function open() {
    socket = new WebSocket(`ws://${location.host}/`);
    // Pairing again names the token it replaces, so the PC keeps one entry for this device.
    socket.addEventListener("open", () => socket.send(JSON.stringify(pairCode
      ? { type: "pair", code: pairCode, name: deviceName(), ...(paired?.token && { previous: paired.token }) }
      : { type: "hello", token: paired?.token ?? "" })));
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.type === "welcome") {
        if (message.token) {
          paired = { token: message.token, deviceId: message.deviceId, name: message.name };
          store(DEVICE_KEY, paired);
        }
        pairCode = null;
        connected = true;
        events.emit("connection", { connected: true });
      } else if (message?.type === "denied") {
        // An old code scanned on a device that is already paired: it keeps its pairing.
        if (pairCode && paired?.token) {
          pairCode = null;
          return;
        }
        // A wrong or expired code, or this device was removed on the PC: pair again.
        const problem = pairCode
          ? "That code didn't work. A code works once, for 5 minutes. Show a new one on your PC and try again."
          : "Chartroom on your PC no longer knows this device, or no longer allows mobile devices. Connect it again.";
        store(DEVICE_KEY, null);
        paired = null;
        asking = true;
        askForCode(problem).then((code) => {
          asking = false;
          pairCode = code;
          open();
        });
      } else if (message?.type === "workspace" && first) {
        first(message);
        first = null;
      } else if (typeof message?.type === "string") {
        events.emit(message.type, message);
      }
    });
    socket.addEventListener("close", () => {
      const was = connected;
      connected = false;
      if (was) events.emit("connection", { connected: false });
      if (!asking) setTimeout(open, RECONNECT_MS);
    });
  }
  open();

  // Opens on the PC's charts, or at once on the last copy kept here when there is one.
  const start = copy ? { workspace: copy, version: "" } : await waitFor(firstCharts);
  if (copy) firstCharts.then((message) => events.emit("workspace", message));
  return {
    desktop: false,
    device: true,
    platform: "device",
    workspace: withDevicePrefs(start.workspace, devicePrefs()),
    dataFolder: "",
    version: String(start.version ?? ""),
    textScale: 100,
    liveTrack: true,
    get connected() { return connected; },
    on: events.on,
    send,
    openSettings() {},
    setZoom() {},
    setAppearance() {},
    // Keeps this device's own preferences, and a copy of the charts to open with while the PC is away.
    // The changes themselves reach the PC through remote.mjs.
    save(workspace) {
      store(DEVICE_PREFS_KEY, prefsOf(workspace));
      // A copy too large for the store is dropped rather than left stale.
      if (!store(DEVICE_COPY_KEY, workspace)) store(DEVICE_COPY_KEY, null);
      setTimeout(() => events.emit("saved", { ok: true }), 0);
    },
    exportFile(name, contents, type) {
      const url = URL.createObjectURL(new Blob([contents], { type }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    // Following runs on the PC; a device can start it on one of Voyage Recorder's logs, or stop it.
    followTrack(chartId, choice = {}) {
      if (!choice.pick) send({ type: "follow-track", chartId, ...(Number.isInteger(choice.log) && { log: choice.log }) });
    },
    stopTrack: () => send({ type: "stop-track" }),
    togglePin() {},
    openFolder() {},
    openLink(url) {
      if (isSiteLink(url)) window.open(url, "_blank", "noopener");
    },
    // The clipboard API needs a secure page, which a page from the PC isn't.
    copyText(text) {
      const area = Object.assign(document.createElement("textarea"), { value: text });
      document.body.append(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return copied ? Promise.resolve() : Promise.reject(new Error("No clipboard"));
    }
  };
}

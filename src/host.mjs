// The page's only connection to where charts are stored. In the desktop apps that is the native host,
// which writes workspace.json in the player's data folder; opened in a plain browser it is localStorage.

const STORAGE_KEY = "sailwind-chartroom:v1";
// The macOS app serves the page under this scheme, so a page loaded from it must reach its host.
const MAC_APP_SCHEME = "chartroom:";
const HANDSHAKE_TIMEOUT_MS = 15000;

export async function connectHost() {
  const transport = nativeTransport();
  if (transport) return connectDesktop(transport);
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
    // The Windows host can follow a Coordinate Viewer file as the game writes it.
    liveTrack: init.liveTrack === true,
    on: events.on,
    // The host shows the Settings window and answers OK or Apply with "settings-changed".
    openSettings: (settings, defaults) => post({ type: "open-settings", settings, defaults }),
    setZoom: (factor) => post({ type: "set-zoom", factor }),
    // Lets the host match its windows to the page. followsSystem is true while the page tracks the system setting.
    setAppearance: (dark, followsSystem) => post({ type: "set-appearance", dark, followsSystem }),
    // The host writes the file shortly after the last change and replies with "saved".
    save: (workspace) => post({ type: "save", workspace }),
    // The host asks where to save and writes the file.
    exportFile: (name, contents) => post({ type: "export-file", name, contents }),
    // The host asks which file, then sends "track-following", "track-lines" with each new run of lines, and "track-stopped".
    followTrack: (chartId) => post({ type: "follow-track", chartId }),
    stopTrack: () => post({ type: "stop-track" }),
    togglePin: () => post({ type: "pin" }),
    openFolder: () => post({ type: "open-folder" }),
    copyText: (text) => post({ type: "copy-text", text }),
    // Windows answers with "updates", then "update-progress" and "update-failed" while installing.
    // macOS shows its own update windows; background checks stay silent unless an update is found.
    checkUpdates: (background = false) => post({ type: "check-updates", background }),
    installUpdate: () => post({ type: "install-update" }),
    cancelUpdate: () => post({ type: "cancel-update" }),
    openReleases: () => post({ type: "open-releases" })
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
    copyText: (text) => navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error("No clipboard"))
  };
}

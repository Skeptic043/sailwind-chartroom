// The page's only connection to where charts are stored. In the desktop app that is the WebView2 host,
// which writes %APPDATA%\Sailwind Chartroom\workspace.json; opened in a plain browser it is localStorage.

const STORAGE_KEY = "sailwind-chartroom:v1";

export async function connectHost() {
  const webview = globalThis.chrome?.webview;
  return webview ? connectDesktop(webview) : connectBrowser();
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
async function connectDesktop(webview) {
  const init = await new Promise((resolve) => {
    const receive = (event) => {
      if (event.data?.type !== "init") return;
      webview.removeEventListener("message", receive);
      resolve(event.data);
    };
    webview.addEventListener("message", receive);
    webview.postMessage({ type: "ready" });
  });
  const events = createListeners();
  webview.addEventListener("message", (event) => {
    if (typeof event.data?.type === "string") events.emit(event.data.type, event.data);
  });
  return {
    desktop: true,
    workspace: init.workspace ?? null,
    dataFolder: String(init.dataFolder ?? ""),
    version: String(init.version ?? ""),
    textScale: Number(init.textScale) || 100,
    on: events.on,
    // The host shows the Settings window and answers OK or Apply with "settings-changed".
    openSettings: (settings, defaults) => webview.postMessage({ type: "open-settings", settings, defaults }),
    setZoom: (factor) => webview.postMessage({ type: "set-zoom", factor }),
    // Lets the host match its title bars to the page.
    setAppearance: (dark) => webview.postMessage({ type: "set-appearance", dark }),
    // The host writes the file shortly after the last change and replies with "saved".
    save: (workspace) => webview.postMessage({ type: "save", workspace }),
    togglePin: () => webview.postMessage({ type: "pin" }),
    openFolder: () => webview.postMessage({ type: "open-folder" }),
    // The host answers with "updates", then "update-progress" and "update-failed" while installing.
    checkUpdates: () => webview.postMessage({ type: "check-updates" }),
    installUpdate: () => webview.postMessage({ type: "install-update" }),
    cancelUpdate: () => webview.postMessage({ type: "cancel-update" }),
    openReleases: () => webview.postMessage({ type: "open-releases" })
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
    workspace,
    dataFolder: "",
    version: "",
    textScale: 100,
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
    togglePin() {},
    openFolder() {}
  };
}

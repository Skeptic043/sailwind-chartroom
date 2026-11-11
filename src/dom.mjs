// The page's fixed elements, looked up once, and the shared toast.

export const elements = Object.fromEntries([
  "chart-canvas", "chart-select", "new-chart", "save-chart", "chart-settings", "save-status", "undo", "redo", "toggle-left-panel", "toggle-right-panel", "left-panel-resizer", "right-panel-resizer", "help", "about", "open-settings", "check-updates", "release-notes", "zoom-in", "zoom-out", "zoom-reset", "update-bar", "update-bar-text", "update-bar-open", "update-bar-install", "update-bar-dismiss", "update-dialog", "update-dialog-title", "update-dialog-summary", "update-notes", "update-dialog-close", "update-install", "update-progress-dialog", "update-progress-title", "update-progress-status", "update-progress-bar", "update-progress-cancel", "about-dialog", "about-version", "about-license", "about-notices", "fit-chart", "app-version",
  "mode-hint",
  "layer-grid", "layer-labels", "layer-track", "layer-distances", "layer-bearings", "layer-winds", "layer-boats", "choose-search-island", "search-island-status", "layer-vanilla", "layer-secrets", "layer-trade-winds",
  "import-track", "paste-track", "import-json", "export-json", "export-csv", "export-all", "clear-track", "clear-bearings",
  "cursor-coordinates", "zoom-label", "hover-info", "route-summary", "route-summary-title", "route-actions", "route-distance", "route-bearing", "route-speed", "route-eta", "save-route", "clear-route", "toast",
  "empty-inspector", "feature-inspector", "feature-kind", "feature-title", "feature-form", "feature-type", "feature-name", "feature-lat", "feature-lon", "feature-day", "feature-time", "feature-range-row", "feature-range", "feature-notes", "delete-feature",
  "feature-show-name", "feature-selection-note", "feature-island-status", "choose-feature-island", "feature-boat-status", "choose-feature-boat", "feature-navigation", "resolve-feature",
  "route-inspector", "route-form", "route-point-kind", "route-name", "route-lat", "route-lon", "route-notes", "route-leg-detail", "delete-route-point", "select-saved-route",
  "saved-route-inspector", "saved-route-form", "saved-route-name", "saved-route-visible", "saved-route-detail", "delete-saved-route",
  "bearing-inspector", "bearing-form", "bearing-label", "bearing-lat", "bearing-lon", "bearing-value", "bearing-fixes", "delete-bearing",
  "search-inspector", "search-form", "search-label", "search-lat", "search-lon", "search-direction", "search-distance", "search-spread", "search-tolerance", "search-summary", "search-mark", "delete-search", "search-boat-status", "choose-search-boat",
  "wind-inspector", "wind-form", "wind-label", "wind-lat", "wind-lon", "wind-direction", "delete-wind",
  "feature-count", "feature-search", "feature-list", "item-filter", "track-file", "json-file",
  "chart-dialog", "chart-form", "chart-dialog-title", "dialog-chart-name", "dialog-chart-seed", "delete-chart", "help-dialog",
  "paste-dialog", "paste-form", "paste-text", "pin-window", "open-folder", "storage-note",
  "island-dialog", "island-dialog-hint", "island-search", "island-region", "island-secrets", "island-list", "remove-island",
  "boat-dialog", "boat-dialog-hint", "boat-search", "boat-provider", "boat-list", "remove-boat"
].map((id) => [id, document.getElementById(id)]));

const inspectorHost = document.getElementById("inspector-host");

for (const id of ["empty-inspector", "feature-inspector", "route-inspector", "saved-route-inspector", "bearing-inspector", "search-inspector", "wind-inspector"]) {
  inspectorHost.append(document.getElementById(id));
}

export const canvas = elements["chart-canvas"];

export const context = canvas.getContext("2d");

let toastTimer = null;

export function showToast(message, error = false) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", error);
  elements.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

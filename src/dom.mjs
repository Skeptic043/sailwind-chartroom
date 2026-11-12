// The page's fixed elements, looked up once, and the shared toast.

export const elements = Object.fromEntries([
  "chart-canvas", "chart-select", "new-chart", "save-chart", "chart-settings", "save-status", "undo", "redo", "lock-selected", "unlock-selected", "toggle-left-panel", "toggle-right-panel", "left-panel-resizer", "right-panel-resizer", "help", "about", "open-settings", "check-updates", "release-notes", "text-menu", "zoom-in", "zoom-out", "zoom-reset", "update-bar", "update-bar-text", "update-bar-open", "update-bar-install", "update-bar-dismiss", "update-dialog", "update-dialog-title", "update-dialog-summary", "update-notes", "update-dialog-close", "update-install", "update-progress-dialog", "update-progress-title", "update-progress-status", "update-progress-bar", "update-progress-cancel", "about-dialog", "about-version", "about-license", "about-notices", "fit-chart", "app-version",
  "mode-hint",
  "layer-locations", "layer-location-islands", "layer-routes", "layer-distances", "layer-saved-routes", "layer-measure", "layer-red-lines", "layer-blue-lines", "layer-green-lines", "layer-areas", "layer-area-islands", "layer-searches", "layer-search-lines", "layer-search-islands", "layer-winds", "layer-grid", "layer-labels", "layer-boats", "layer-islands", "layer-track", "choose-search-island", "search-island-status", "layer-vanilla", "layer-imported-row", "layer-imported-map", "layer-secrets", "layer-trade-winds", "layer-expanded-winds",
  "import-track", "paste-track", "follow-track", "import-json", "export-json", "export-csv", "export-all", "clear-track",
  "cursor-coordinates", "zoom-label", "hover-info", "route-summary", "route-summary-title", "route-actions", "route-distance", "route-bearing", "route-speed", "route-eta", "route-circumnavigation", "save-route", "clear-route", "copy-sailmaster", "toast",
  "empty-inspector", "feature-inspector", "feature-kind", "feature-title", "feature-form", "feature-type", "feature-name", "feature-lat", "feature-lon", "feature-day", "feature-time", "feature-range-row", "feature-range", "feature-notes", "delete-feature",
  "feature-show-name", "feature-selection-note", "feature-island-status", "choose-feature-island", "feature-boat-status", "choose-feature-boat", "feature-navigation", "resolve-feature",
  "route-inspector", "route-form", "route-point-kind", "route-name", "route-lat", "route-lon", "route-day", "route-time", "route-notes", "route-leg-detail", "delete-route-point", "select-saved-route",
  "saved-route-inspector", "saved-route-form", "saved-route-name", "saved-route-visible", "saved-route-detail", "extend-saved-route", "delete-saved-route",
  "measure-inspector", "measure-kind", "measure-detail", "measure-note", "line-form", "line-colour-row", "line-colour", "keep-measure", "delete-measure",
  "search-inspector", "search-form", "search-label", "search-lat", "search-lon", "search-direction", "search-distance", "search-spread", "search-tolerance", "search-summary", "search-mark", "delete-search", "search-boat-status", "choose-search-boat",
  "map-island-inspector", "map-island-name", "map-island-detail", "map-island-form", "map-island-notes", "delete-map-island",
  "track-inspector", "track-form", "track-name", "track-lat", "track-lon", "track-day", "track-time", "track-wind", "delete-track",
  "wind-inspector", "wind-form", "wind-label", "wind-lat", "wind-lon", "wind-direction", "wind-day", "wind-time", "delete-wind",
  "feature-count", "feature-search", "feature-list", "item-filter", "track-file", "json-file",
  "chart-dialog", "chart-form", "chart-dialog-title", "dialog-chart-name", "dialog-chart-seed", "delete-chart", "help-dialog",
  "paste-dialog", "paste-form", "paste-text", "pin-window", "open-folder", "storage-note",
  "island-dialog", "island-dialog-hint", "island-search", "island-region", "island-secrets", "island-list", "remove-island",
  "boat-dialog", "boat-dialog-hint", "boat-search", "boat-provider", "boat-list", "remove-boat"
].map((id) => [id, document.getElementById(id)]));

const inspectorHost = document.getElementById("inspector-host");

for (const id of ["empty-inspector", "feature-inspector", "route-inspector", "saved-route-inspector", "measure-inspector", "search-inspector", "map-island-inspector", "track-inspector", "wind-inspector"]) {
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
  // Long messages stay up long enough to read: about a quarter of a second a word.
  const words = message.trim().split(/\s+/).length;
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), Math.max(3200, words * 260));
}

// The page's fixed elements, looked up once, and the shared toast.

export const elements = Object.fromEntries([
  "chart-canvas", "chart-select", "new-chart", "chart-settings", "save-status", "undo", "redo", "lock-selected", "unlock-selected", "toggle-left-panel", "toggle-right-panel", "show-left-panel", "show-right-panel", "show-key-overlay", "left-panel-resizer", "right-panel-resizer", "help", "about", "open-settings", "check-updates", "release-notes", "text-menu", "zoom-in", "zoom-out", "zoom-reset", "update-bar", "update-bar-text", "update-bar-open", "update-bar-install", "update-bar-dismiss", "update-dialog", "update-dialog-title", "update-dialog-summary", "update-notes", "update-dialog-close", "update-install", "update-progress-dialog", "update-progress-title", "update-progress-status", "update-progress-bar", "update-progress-cancel", "about-dialog", "about-version", "about-license", "about-notices", "fit-chart", "app-version",
  "mode-hint", "search-points-row", "search-points",
  "layer-locations", "layer-location-islands", "layer-routes", "layer-distances", "layer-saved-routes", "layer-measure", "layer-red-lines", "layer-blue-lines", "layer-green-lines", "layer-areas", "layer-area-islands", "layer-searches", "layer-search-lines", "layer-search-islands", "layer-winds", "layer-grid", "layer-labels", "layer-boats", "layer-islands", "layer-track", "layer-track-lines", "layer-track-cv", "layer-track-voyage", "layer-track-voyage-automatic", "layer-track-voyage-manual", "choose-search-island", "search-island-status", "layer-vanilla", "layer-imported-row", "layer-imported-map", "layer-secrets", "layer-trade-winds", "layer-expanded-winds",
  "import-track", "paste-track", "follow-track", "follow-track-cv", "import-json", "export-json", "export-csv", "export-all", "clear-track",
  "cursor-coordinates", "zoom-label", "hover-info", "route-summary", "route-summary-title", "route-actions", "route-distance", "route-speed", "route-eta", "route-circumnavigation", "save-route", "clear-route", "copy-sailmaster", "toast",
  "empty-inspector", "feature-inspector", "feature-kind", "feature-title", "feature-form", "feature-type", "feature-name", "feature-lat", "feature-lon", "feature-day", "feature-time", "feature-range-row", "feature-range", "feature-notes", "delete-feature",
  "feature-icon-row", "feature-icon", "feature-size-row", "feature-size", "note-size", "feature-show-name", "feature-selection-note", "feature-island-status", "choose-feature-island", "feature-boat-status", "choose-feature-boat", "feature-navigation", "resolve-feature",
  "route-inspector", "route-form", "route-point-kind", "route-name", "route-lat", "route-lon", "route-day", "route-time", "route-notes", "route-leg-detail", "delete-route-point", "select-saved-route",
  "saved-route-inspector", "saved-route-form", "saved-route-name", "saved-route-visible", "saved-route-detail", "extend-saved-route", "delete-saved-route",
  "measure-inspector", "measure-kind", "measure-detail", "measure-note", "line-form", "line-colour-row", "line-colour", "keep-measure", "delete-measure",
  "search-inspector", "search-form", "search-label", "search-lat", "search-lon", "search-direction", "search-distance", "search-spread", "search-tolerance", "search-summary", "search-mark", "delete-search", "search-boat-status", "choose-search-boat",
  "map-island-inspector", "map-island-name", "map-island-detail", "map-island-form", "map-island-notes", "delete-map-island",
  "track-inspector", "track-form", "track-name", "track-lat", "track-lon", "track-day", "track-time", "track-wind", "track-recorded", "delete-track", "track-selection", "track-connect-panel", "track-connect-detail", "track-connect", "track-selection-detail", "track-route-tolerance", "track-to-route",
  "wind-inspector", "wind-form", "wind-label", "wind-lat", "wind-lon", "wind-direction", "wind-day", "wind-time", "delete-wind",
  "feature-count", "feature-search", "feature-list", "item-filter", "track-file", "json-file",
  "chart-dialog", "chart-form", "chart-dialog-title", "dialog-chart-name", "dialog-chart-seed", "delete-chart", "help-dialog",
  "paste-dialog", "paste-form", "paste-text", "missing-dialog", "missing-form", "missing-text", "slot-dialog", "slot-form", "slot-list", "slot-pick-file", "pin-window", "open-folder", "storage-note",
  "island-dialog", "island-dialog-hint", "island-search", "island-region", "island-secrets", "island-list", "remove-island",
  "boat-dialog", "boat-dialog-hint", "boat-search", "boat-provider", "boat-list", "remove-boat",
  "layer-track-winds", "layer-track-key", "track-key", "track-key-heading", "show-track-key", "track-key-rows", "layer-dead-reckoning",
  "dr-panel", "dr-plot-form", "dr-from-label", "dr-from-latest", "dr-course", "dr-speed", "dr-hours", "dr-percent", "dr-day", "dr-time",
  "dr-inspector", "dr-form", "dr-label", "dr-detail", "dr-reckon-from", "delete-dr",
  "export-voyage", "compare-voyage", "voyage-file", "export-voyage-dialog", "export-voyage-form", "export-from", "export-to", "export-summary", "export-name", "export-note", "export-share", "export-world",
  "share-voyage", "enter-race", "publish-course", "publish-route-course", "browse-voyages", "export-title", "export-intro", "export-race-markers", "export-from-text", "export-to-text", "export-course-row", "export-course", "export-check", "export-submit",
  "course-dialog", "course-form", "course-summary", "course-name", "course-description", "course-order", "course-sort", "course-mods", "course-plugins-row", "course-plugins", "course-boats", "course-one-boat", "course-max-hull", "course-honour",
  "browse-dialog", "browse-status", "browse-world-row", "browse-world", "browse-world-summary", "browse-heatmap-row", "browse-heatmap", "browse-list", "browse-open-site",
  "compare-section", "compare-count", "compare-list", "compare-align", "compare-scrub-row", "compare-play", "compare-scrub", "compare-speed", "compare-speed-label", "compare-total", "compare-elapsed", "compare-point", "track-compare-start", "track-join",
  "manage-charts", "manage-dialog", "manage-list", "manage-new-folder", "manage-rename", "manage-move", "manage-up", "manage-down", "manage-delete", "manage-path",
  "layer-key-overlay", "key-overlay", "key-overlay-heading", "route-summary-heading", "show-route-panel", "key-overlay-rows",
  "equipment-panel", "equipment-state", "equipment-enabled", "equipment-items",
  "note-popout", "note-popout-title", "note-popout-close", "note-popout-type", "note-popout-types", "note-popout-text",
  "note-inspector", "note-kind", "note-form", "note-name", "note-lat", "note-lon", "note-day", "note-time", "note-recorded", "open-note", "delete-note"
].map((id) => [id, document.getElementById(id)]));

const inspectorHost = document.getElementById("inspector-host");

for (const id of ["empty-inspector", "feature-inspector", "route-inspector", "saved-route-inspector", "measure-inspector", "search-inspector", "map-island-inspector", "track-inspector", "wind-inspector", "dr-inspector", "note-inspector"]) {
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

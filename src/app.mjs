// Entry point: connects to the host, loads the workspace and wires the page's controls.
import { archiveActiveRoute, savedRouteForPoint } from "./model.mjs";
import { connectHost } from "./host.mjs";
import { clamp } from "./format.mjs";
import { canvas, elements, showToast } from "./dom.mjs";
import { activeChart, clearSelection, commit, initState, persist, redo, resetHistory, selectItem, selectedItem, selectedRefs, selection, setSaveStatus, undo, workspace } from "./state.mjs";
import { eventPoint, screenToWorld } from "./viewport.mjs";
import { drawChart, fitData, resizeCanvas, setOverlay } from "./render.mjs";
import { findHit } from "./hits.mjs";
import { addLocation, deleteSelected, updateSavedRouteFromForm, updateSelectedFromForm } from "./edits.mjs";
import { beginResolution, drawToolPreview, endPointer, mode, movePointer, pointerState, setMode, setSpacePressed, startPointer, stopEdgePan, zoomAt } from "./interaction.mjs";
import { renderEverything, renderFeatureList, renderInspector, renderRouteSummary } from "./panels.mjs";
import { applyLayout, endPanelResize, movePanelResize, resizePanelFromKeyboard, startPanelResize, togglePanel } from "./layout.mjs";
import { deleteChart, openAbout, openBoatLibrary, openChartDialog, openIslandLibrary, renderBoatLibrary, renderIslandLibrary, saveChartDialog, selectedBoatOwner } from "./dialogs.mjs";
import { exportActiveChart, exportLocationsCsv, exportWorkspace, importChartFile, importTrackFile, importTrackText } from "./files.mjs";
import { initUpdates } from "./updates.mjs";
import { initSettings, initTheme, stepInterfaceSize } from "./settings.mjs";
import "./menus.mjs";

const host = await connectHost();
initState(host, {
  everything: renderEverything,
  selection() {
    renderRouteSummary();
    renderInspector();
    renderFeatureList();
    drawChart();
  }
});
setOverlay(drawToolPreview);
initTheme();

// The macOS app names its own keys: Command for shortcuts, and Option to place freely.
if (host.platform === "mac") {
  for (const kbd of document.querySelectorAll("kbd:not([data-shortcut])")) {
    kbd.textContent = kbd.textContent.replace(/^Ctrl$/, "Option").replace("Ctrl Y", "⇧⌘Z").replace("Ctrl ", "⌘");
  }
  elements["zoom-reset"].firstChild.textContent = "Default text size ";
}

// Header, panels and dialogs
document.querySelectorAll(".tool").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
elements["chart-select"].addEventListener("change", (event) => {
  workspace.activeChartId = event.target.value;
  resetHistory();
  persist();
  renderEverything();
});
elements["new-chart"].addEventListener("click", () => openChartDialog("new"));
elements["save-chart"].addEventListener("click", () => { persist(); showToast("Chart saved."); });
elements["chart-settings"].addEventListener("click", () => openChartDialog("edit"));
elements["chart-form"].addEventListener("submit", saveChartDialog);
elements["delete-chart"].addEventListener("click", deleteChart);
elements.help.addEventListener("click", () => elements["help-dialog"].showModal());
elements.about.addEventListener("click", openAbout);
for (const side of ["left", "right"]) {
  const resizer = elements[`${side}-panel-resizer`];
  elements[`toggle-${side}-panel`].addEventListener("click", () => togglePanel(side));
  resizer.addEventListener("pointerdown", (event) => startPanelResize(side, event));
  resizer.addEventListener("pointermove", movePanelResize);
  resizer.addEventListener("pointerup", endPanelResize);
  resizer.addEventListener("pointercancel", endPanelResize);
  resizer.addEventListener("keydown", (event) => resizePanelFromKeyboard(side, event));
}
elements.undo.addEventListener("click", undo);
elements.redo.addEventListener("click", redo);
elements["fit-chart"].addEventListener("click", fitData);

// Route
elements["save-route"].addEventListener("click", () => {
  if (!activeChart().route.length) return;
  let archived = null;
  commit((chart) => {
    archived = archiveActiveRoute(chart);
    clearSelection();
  });
  if (archived) showToast(`${archived.name} saved. Plot Route now starts a new route.`);
});
elements["clear-route"].addEventListener("click", () => {
  if (!activeChart().route.length) return;
  commit((chart) => { chart.route = []; clearSelection(); });
});
elements["route-speed"].addEventListener("change", (event) => {
  const speed = Number(event.target.value);
  if (!Number.isFinite(speed) || speed <= 0) { renderRouteSummary(); return; }
  commit((chart) => { chart.speedKn = clamp(speed, 0.1, 30); }, { history: false });
});

// Layers
for (const [elementId, key] of [["layer-grid", "grid"], ["layer-labels", "labels"], ["layer-track", "track"], ["layer-distances", "routeDistances"], ["layer-bearings", "bearings"], ["layer-winds", "winds"], ["layer-boats", "boats"]]) {
  elements[elementId].addEventListener("change", (event) => commit((chart) => { chart.layers[key] = event.target.checked; }, { history: false }));
}

// Inspectors
for (const kind of ["feature", "route", "bearing", "search", "wind"]) {
  elements[`${kind}-form`].addEventListener("change", () => updateSelectedFromForm(kind));
  elements[`${kind}-form`].addEventListener("submit", (event) => event.preventDefault());
}
for (const id of ["delete-feature", "delete-route-point", "delete-saved-route", "delete-bearing", "delete-search", "delete-wind"]) {
  elements[id].addEventListener("click", deleteSelected);
}
elements["saved-route-form"].addEventListener("change", updateSavedRouteFromForm);
elements["saved-route-form"].addEventListener("submit", (event) => event.preventDefault());
elements["select-saved-route"].addEventListener("click", () => {
  const route = selection?.kind === "saved-point" ? savedRouteForPoint(activeChart(), selection.id) : null;
  if (route) selectItem("saved-route", route.id);
});
elements["search-mark"].addEventListener("click", () => beginResolution(selection));
elements["resolve-feature"].addEventListener("click", () => beginResolution(selection));

// Island and boat libraries
elements["choose-feature-island"].addEventListener("click", openIslandLibrary);
elements["island-search"].addEventListener("input", renderIslandLibrary);
elements["island-region"].addEventListener("change", renderIslandLibrary);
elements["island-secrets"].addEventListener("change", renderIslandLibrary);
elements["remove-island"].addEventListener("click", () => {
  const feature = selection?.kind === "feature" ? selectedItem() : null;
  if (!feature) return;
  commit(() => {
    delete feature.islandId;
    feature.showIsland = false;
  });
  elements["island-dialog"].close();
});
elements["choose-feature-boat"].addEventListener("click", openBoatLibrary);
elements["choose-search-boat"].addEventListener("click", openBoatLibrary);
elements["boat-search"].addEventListener("input", renderBoatLibrary);
elements["boat-provider"].addEventListener("change", renderBoatLibrary);
elements["remove-boat"].addEventListener("click", () => {
  const owner = selectedBoatOwner();
  if (!owner?.boatId) return;
  commit(() => {
    delete owner.boatId;
    delete owner.boatCorner;
    delete owner.showBoat;
  });
  elements["boat-dialog"].close();
});

// Chart items
elements["feature-search"].addEventListener("input", renderFeatureList);
elements["item-filter"].addEventListener("change", renderFeatureList);

// Files
async function reportErrors(action, input) {
  try {
    await action();
  } catch (error) {
    showToast(error.message || "Could not import this file.", true);
  } finally {
    if (input) input.value = "";
  }
}
elements["import-track"].addEventListener("click", () => elements["track-file"].click());
elements["track-file"].addEventListener("change", (event) => reportErrors(() => importTrackFile(event.target.files[0]), event.target));
elements["paste-track"].addEventListener("click", () => {
  elements["paste-text"].value = "";
  elements["paste-dialog"].showModal();
});
elements["paste-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  reportErrors(() => {
    importTrackText(elements["paste-text"].value);
    elements["paste-dialog"].close();
  });
});
elements["clear-track"].addEventListener("click", () => {
  commit((chart) => { chart.track = []; });
  showToast("Track cleared. Undo brings it back.");
});
elements["clear-bearings"].addEventListener("click", () => {
  commit((chart) => {
    chart.bearings = [];
    if (selectedRefs().some((ref) => ref.kind === "bearing")) clearSelection();
  });
  showToast("Bearing lines cleared. Undo brings them back.");
});
elements["import-json"].addEventListener("click", () => elements["json-file"].click());
elements["json-file"].addEventListener("change", (event) => reportErrors(() => importChartFile(event.target.files[0]), event.target));
elements["export-json"].addEventListener("click", exportActiveChart);
elements["export-csv"].addEventListener("click", exportLocationsCsv);
elements["export-all"].addEventListener("click", exportWorkspace);

// Chart canvas
canvas.addEventListener("pointerdown", startPointer);
canvas.addEventListener("pointermove", movePointer);
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", () => { if (!pointerState) stopEdgePan(); });
canvas.addEventListener("wheel", zoomAt, { passive: false });
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (mode !== "select") setMode("select");
});
canvas.addEventListener("dblclick", (event) => {
  if (mode !== "select") return;
  const screen = eventPoint(event);
  if (!findHit(screen.x, screen.y)) addLocation(screenToWorld(screen.x, screen.y));
});

// Keyboard shortcuts work whenever no text field has focus. Tool keys come from Settings.
const toolForKey = (key) => Object.entries(workspace.settings.shortcuts).find(([, assigned]) => assigned === key)?.[0];
window.addEventListener("keydown", (event) => {
  // Ctrl with + or - changes the interface size, and Ctrl+0 returns to the Windows text size.
  if ((event.ctrlKey || event.metaKey) && ["=", "+", "-", "0"].includes(event.key)) {
    event.preventDefault();
    stepInterfaceSize(event.key === "0" ? 0 : event.key === "-" ? -1 : 1);
    return;
  }
  const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (event.code === "Space" && !editing) { setSpacePressed(true); event.preventDefault(); }
  if (editing) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
  } else if ((event.ctrlKey || event.metaKey) && key === "y") {
    event.preventDefault();
    redo();
  } else if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelected();
  } else if (toolForKey(key)) setMode(toolForKey(key));
  else if (key === "f") fitData();
  else if (key === "i") openIslandLibrary();
  else if (event.key === "Escape") { setMode("select"); selectItem(null, null); }
});
window.addEventListener("keyup", (event) => { if (event.code === "Space") setSpacePressed(false); });
window.addEventListener("blur", stopEdgePan);
window.addEventListener("resize", applyLayout);
new ResizeObserver(resizeCanvas).observe(canvas.parentElement);

// Host
host.on("saved", ({ ok, error }) => {
  setSaveStatus(ok);
  if (!ok) showToast(`Could not save: ${error}`, true);
});
elements["app-version"].textContent = host.version;
// The macOS Edit menu sends Undo and Redo here: to the text field being edited, or else to the chart.
host.on("edit-command", ({ command }) => {
  if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) document.execCommand(command);
  else if (command === "undo") undo();
  else if (command === "redo") redo();
});
if (host.desktop) {
  elements["pin-window"].hidden = false;
  elements["open-folder"].hidden = false;
  elements["storage-note"].textContent = `Charts save automatically to ${host.dataFolder}.`;
  elements["pin-window"].addEventListener("click", host.togglePin);
  elements["open-folder"].addEventListener("click", host.openFolder);
  host.on("pinned", ({ value }) => {
    elements["pin-window"].classList.toggle("active", value);
    showToast(value ? "Chartroom stays on top of other windows." : "Chartroom no longer stays on top.");
  });
}

applyLayout();
renderEverything();
resizeCanvas();
initSettings();
initUpdates();

// Entry point: connects to the host, loads the workspace and wires the page's controls.
import { archiveActiveRoute, createLine, revealLayer, sailMasterRoute, savedRouteForPoint } from "./model.mjs";
import { connectHost } from "./host.mjs";
import { clamp } from "./format.mjs";
import { canvas, elements, showToast } from "./dom.mjs";
import { activeChart, clearSelection, commit, initState, persist, redo, replaceSelectionState, resetHistory, selectItem, selectedItem, selection, setSaveStatus, undo, workspace } from "./state.mjs";
import { eventPoint, screenToWorld } from "./viewport.mjs";
import { drawChart, fitData, resizeCanvas, setOverlay } from "./render.mjs";
import { findHit } from "./hits.mjs";
import { addLocation, deleteSelected, lockSelected, updateSavedRouteFromForm, updateSelectedFromForm } from "./edits.mjs";
import { beginResolution, drawToolPreview, endPointer, extendSavedRoute, mode, movePointer, pointerState, setMode, setSpacePressed, startPointer, stopEdgePan, zoomAt } from "./interaction.mjs";
import { LAYER_CONTROLS, renderEverything, renderFeatureList, renderInspector, renderRouteSummary } from "./panels.mjs";
import { applyLayout, endPanelResize, movePanelResize, resizePanelFromKeyboard, startPanelResize, togglePanel } from "./layout.mjs";
import { deleteChart, openAbout, openBoatLibrary, openChartDialog, openIslandLibrary, renderBoatLibrary, renderIslandLibrary, saveChartDialog, selectedBoatOwner, selectedIslandOwner } from "./dialogs.mjs";
import { exportActiveChart, exportLocationsCsv, exportWorkspace, importChartFile, importTrackFile, importTrackText } from "./files.mjs";
import { initUpdates } from "./updates.mjs";
import { initLiveTrack } from "./live-track.mjs";
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
// The speed field has no min, so its arrows step from 0 in whole and half knots; 0.1 kn is still the lowest speed.
// The route the summary shows: a saved route while it or one of its waypoints is selected, else the active one.
elements["copy-sailmaster"].addEventListener("click", () => {
  const saved = selection?.kind === "saved-route" ? selectedItem()
    : selection?.kind === "saved-point" ? savedRouteForPoint(activeChart(), selection.id) : null;
  const points = saved?.points ?? activeChart().route;
  if (!points.length) return;
  // A plain browser may refuse the clipboard; the desktop apps always take it.
  Promise.resolve(host.copyText(sailMasterRoute(points))).then(
    () => showToast(`Copied ${points.length} waypoint${points.length === 1 ? "" : "s"}. Paste them into SailMaster's route box.`),
    () => showToast("The route could not be copied.", true)
  );
});
elements["route-circumnavigation"].addEventListener("change", (event) => {
  commit((chart) => {
    chart.circumnavigation = event.target.checked;
  });
});
elements["route-speed"].addEventListener("change", (event) => {
  const speed = event.target.valueAsNumber;
  if (!Number.isFinite(speed)) { renderRouteSummary(); return; }
  commit((chart) => { chart.speedKn = clamp(speed, 0.1, 30); }, { history: false });
  event.target.value = activeChart().speedKn;
});

// Layers
for (const [elementId, key] of LAYER_CONTROLS) {
  elements[elementId].addEventListener("change", (event) => commit((chart) => { chart.layers[key] = event.target.checked; }, { history: false }));
}

// Inspectors
for (const kind of ["feature", "route", "search", "wind", "track"]) {
  elements[`${kind}-form`].addEventListener("change", () => updateSelectedFromForm(kind));
  elements[`${kind}-form`].addEventListener("submit", (event) => event.preventDefault());
}
for (const id of ["delete-feature", "delete-route-point", "delete-saved-route", "delete-measure", "delete-search", "delete-wind", "delete-track", "delete-map-island"]) {
  elements[id].addEventListener("click", deleteSelected);
}
// The padlock follows the item whose inspector is shown, and applies to the whole selection.
for (const button of document.querySelectorAll("[data-lock]")) {
  button.addEventListener("click", () => lockSelected(button.getAttribute("aria-pressed") !== "true"));
}
elements["lock-selected"].addEventListener("click", () => lockSelected(true));
elements["unlock-selected"].addEventListener("click", () => lockSelected(false));
elements["saved-route-form"].addEventListener("change", updateSavedRouteFromForm);
elements["line-form"].addEventListener("submit", (event) => event.preventDefault());
elements["map-island-form"].addEventListener("submit", (event) => event.preventDefault());
elements["map-island-notes"].addEventListener("change", (event) => {
  const island = selection?.kind === "map-island" ? selectedItem() : null;
  if (island) commit(() => { island.notes = event.target.value.trim(); });
});
elements["line-colour"].addEventListener("change", (event) => {
  const line = selection?.kind === "line" ? selectedItem() : null;
  // A line moved to a hidden colour shows that colour again, so it does not vanish while selected.
  if (line) commit((chart) => {
    line.color = event.target.value;
    revealLayer(chart, "line", line);
  });
});
// Keeping the measure line turns it into a chart line, so the next measurement no longer replaces it.
elements["keep-measure"].addEventListener("click", () => {
  const measure = selection?.kind === "measure" ? selectedItem() : null;
  if (!measure) return;
  commit((chart) => {
    const line = createLine(measure);
    chart.measures = chart.measures.filter((item) => item !== measure);
    chart.segments.push(line);
    revealLayer(chart, "line", line);
    replaceSelectionState("line", line.id);
  });
});
elements["saved-route-form"].addEventListener("submit", (event) => event.preventDefault());
elements["extend-saved-route"].addEventListener("click", () => {
  const route = selection?.kind === "saved-route" ? selectedItem() : null;
  if (route) extendSavedRoute(route);
});
elements["select-saved-route"].addEventListener("click", () => {
  const route = selection?.kind === "saved-point" ? savedRouteForPoint(activeChart(), selection.id) : null;
  if (route) selectItem("saved-route", route.id);
});
elements["search-mark"].addEventListener("click", () => beginResolution(selection));
elements["resolve-feature"].addEventListener("click", () => beginResolution(selection));

// Island and boat libraries
elements["choose-feature-island"].addEventListener("click", openIslandLibrary);
elements["choose-search-island"].addEventListener("click", openIslandLibrary);
elements["island-search"].addEventListener("input", renderIslandLibrary);
elements["island-region"].addEventListener("change", renderIslandLibrary);
elements["island-secrets"].addEventListener("change", renderIslandLibrary);
elements["remove-island"].addEventListener("click", () => {
  const owner = selectedIslandOwner();
  if (!owner) return;
  commit(() => {
    delete owner.islandId;
    owner.showIsland = false;
  });
  elements["island-dialog"].close();
});
elements["choose-feature-boat"].addEventListener("click", openBoatLibrary);
elements["choose-search-boat"].addEventListener("click", openBoatLibrary);
elements["boat-search"].addEventListener("input", renderBoatLibrary);
elements["boat-provider"].addEventListener("change", renderBoatLibrary);
elements["remove-boat"].addEventListener("click", () => {
  const owner = selectedBoatOwner();
  if (!owner?.boatIds) return;
  commit(() => {
    delete owner.boatIds;
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
initLiveTrack();

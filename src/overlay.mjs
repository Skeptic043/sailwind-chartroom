// The Voyage Recorder hotkeys overlay: a small panel over the chart listing Voyage Recorder's keys, for reference
// while sailing. It never sends keys to the game. Drag it by its heading; the Hotkeys button shows and hides it. The keys come from the latest
// recording Chartroom read, so a key changed in Voyage Recorder's config shows here once Chartroom reads the
// next line; before any recording it shows Voyage Recorder's default keys.
import { canvas, elements } from "./dom.mjs";
import { persist, workspace } from "./state.mjs";

const RECORDER_ROWS = Object.freeze([
  { name: "record", action: "Record on or off", fallback: "J" },
  { name: "location", action: "Record your location", fallback: "V" },
  { name: "marker", action: "Marks and notes", fallback: "V + LeftShift" }
]);
const floatingPanels = [];

// BepInEx writes a shortcut as its key, then its modifiers: "V + LeftShift". Shown the usual way: "Shift + V".
const MODIFIER_NAMES = Object.freeze({ LeftShift: "Shift", RightShift: "Shift", LeftControl: "Ctrl", RightControl: "Ctrl", LeftAlt: "Alt", RightAlt: "Alt", LeftCommand: "Cmd", RightCommand: "Cmd" });

export function keyLabel(text) {
  const parts = String(text).split(" + ").map((part) => part.trim()).filter(Boolean);
  const modifiers = parts.filter((part) => part in MODIFIER_NAMES).map((part) => MODIFIER_NAMES[part]);
  const keys = parts.filter((part) => !(part in MODIFIER_NAMES)).map((part) => part.replace(/^Alpha(\d)$/, "$1"));
  return [...modifiers, ...keys].join(" + ");
}

// A panel over the chart that its heading drags around. Where it sits is kept in settings as fractions of the
// chart's free width and height, so it stays in the same corner when the window changes size.
export function makeFloating(box, handle, position) {
  floatingPanels.push({ box, position });
  let drag = null;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button, input, select, label")) return;
    const bounds = box.getBoundingClientRect();
    drag = { pointerId: event.pointerId, dx: event.clientX - bounds.left, dy: event.clientY - bounds.top };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    const stage = canvas.getBoundingClientRect();
    const bounds = box.getBoundingClientRect();
    const where = position();
    where.x = clamp01((event.clientX - drag.dx - stage.left) / Math.max(1, stage.width - bounds.width));
    where.y = clamp01((event.clientY - drag.dy - stage.top) / Math.max(1, stage.height - bounds.height));
    placeFloating(box, where);
  });
  const finish = (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    persist();
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  window.addEventListener("resize", () => placeFloating(box, position()));
}

// A sidebar changes the chart's width without resizing the window, so panels are placed again the same way.
export function placeFloatingPanels() {
  for (const { box, position } of floatingPanels) placeFloating(box, position());
}

export function placeFloating(box, { x, y }) {
  if (box.hidden) return;
  const stage = canvas.getBoundingClientRect();
  box.style.left = `${Math.round(x * Math.max(0, stage.width - box.offsetWidth))}px`;
  box.style.top = `${Math.round(y * Math.max(0, stage.height - box.offsetHeight))}px`;
}

// renderRoute redraws the route panel, which the panels module fills in; this module only moves it.
export function initOverlay({ renderRoute }) {
  elements["layer-key-overlay"].addEventListener("change", (event) => setShown(event.target.checked));
  elements["show-key-overlay"].addEventListener("click", () => setShown(!workspace.settings.overlay.shown));
  makeFloating(elements["key-overlay"], elements["key-overlay-heading"], () => workspace.settings.overlay);
  makeFloating(elements["route-summary"], elements["route-summary-heading"], () => workspace.settings.routePanel);
  elements["show-route-panel"].addEventListener("click", () => {
    const panel = workspace.settings.routePanel;
    panel.shown = !panel.shown;
    persist();
    renderRoute();
  });
}

function setShown(shown) {
  workspace.settings.overlay.shown = shown;
  persist();
  renderOverlay();
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

export function renderOverlay() {
  const { shown } = workspace.settings.overlay;
  elements["layer-key-overlay"].checked = shown;
  elements["show-key-overlay"].setAttribute("aria-pressed", String(shown));
  elements["key-overlay"].hidden = !shown;
  if (!shown) return;
  const keys = workspace.settings.recorderKeys;
  elements["key-overlay-rows"].replaceChildren(...RECORDER_ROWS.map(({ name, action, fallback }) => {
    const row = document.createElement("tr");
    row.append(Object.assign(document.createElement("td"), { textContent: action }), Object.assign(document.createElement("td"), { className: "key", textContent: keyLabel(keys?.[name] ?? fallback) }));
    return row;
  }));
  placeFloating(elements["key-overlay"], workspace.settings.overlay);
}

// Notes on the chart: a notepad icon at a place, and a popout attached to that icon for writing the note.
// Encounters open the same popout, for their name and notes.
// The popout opens beside its icon, follows it as the chart pans and zooms, and flips to the icon's other
// side near the chart's edge. It hides while its icon is out of view and shows again when it returns.
import { MAX_ENCOUNTER_NOTES, MAX_NOTE_LENGTH, itemShown, iconScale } from "./model.mjs";
import { canvas, context, elements, keysBelongTo } from "./dom.mjs";
import { activeChart, commit, isSelected, workspace } from "./state.mjs";
import { symbolSize, worldToScreen } from "./viewport.mjs";
import { LOCATION_ICONS, drawLocationIcon } from "./icons.mjs";
import { mapPalette } from "./theme.mjs";

// What the popout shows: { kind: "note" | "feature", id }. A note keeps its writing as text, an encounter as
// notes, which are shorter.
let opened = null;
const TEXT_FIELD = Object.freeze({ note: "text", feature: "notes" });
const COLLECTION = Object.freeze({ note: "notes", feature: "features" });
// How far the popout sits from its icon's centre, and from the chart's edges, in pixels.
const ICON_GAP_PX = 16;
const EDGE_PX = 8;
const TYPING_SAVE_MS = 600;
let typingTimer = null;

export function initNotes() {
  elements["note-popout-text"].maxLength = MAX_NOTE_LENGTH;
  elements["note-popout-close"].addEventListener("click", closeNote);
  elements["note-popout-text"].addEventListener("change", saveText);
  // The popout's title is the note's name: click it to edit, Enter to finish.
  elements["note-popout-title"].addEventListener("change", saveName);
  elements["note-popout-title"].addEventListener("keydown", (event) => {
    if (event.key === "Enter") elements["note-popout-text"].focus();
  });
  // Saved as you type, after a short pause, so closing Chartroom mid-sentence keeps the text.
  elements["note-popout-text"].addEventListener("input", () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(saveText, TYPING_SAVE_MS);
  });
  window.addEventListener("pagehide", saveText);
  // An encounter's type can be switched from the button beside the close button.
  elements["note-popout-type"].addEventListener("click", () => showTypes(elements["note-popout-types"].hidden));
  // Escape closes the type list, then the popout, before the chart's own Escape sees it.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || elements["note-popout"].hidden || !keysBelongTo(elements["note-popout"])) return;
    if (!elements["note-popout-types"].hidden) {
      event.stopPropagation();
      showTypes(false);
      elements["note-popout-type"].focus();
      return;
    }
    event.stopPropagation();
    closeNote();
    canvas.focus();
  });
}

export function openNote(id, kind = "note") {
  opened = { kind, id };
  const note = openedNote();
  if (!note) return;
  const text = elements["note-popout-text"];
  text.maxLength = kind === "note" ? MAX_NOTE_LENGTH : MAX_ENCOUNTER_NOTES;
  text.placeholder = kind === "note" ? "Write about this place…" : "What did you see here?";
  elements["note-popout-title"].placeholder = kind === "note" ? "Note" : "Encounter";
  text.value = note[TEXT_FIELD[kind]];
  // Redrawn in the current theme's colours.
  delete elements["note-popout-type"].dataset.icon;
  showTypes(false);
  positionNotePopout();
  elements["note-popout-text"].focus();
}

export function closeNote() {
  saveText();
  saveName();
  showTypes(false);
  opened = null;
  elements["note-popout"].hidden = true;
}

function openedNote() {
  return opened ? activeChart()[COLLECTION[opened.kind]].find((item) => item.id === opened.id) ?? null : null;
}

// Changes the open note or encounter in the chart about to be committed.
function changeOpened(change) {
  const { kind, id } = opened;
  commit((chart) => {
    const target = chart[COLLECTION[kind]].find((candidate) => candidate.id === id);
    if (target) change(target, TEXT_FIELD[kind]);
  });
}

function saveText() {
  clearTimeout(typingTimer);
  const note = openedNote();
  const text = elements["note-popout-text"].value;
  if (!note || note[TEXT_FIELD[opened.kind]] === text) return;
  changeOpened((target, field) => { target[field] = text; });
}

function saveName() {
  const note = openedNote();
  const name = elements["note-popout-title"].value.trim().slice(0, 100);
  if (!note || note.name === name) return;
  changeOpened((target) => { target.name = name; });
}

// Called after every redraw. A note or encounter deleted, undone away or on another chart closes its popout.
export function positionNotePopout() {
  const popout = elements["note-popout"];
  const note = openedNote();
  if (!note) {
    opened = null;
    popout.hidden = true;
    return;
  }
  const textarea = elements["note-popout-text"];
  const text = note[TEXT_FIELD[opened.kind]];
  if (document.activeElement !== textarea && textarea.value !== text) textarea.value = text;
  const title = elements["note-popout-title"];
  if (document.activeElement !== title && title.value !== note.name) title.value = note.name;
  const typeButton = elements["note-popout-type"];
  typeButton.hidden = opened.kind !== "feature" || !note.icon;
  if (!typeButton.hidden && typeButton.dataset.icon !== note.icon) {
    typeButton.dataset.icon = note.icon;
    typeButton.replaceChildren(iconCanvas(note.icon, 18), Object.assign(document.createElement("span"), { className: "caret", textContent: "▾" }));
  }
  const stage = canvas.getBoundingClientRect();
  const icon = worldToScreen(note);
  if (!itemShown(activeChart(), opened.kind, note) || icon.x < 0 || icon.y < 0 || icon.x > stage.width || icon.y > stage.height) {
    popout.hidden = true;
    return;
  }
  popout.hidden = false;
  const width = popout.offsetWidth;
  const height = popout.offsetHeight;
  const right = icon.x + ICON_GAP_PX + width + EDGE_PX <= stage.width || icon.x < stage.width / 2;
  const left = right ? icon.x + ICON_GAP_PX : icon.x - ICON_GAP_PX - width;
  const top = Math.min(Math.max(EDGE_PX, icon.y - height / 2), Math.max(EDGE_PX, stage.height - height - EDGE_PX));
  popout.classList.toggle("right", right);
  popout.classList.toggle("left", !right);
  popout.style.left = `${Math.round(left)}px`;
  popout.style.top = `${Math.round(top)}px`;
  // The pointer stays on the icon even when the popout is pushed up or down by the chart's edge.
  popout.style.setProperty("--pointer-y", `${Math.round(Math.min(Math.max(12, icon.y - top), height - 12))}px`);
}

// The encounter's icon on a small canvas, drawn the way the chart draws it.
function iconCanvas(id, size) {
  const ratio = window.devicePixelRatio || 1;
  const icon = Object.assign(document.createElement("canvas"), { width: Math.round(size * ratio), height: Math.round(size * ratio) });
  icon.style.width = icon.style.height = `${size}px`;
  const iconContext = icon.getContext("2d");
  iconContext.scale(ratio, ratio);
  drawLocationIcon(iconContext, id, size / 2, size / 2, size * 0.36, mapPalette());
  return icon;
}

// The menu of encounters. Picking one changes the open encounter, and its name too while it is still named
// after its old type.
function showTypes(shown) {
  const menu = elements["note-popout-types"];
  elements["note-popout-type"].setAttribute("aria-expanded", String(shown));
  menu.hidden = !shown;
  if (!shown) return;
  const current = openedNote()?.icon;
  menu.replaceChildren(...Object.entries(LOCATION_ICONS).map(([id, { label }]) => {
    const item = Object.assign(document.createElement("button"), { type: "button", className: "popout-type-item" });
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", String(id === current));
    item.append(iconCanvas(id, 22), Object.assign(document.createElement("span"), { textContent: label }));
    item.addEventListener("click", () => {
      showTypes(false);
      if (!openedNote() || id === current) return;
      changeOpened((target) => {
        if (target.name === LOCATION_ICONS[target.icon]?.label) target.name = LOCATION_ICONS[id].label;
        target.icon = id;
      });
    });
    return item;
  }));
  menu.querySelector('[aria-checked="true"]')?.focus();
}

// A notepad: a page with a folded corner and ruled lines.
export function drawNotes(palette) {
  const chart = activeChart();
  if (!chart.layers.notes) return;
  const base = Math.min(14, Math.max(9, symbolSize("mark") * 1.8));
  for (const note of chart.notes) {
    const size = base * iconScale(note, workspace.settings.iconSize);
    const { x, y } = worldToScreen(note);
    const selected = isSelected("note", note.id) || (opened?.kind === "note" && note.id === opened.id);
    const half = size;
    context.save();
    context.translate(x, y);
    context.beginPath();
    context.moveTo(-half * 0.75, -half);
    context.lineTo(half * 0.4, -half);
    context.lineTo(half * 0.75, -half * 0.65);
    context.lineTo(half * 0.75, half);
    context.lineTo(-half * 0.75, half);
    context.closePath();
    context.fillStyle = palette.paperA;
    context.fill();
    context.lineWidth = selected ? 2.2 : 1.4;
    context.strokeStyle = selected ? palette.select : palette.accent;
    context.stroke();
    context.beginPath();
    context.lineWidth = 1;
    context.strokeStyle = palette.ink;
    for (const row of [-0.35, 0.05, 0.45]) {
      context.moveTo(-half * 0.45, half * row);
      context.lineTo(half * 0.45, half * row);
    }
    context.stroke();
    context.restore();
  }
}

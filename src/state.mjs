// Owns the workspace, the selection and undo history. Every chart edit goes through commit().
import { createWorkspace, followAnchors, itemForRef, sanitizeWorkspace } from "./model.mjs";
import { elements } from "./dom.mjs";

const UNDO_LIMIT = 60;

export let host = null;
export let workspace = null;
export let selection = null;
export let selectedKeys = new Set();
let undoStack = [];
let redoStack = [];

// State changes redraw through these, registered by app.mjs, so this module needs no rendering imports.
const views = { everything() {}, selection() {} };

export function initState(connectedHost, renderers) {
  host = connectedHost;
  workspace = host.workspace ? sanitizeWorkspace(host.workspace) : createWorkspace();
  Object.assign(views, renderers);
}

export function activeChart() {
  return workspace.charts.find((chart) => chart.id === workspace.activeChartId) ?? workspace.charts[0];
}

export function persist() {
  const status = elements["save-status"];
  status.classList.add("saving");
  status.lastChild.textContent = " Saving…";
  host.save(workspace);
}

export function setSaveStatus(ok) {
  const status = elements["save-status"];
  status.classList.remove("saving");
  status.lastChild.textContent = ok ? " Saved" : " Save failed";
}

function snapshotChart() {
  return structuredClone(activeChart());
}

export function pushUndo() {
  undoStack.push(snapshotChart());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}

// History belongs to one chart, so switching, adding, deleting or importing charts starts it afresh.
export function resetHistory() {
  undoStack = [];
  redoStack = [];
  clearSelection();
  updateUndoButtons();
}

export function commit(mutator, { history = true, render = true } = {}) {
  if (history) pushUndo();
  try {
    mutator(activeChart());
  } catch (error) {
    if (history) {
      undoStack.pop();
      updateUndoButtons();
    }
    throw error;
  }
  followAnchors(activeChart());
  activeChart().updatedAt = new Date().toISOString();
  persist();
  if (render) views.everything();
}

// Adds items that are not an edit, such as live positions. They join every snapshot of the chart as
// well, so undoing or redoing an edit never takes them away.
export function appendOutsideHistory(chart, key, items) {
  chart[key].push(...items);
  for (const snapshot of [...undoStack, ...redoStack]) {
    if (snapshot.id === chart.id) snapshot[key].push(...structuredClone(items));
  }
}

export const undo = () => restoreFrom(undoStack, redoStack);
export const redo = () => restoreFrom(redoStack, undoStack);

function restoreFrom(stack, destination) {
  if (!stack.length) return;
  destination.push(snapshotChart());
  const restored = stack.pop();
  const index = workspace.charts.findIndex((chart) => chart.id === workspace.activeChartId);
  workspace.charts[index] = restored;
  clearSelection();
  persist();
  views.everything();
}

export function updateUndoButtons() {
  elements.undo.disabled = undoStack.length === 0;
  elements.redo.disabled = redoStack.length === 0;
}

export function selectionKey(kind, id) {
  return `${kind}:${id}`;
}

export function selectedRefs() {
  return [...selectedKeys].map((key) => {
    const separator = key.indexOf(":");
    return { kind: key.slice(0, separator), id: key.slice(separator + 1) };
  });
}

export function clearSelection() {
  selection = null;
  selectedKeys.clear();
}

export function replaceSelectionState(kind, id) {
  if (!kind || !id) return clearSelection();
  selection = { kind, id };
  selectedKeys = new Set([selectionKey(kind, id)]);
}

// Makes an already selected item the primary one, whose inspector is shown, without changing the set.
export function setPrimarySelection(ref) {
  if (ref && selectedKeys.has(selectionKey(ref.kind, ref.id))) selection = { kind: ref.kind, id: ref.id };
}

export function selectItem(kind, id, { additive = false } = {}) {
  if (!kind || !id) {
    clearSelection();
  } else {
    const key = selectionKey(kind, id);
    if (additive) {
      if (selectedKeys.has(key)) {
        selectedKeys.delete(key);
        if (selectionKey(selection?.kind, selection?.id) === key) {
          const replacement = selectedRefs().at(-1);
          selection = replacement ?? null;
        }
      } else {
        selectedKeys.add(key);
        selection = { kind, id };
      }
    } else {
      replaceSelectionState(kind, id);
    }
  }
  refreshSelection();
}

// Redraws the inspector, list and chart after a selection change or a rejected edit.
export function refreshSelection() {
  views.selection();
}

export function selectedItem() {
  return itemForRef(activeChart(), selection);
}

export function isSelected(kind, id) {
  return selectedKeys.has(selectionKey(kind, id));
}

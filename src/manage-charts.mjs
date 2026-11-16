// File > Manage charts: a folder tree like a file manager's. Folders come first and open to show their
// charts; charts in no folder follow. Select a row, then use the toolbar, or double-click a name to rename
// it and drag a chart onto a folder to move it. The Active chart menu shows the same folders and order.
import { makeId } from "./model.mjs";
import { chartGroups, createFolder, deleteFolder, moveChartToFolder, renameFolder, shiftChart, shiftFolder } from "./folders.mjs";
import { elements, showToast } from "./dom.mjs";
import { persist, resetHistory, workspace } from "./state.mjs";
import { renderEverything } from "./panels.mjs";
import { fitData } from "./render.mjs";

// The selected row: { kind: "folder" | "chart", id }. Closed folders are remembered while Chartroom runs.
let selected = null;
const closedFolders = new Set();
let renaming = null;

export function initManageCharts() {
  elements["manage-charts"].addEventListener("click", () => {
    selected = { kind: "chart", id: workspace.activeChartId };
    renaming = null;
    // The open chart is selected, so its folder opens to show it.
    const folderId = workspace.charts.find((chart) => chart.id === workspace.activeChartId)?.folderId;
    if (folderId) closedFolders.delete(folderId);
    renderManageCharts();
    elements["manage-dialog"].showModal();
  });
  elements["manage-new-folder"].addEventListener("click", () => {
    const folder = createFolder(workspace, "New folder", makeId("folder"));
    selected = { kind: "folder", id: folder.id };
    renaming = selected;
    changed();
  });
  elements["manage-rename"].addEventListener("click", () => {
    if (!selected) return;
    renaming = selected;
    renderManageCharts();
  });
  elements["manage-move"].addEventListener("change", (event) => {
    if (selected?.kind !== "chart") return;
    moveChartToFolder(workspace, selected.id, event.target.value);
    if (event.target.value) closedFolders.delete(event.target.value);
    changed();
  });
  elements["manage-up"].addEventListener("click", () => shift(-1));
  elements["manage-down"].addEventListener("click", () => shift(1));
  elements["manage-delete"].addEventListener("click", removeSelected);
  // Charts dropped on the empty space below the tree leave their folder.
  const tree = elements["manage-list"];
  tree.addEventListener("dragover", (event) => {
    if (event.target === tree) event.preventDefault();
  });
  tree.addEventListener("drop", (event) => {
    if (event.target !== tree) return;
    event.preventDefault();
    dropChart(event, "");
  });
  tree.addEventListener("keydown", (event) => {
    if (renaming) return;
    if (event.key === "F2") elements["manage-rename"].click();
    if (event.key === "Delete") removeSelected();
  });
}

function changed() {
  persist();
  renderEverything();
  renderManageCharts();
}

function shift(direction) {
  if (!selected) return;
  if (selected.kind === "folder") shiftFolder(workspace, selected.id, direction);
  else shiftChart(workspace, selected.id, direction);
  changed();
}

function folderName(id) {
  return workspace.folders.find((folder) => folder.id === id)?.name ?? "";
}

function renderManageCharts() {
  const groups = chartGroups(workspace);
  if (selected && !(selected.kind === "folder" ? workspace.folders : workspace.charts).some((item) => item.id === selected.id)) selected = null;
  const rows = [];
  for (const { folder, charts } of groups) {
    if (folder) {
      rows.push(folderRow(folder, charts.length));
      if (!closedFolders.has(folder.id)) rows.push(...charts.map((chart) => chartRow(chart, 1)));
    } else {
      rows.push(...charts.map((chart) => chartRow(chart, 0)));
    }
  }
  elements["manage-list"].replaceChildren(...rows);
  renderToolbar();
  elements["manage-list"].querySelector(".manage-rename-input")?.select();
}

function renderToolbar() {
  const chart = selected?.kind === "chart" ? workspace.charts.find((item) => item.id === selected.id) : null;
  const folder = selected?.kind === "folder" ? workspace.folders.find((item) => item.id === selected.id) : null;
  elements["manage-rename"].disabled = !selected;
  elements["manage-delete"].disabled = !selected;
  const move = elements["manage-move"];
  move.disabled = !chart;
  move.replaceChildren(new Option("No folder", ""), ...workspace.folders.map((entry) => new Option(entry.name, entry.id)));
  move.value = chart?.folderId ?? "";
  // Up and down move within the item's own list: folders among folders, charts among the charts beside them.
  const siblings = folder ? workspace.folders : chart ? workspace.charts.filter((item) => (item.folderId ?? "") === (chart.folderId ?? "")) : [];
  const index = siblings.indexOf(folder ?? chart);
  elements["manage-up"].disabled = index <= 0;
  elements["manage-down"].disabled = index < 0 || index === siblings.length - 1;
  elements["manage-path"].textContent = chart
    ? `${chart.folderId ? `${folderName(chart.folderId)} › ` : ""}${chart.name}${chart.id === workspace.activeChartId ? " (open)" : ""}`
    : folder ? `${folder.name} · ${workspace.charts.filter((item) => item.folderId === folder.id).length} charts` : "";
}

function row(kind, id, depth) {
  const element = document.createElement("div");
  element.className = `manage-row ${kind}-row`;
  element.dataset[kind] = id;
  element.style.setProperty("--depth", String(depth));
  element.tabIndex = -1;
  element.setAttribute("role", "treeitem");
  const isSelected = selected?.kind === kind && selected.id === id;
  element.classList.toggle("is-selected", isSelected);
  element.setAttribute("aria-selected", String(isSelected));
  // Selecting only restyles the rows, so the row stays in place for a double-click.
  element.addEventListener("click", () => {
    if (renaming) return;
    selected = { kind, id };
    for (const other of elements["manage-list"].querySelectorAll(".manage-row")) {
      const isSelected = other === element;
      other.classList.toggle("is-selected", isSelected);
      other.setAttribute("aria-selected", String(isSelected));
    }
    renderToolbar();
    element.focus();
  });
  element.addEventListener("dblclick", (event) => {
    if (event.target.closest(".manage-twisty")) return;
    selected = { kind, id };
    renaming = selected;
    renderManageCharts();
  });
  return element;
}

function nameField(kind, id, value, rename) {
  if (renaming?.kind !== kind || renaming.id !== id) return Object.assign(document.createElement("span"), { className: "manage-name", textContent: value });
  const input = Object.assign(document.createElement("input"), { className: "manage-rename-input", value, maxLength: 80 });
  input.setAttribute("aria-label", kind === "folder" ? "Folder name" : "Chart name");
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    renaming = null;
    if (save) rename(input.value);
    changed();
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  return input;
}

function folderRow(folder, count) {
  const element = row("folder", folder.id, 0);
  const open = !closedFolders.has(folder.id);
  element.setAttribute("aria-expanded", String(open));
  const twisty = Object.assign(document.createElement("button"), { type: "button", className: "manage-twisty", textContent: open ? "▾" : "▸" });
  twisty.setAttribute("aria-label", open ? "Close folder" : "Open folder");
  twisty.addEventListener("click", (event) => {
    event.stopPropagation();
    if (open) closedFolders.add(folder.id); else closedFolders.delete(folder.id);
    // A chart hidden by closing its folder hands the selection to the folder.
    if (open && selected?.kind === "chart" && workspace.charts.find((chart) => chart.id === selected.id)?.folderId === folder.id) selected = { kind: "folder", id: folder.id };
    renderManageCharts();
  });
  element.append(twisty, Object.assign(document.createElement("span"), { className: "manage-icon", textContent: open ? "📂" : "📁" }),
    nameField("folder", folder.id, folder.name, (name) => renameFolder(workspace, folder.id, name)),
    Object.assign(document.createElement("span"), { className: "manage-count", textContent: String(count) }));
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    element.classList.add("drop-target");
  });
  element.addEventListener("dragleave", () => element.classList.remove("drop-target"));
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    closedFolders.delete(folder.id);
    dropChart(event, folder.id);
  });
  return element;
}

function chartRow(chart, depth) {
  const element = row("chart", chart.id, depth);
  element.draggable = renaming?.id !== chart.id;
  element.classList.toggle("is-open", chart.id === workspace.activeChartId);
  element.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/x-chartroom-chart", chart.id);
    event.dataTransfer.effectAllowed = "move";
  });
  element.append(Object.assign(document.createElement("span"), { className: "manage-twisty-space" }),
    Object.assign(document.createElement("span"), { className: "manage-icon", textContent: "🗺" }),
    nameField("chart", chart.id, chart.name, (name) => { chart.name = name.trim().slice(0, 80) || chart.name; }),
    Object.assign(document.createElement("span"), { className: "manage-count", textContent: chart.id === workspace.activeChartId ? "Open" : "" }));
  return element;
}

function dropChart(event, folderId) {
  const id = event.dataTransfer.getData("text/x-chartroom-chart");
  if (!id) return;
  moveChartToFolder(workspace, id, folderId);
  selected = { kind: "chart", id };
  changed();
}

function removeSelected() {
  if (selected?.kind === "folder") {
    const folder = workspace.folders.find((item) => item.id === selected.id);
    const charts = workspace.charts.filter((chart) => chart.folderId === folder?.id).length;
    if (!folder) return;
    if (charts && !window.confirm(`Delete the folder “${folder.name}”? Its ${charts} chart${charts === 1 ? "" : "s"} will be kept, outside any folder.`)) return;
    deleteFolder(workspace, folder.id);
    selected = null;
    changed();
    return;
  }
  const chart = workspace.charts.find((item) => item.id === selected?.id);
  if (chart) removeChart(chart);
}

function removeChart(chart) {
  if (workspace.charts.length === 1) {
    showToast("Keep at least one chart. Clear its contents instead.", true);
    return;
  }
  if (!window.confirm(`Delete “${chart.name}” from Chartroom? Export it first if you may need it later.`)) return;
  const wasActive = chart.id === workspace.activeChartId;
  workspace.charts = workspace.charts.filter((candidate) => candidate !== chart);
  selected = null;
  // The active chart's history goes with it; another chart opens in its place.
  if (wasActive) {
    workspace.activeChartId = chartGroups(workspace).flatMap((group) => group.charts)[0].id;
    resetHistory();
  }
  changed();
  if (wasActive) fitData();
}

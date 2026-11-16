// Chart folders and order. The workspace keeps folders as [{ id, name }] in their order, and each chart
// names its folder with folderId (none when it's in no folder). Charts keep their order in workspace.charts;
// within a folder, or outside any, they show in that order.

const MAX_FOLDERS = 100;

export function sanitizeFolders(value) {
  const seen = new Set();
  const folders = [];
  for (const folder of Array.isArray(value) ? value : []) {
    const id = String(folder?.id ?? "").trim().slice(0, 120);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    folders.push({ id, name: String(folder?.name ?? "").trim().slice(0, 80) || "Folder" });
    if (folders.length >= MAX_FOLDERS) break;
  }
  return folders;
}

// A chart whose folder no longer exists is left in no folder.
export function settleChartFolders(workspace) {
  const folderIds = new Set(workspace.folders.map((folder) => folder.id));
  for (const chart of workspace.charts) if (chart.folderId && !folderIds.has(chart.folderId)) delete chart.folderId;
}

// Each folder with its charts, then the charts in no folder, as a file manager lists them:
// [{ folder: folder | null, charts }].
export function chartGroups(workspace) {
  const groups = workspace.folders.map((folder) => ({ folder, charts: workspace.charts.filter((chart) => chart.folderId === folder.id) }));
  groups.push({ folder: null, charts: workspace.charts.filter((chart) => !chart.folderId) });
  return groups;
}

export function createFolder(workspace, name, id) {
  const folder = { id, name: String(name ?? "").trim().slice(0, 80) || "New folder" };
  workspace.folders.push(folder);
  return folder;
}

export function renameFolder(workspace, folderId, name) {
  const folder = workspace.folders.find((candidate) => candidate.id === folderId);
  if (folder) folder.name = String(name ?? "").trim().slice(0, 80) || folder.name;
}

// Deleting a folder never deletes its charts: they're left in no folder.
export function deleteFolder(workspace, folderId) {
  workspace.folders = workspace.folders.filter((folder) => folder.id !== folderId);
  settleChartFolders(workspace);
}

export function moveChartToFolder(workspace, chartId, folderId) {
  const chart = workspace.charts.find((candidate) => candidate.id === chartId);
  if (!chart) return;
  if (folderId && workspace.folders.some((folder) => folder.id === folderId)) chart.folderId = folderId;
  else delete chart.folderId;
  // It joins the end of its new group.
  workspace.charts = [...workspace.charts.filter((candidate) => candidate !== chart), chart];
}

// Moves a chart one place up (-1) or down (1) among the charts beside it, in its folder or in none.
export function shiftChart(workspace, chartId, direction) {
  const chart = workspace.charts.find((candidate) => candidate.id === chartId);
  if (!chart) return;
  const group = workspace.charts.filter((candidate) => (candidate.folderId ?? "") === (chart.folderId ?? ""));
  const neighbour = group[group.indexOf(chart) + direction];
  if (!neighbour) return;
  const charts = workspace.charts;
  const a = charts.indexOf(chart);
  const b = charts.indexOf(neighbour);
  [charts[a], charts[b]] = [charts[b], charts[a]];
}

export function shiftFolder(workspace, folderId, direction) {
  const index = workspace.folders.findIndex((folder) => folder.id === folderId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= workspace.folders.length) return;
  [workspace.folders[index], workspace.folders[target]] = [workspace.folders[target], workspace.folders[index]];
}

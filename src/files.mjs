// Imports from files the player chooses, and exports downloaded through the host's save dialog.
import { exportFile, featuresToCsv, importChartData, parseCoordinateViewer } from "./model.mjs";
import { showToast } from "./dom.mjs";
import { activeChart, commit, persist, resetHistory, workspace } from "./state.mjs";
import { fitData } from "./render.mjs";
import { renderEverything } from "./panels.mjs";

export function importTrackText(text) {
  const points = parseCoordinateViewer(text);
  commit((chart) => { chart.track.push(...points); });
  fitData();
  showToast(`Imported ${points.length} track position${points.length === 1 ? "" : "s"}.`);
}

export async function importTrackFile(file) {
  importTrackText(await readFile(file));
}

export async function importChartFile(file) {
  const imported = importChartData(JSON.parse(await readFile(file)), file?.name?.replace(/\.json$/i, ""));
  workspace.charts.push(...imported);
  workspace.activeChartId = imported[0].id;
  resetHistory();
  persist();
  renderEverything();
  fitData();
  showToast(`Imported ${imported.length} chart${imported.length === 1 ? "" : "s"}.`);
}

export function exportActiveChart() {
  const chart = activeChart();
  download(`${safeFilename(chart.name)}.json`, JSON.stringify(exportFile([chart]), null, 2), "application/json");
  showToast("Chart exported.");
}

export function exportLocationsCsv() {
  download(`${safeFilename(activeChart().name)}-locations.csv`, featuresToCsv(activeChart().features), "text/csv;charset=utf-8");
  showToast("Location list exported.");
}

export function exportWorkspace() {
  download(`sailwind-chartroom-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportFile(workspace.charts), null, 2), "application/json");
  showToast(`Backed up ${workspace.charts.length} chart${workspace.charts.length === 1 ? "" : "s"}.`);
}

async function readFile(file) {
  return file ? file.text() : "";
}

function download(name, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFilename(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "sailwind-chart";
}

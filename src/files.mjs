// Imports from files the player chooses, and exports written through the host's save dialog.
import { exportFile, featuresToCsv, importChartData, importScrambledSeas, parseCoordinateViewer } from "./model.mjs";
import { parseScrambledSeasXml } from "./scrambled-seas.mjs";
import { showToast } from "./dom.mjs";
import { activeChart, commit, host, persist, resetHistory, workspace } from "./state.mjs";
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

// Chartroom files, web map exports and Scrambled Seas worlds, which are XML.
export async function importChartFile(file) {
  const text = await readFile(file);
  const imported = text.trimStart().startsWith("<")
    ? [importScrambledSeas(parseScrambledSeasXml(text))]
    : importChartData(JSON.parse(text), file?.name?.replace(/\.json$/i, ""));
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
  host.exportFile(`${safeFilename(chart.name)}.json`, JSON.stringify(exportFile([chart]), null, 2), "application/json");
  showToast("Chart exported.");
}

export function exportLocationsCsv() {
  host.exportFile(`${safeFilename(activeChart().name)}-locations.csv`, featuresToCsv(activeChart().features), "text/csv;charset=utf-8");
  showToast("Location list exported.");
}

export function exportWorkspace() {
  host.exportFile(`sailwind-chartroom-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportFile(workspace.charts), null, 2), "application/json");
  showToast(`Backed up ${workspace.charts.length} chart${workspace.charts.length === 1 ? "" : "s"}.`);
}

async function readFile(file) {
  return file ? file.text() : "";
}

function safeFilename(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "sailwind-chart";
}

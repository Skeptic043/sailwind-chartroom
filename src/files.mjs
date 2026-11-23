// Imports from files the player chooses, and exports written through the host's save dialog.
import { exportFile, featuresToCsv, importChartData, importScrambledSeas, isVoyageRecorderText, parseTrackText, readVoyageRecorder } from "./model.mjs";
import { parseScrambledSeasXml } from "./scrambled-seas.mjs";
import { addRecordingExtras, applyMarks, discoveredMarks } from "./discoveries.mjs";
import { showToast } from "./dom.mjs";
import { activeChart, commit, host, persist, resetHistory, revealLayer, workspace } from "./state.mjs";
import { fitData } from "./render.mjs";
import { renderEverything } from "./panels.mjs";

export function importTrackText(text) {
  // A save slot's log can hold earlier games; only the latest is imported.
  const voyage = isVoyageRecorderText(text) ? readVoyageRecorder(text, undefined, { latestGame: true }) : null;
  const points = voyage ? voyage.points : parseTrackText(text);
  if (!points.length && !voyage?.ports.length && !voyage?.landfalls.length && !voyage?.missions.length && !voyage?.notes.length) throw new Error("No valid recorded positions were found.");
  if (voyage?.keys) workspace.settings.recorderKeys = voyage.keys;
  commit((chart) => {
    for (const point of points) chart.track.push(point);
    if (points.length) revealLayer(chart, "track", points[0]);
    // Ports, landfalls and missions become marks too, as when following the recording.
    if (!voyage) return;
    const marks = discoveredMarks(chart, voyage, { clearReached: workspace.settings.clearReachedAreas });
    applyMarks(chart, marks);
    for (const feature of marks.features) revealLayer(chart, "feature", feature);
    for (const search of marks.searches) revealLayer(chart, "search", search);
    addRecordingExtras(chart, voyage, {
      add: (key, items) => chart[key].push(...items),
      setRecording: (recording) => { chart.recording = recording; }
    });
  });
  fitData();
  const skipped = voyage?.newGames ?? 0;
  const earlier = skipped ? ` Skipped ${skipped} earlier game${skipped === 1 ? "" : "s"} in this file.` : "";
  showToast(`Imported ${points.length} track position${points.length === 1 ? "" : "s"}.${earlier}`);
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

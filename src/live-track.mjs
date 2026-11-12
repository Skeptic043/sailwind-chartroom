// Follows Coordinate Viewer as it records: the desktop host watches the file and sends each new line.
import { parseCoordinateViewer } from "./model.mjs";
import { elements, showToast } from "./dom.mjs";
import { activeChart, appendOutsideHistory, host, persist, workspace } from "./state.mjs";
import { centerOn } from "./render.mjs";
import { renderEverything } from "./panels.mjs";

// The chart that receives the positions, kept when another chart is opened meanwhile.
let followedChartId = null;
let fileName = "";
let awaitingFirst = false;

export function initLiveTrack() {
  if (!host.liveTrack) return;
  elements["follow-track"].hidden = false;
  elements["follow-track"].addEventListener("click", () => {
    if (followedChartId) host.stopTrack();
    else host.followTrack(activeChart().id);
  });
  // The host keeps the chart, so a reloaded page carries on into the same one.
  host.on("track-following", ({ name, chartId, resumed }) => {
    followedChartId = String(chartId ?? "");
    awaitingFirst = resumed !== true;
    fileName = String(name ?? "");
    const chart = workspace.charts.find((candidate) => candidate.id === followedChartId);
    if (chart && !chart.layers.track) {
      chart.layers.track = true;
      persist();
      renderEverything();
    }
    renderButton();
    if (resumed !== true) showToast(`Following ${fileName}. New Coordinate Viewer positions join this chart as you sail.`);
  });
  host.on("track-stopped", () => {
    followedChartId = null;
    renderButton();
    showToast("Stopped following Coordinate Viewer.");
  });
  host.on("track-lines", ({ text }) => addPositions(text));
}

// Live positions stay out of undo, so sailing never buries an edit, and save through the host's
// usual delayed write. The chart redraws once for each batch the host sends.
function addPositions(text) {
  const chart = workspace.charts.find((candidate) => candidate.id === followedChartId);
  // Its chart was deleted, so there is nowhere left to put the positions.
  if (!chart) return host.stopTrack();
  let points;
  try {
    points = parseCoordinateViewer(text);
  } catch {
    return;
  }
  appendOutsideHistory(chart, "track", points);
  chart.updatedAt = new Date().toISOString();
  persist();
  if (chart !== activeChart()) return;
  renderEverything();
  // The chart opens on where the boat is when following starts.
  if (awaitingFirst) {
    awaitingFirst = false;
    centerOn(points.at(-1));
  }
}

function renderButton() {
  elements["follow-track"].textContent = followedChartId ? `Stop following ${fileName}` : "Follow live";
  elements["follow-track"].classList.toggle("active", Boolean(followedChartId));
}

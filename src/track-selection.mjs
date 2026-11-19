// Two or more selected Coordinate Viewer positions: their distance and average speed in the track
// position inspector, and Save route, which keeps them as a saved route. Two positions either side of a gap
// can be connected from the Connect track panel under the tools, making the stretches one.
import { formatDuration, makeId, milesPerGameHour, revealLayer } from "./model.mjs";
import { besideGap, connectionBetween, sailedStats, trackToRoutePoints } from "./track.mjs";
import { formatNm } from "./format.mjs";
import { elements, showToast } from "./dom.mjs";
import { activeChart, commit, replaceSelectionState, selectedRefs } from "./state.mjs";

export function initTrackSelection() {
  elements["track-to-route"].addEventListener("click", trackSelectionToRoute);
  elements["track-connect"].addEventListener("click", connectSelection);
}

// Shown for a position beside a gap, saying how to pick the other side, and for two selected positions,
// saying why they can't be connected when they can't.
export function renderTrackConnect() {
  const chart = activeChart();
  const points = selectedTrackPoints(chart);
  const single = points.length === 1 && selectedRefs().length === 1 && besideGap(chart.track, points[0]);
  const shown = single || (points.length === 2 && selectedRefs().length === 2);
  elements["track-connect-panel"].hidden = !shown;
  if (!shown) return;
  const connection = single ? {} : connectionBetween(chart.track, points);
  elements["track-connect"].disabled = !connection.after;
  elements["track-connect-detail"].textContent = single
    ? "This position is beside a gap in your track. Shift-click the position on the other side to connect them."
    : connection.after
    ? "Joins the two stretches of track into one, marked with a ring where they meet."
    : connection.reason;
}

function connectSelection() {
  const chart = activeChart();
  const { after } = connectionBetween(chart.track, selectedTrackPoints(chart));
  if (!after) return;
  const id = after.id;
  commit((target) => {
    const point = target.track.find((candidate) => candidate.id === id);
    if (point) point.joinPrevious = true;
  });
  showToast("Connected. Select the ringed position to take the connection out again.");
}

function selectedTrackPoints(chart) {
  const ids = new Set(selectedRefs().filter((ref) => ref.kind === "track").map((ref) => ref.id));
  return chart.track.filter((point) => ids.has(point.id));
}

export function renderTrackSelection() {
  const chart = activeChart();
  const points = selectedTrackPoints(chart);
  elements["track-selection"].hidden = points.length < 2;
  if (points.length < 2) return;
  const stats = sailedStats(points);
  // Miles per game hour back to knots on the chip log, whatever the game clock's speed.
  const averageKn = stats.movingHours ? stats.averageKn / milesPerGameHour(chart, 1) : null;
  elements["track-selection-detail"].textContent = [
    `${points.length} positions · ${formatNm(stats.distanceNm)} nm sailed`,
    stats.movingHours ? `Time sailed: ${formatDuration(stats.movingHours)} · Average speed: ${averageKn.toFixed(1)} kn` : "No times recorded"
  ].join("\n");
}

function trackSelectionToRoute() {
  const tolerance = elements["track-route-tolerance"].valueAsNumber;
  const points = trackToRoutePoints(selectedTrackPoints(activeChart()), tolerance > 0 ? tolerance : 2);
  if (points.length < 2) {
    showToast("The selected positions are too close to save as a route.", true);
    return;
  }
  commit((chart) => {
    const route = { id: makeId("saved-route"), name: `Route ${chart.savedRoutes.length + 1}`, createdAt: new Date().toISOString(), hidden: false, points };
    chart.savedRoutes.push(route);
    revealLayer(chart, "saved-point", points[0]);
    replaceSelectionState("saved-route", route.id);
  });
  showToast(`Saved a route with ${points.length} waypoints from your selected positions.`);
}

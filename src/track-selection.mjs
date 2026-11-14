// Two or more selected Coordinate Viewer positions: their distance and average speed in the track
// position inspector, and Save route, which keeps them as a saved route.
import { formatDuration, makeId, revealLayer } from "./model.mjs";
import { sailedStats, trackToRoutePoints } from "./track.mjs";
import { formatNm } from "./format.mjs";
import { elements, showToast } from "./dom.mjs";
import { activeChart, commit, replaceSelectionState, selectedRefs } from "./state.mjs";

export function initTrackSelection() {
  elements["track-to-route"].addEventListener("click", trackSelectionToRoute);
}

function selectedTrackPoints(chart) {
  const ids = new Set(selectedRefs().filter((ref) => ref.kind === "track").map((ref) => ref.id));
  return chart.track.filter((point) => ids.has(point.id));
}

export function renderTrackSelection() {
  const points = selectedTrackPoints(activeChart());
  elements["track-selection"].hidden = points.length < 2;
  if (points.length < 2) return;
  const stats = sailedStats(points);
  elements["track-selection-detail"].textContent = [
    `${points.length} positions · ${formatNm(stats.distanceNm)} nm sailed`,
    stats.movingHours ? `Time sailed: ${formatDuration(stats.movingHours)} · Average speed: ${stats.averageKn.toFixed(1)} kn` : "No times recorded"
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

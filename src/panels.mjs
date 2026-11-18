// Renders the side panels: chart header, layers, route summary, inspectors and the chart item list.
import { anchorTarget, isEncounter, bearingDegrees, chartItemFocusPoint, distanceNm, formatCoordinate, formatDuration, isLocked, savedRouteForPoint, searchExtent, summarizeRoute } from "./model.mjs";
import { assignedIsland, islandById, searchIsland, visibleIsland } from "./islands.mjs";
import { assignedBoats } from "./boats.mjs";
import { formatBearing, formatDirection, formatLeg, formatNm, plainDegrees } from "./format.mjs";
import { elements } from "./dom.mjs";
import { activeChart, isSelected, live, selectItem, selectedItem, selectedKeys, selectedRefs, selection, updateUndoButtons, workspace } from "./state.mjs";
import { centerOn, drawChart } from "./render.mjs";
import { renderDeadReckoning } from "./dead-reckoning-panel.mjs";
import { renderTrackConnect, renderTrackSelection } from "./track-selection.mjs";
import { latestPosition, positionLabel } from "./dead-reckoning.mjs";
import { formatGameTime } from "./gametime.mjs";
import { LOCATION_ICONS } from "./icons.mjs";
import { readingKnowledge } from "./equipment.mjs";
import { renderEquipment } from "./equipment-panel.mjs";
import { placeFloating, renderOverlay } from "./overlay.mjs";
import { renderTrackKey } from "./track-key.mjs";
import { chartGroups } from "./folders.mjs";
import { renderCompare } from "./compare.mjs";

export function renderEverything() {
  renderHeader();
  renderShortcuts();
  renderLayerControls();
  renderRouteSummary();
  renderInspector();
  renderFeatureList();
  renderDeadReckoning();
  renderEquipment();
  renderOverlay();
  renderTrackKey();
  renderCompare();
  updateUndoButtons();
  drawChart();
}

// Tool buttons and the help list show whatever keys Settings assigns.
function renderShortcuts() {
  const { shortcuts } = workspace.settings;
  for (const button of document.querySelectorAll(".tool-grid .tool")) {
    const key = shortcuts[button.dataset.mode]?.toUpperCase() ?? "";
    button.querySelector("b").textContent = key;
    button.title = `${button.querySelector("span").textContent} (${key})`;
  }
  for (const kbd of document.querySelectorAll("kbd[data-shortcut]")) kbd.textContent = shortcuts[kbd.dataset.shortcut]?.toUpperCase() ?? "";
}

// The Active chart menu: top-level charts first, then each folder's charts under its name.
function renderHeader() {
  const option = (chart) => {
    const element = document.createElement("option");
    element.value = chart.id;
    element.textContent = chart.seed ? `${chart.name} · seed ${chart.seed}` : chart.name;
    element.selected = chart.id === workspace.activeChartId;
    return element;
  };
  elements["chart-select"].replaceChildren(...chartGroups(workspace).flatMap(({ folder, charts }) => {
    if (!folder) return charts.map(option);
    if (!charts.length) return [];
    const group = document.createElement("optgroup");
    group.label = folder.name;
    group.append(...charts.map(option));
    return [group];
  }));
}

// Each View checkbox, its layer, and the layers it sits under. A part keeps its own setting but is
// disabled until everything above it is shown; "a|b" is shown when either is.
export const LAYER_CONTROLS = Object.freeze([
  ["layer-locations", "locations", []],
  ["layer-location-islands", "locationIslands", ["locations", "islands"]],
  ["layer-routes", "routes", []],
  ["layer-distances", "routeDistances", ["routes"]],
  ["layer-saved-routes", "savedRoutes", ["routes"]],
  ["layer-measure", "measure", []],
  ["layer-red-lines", "redLines", ["measure"]],
  ["layer-blue-lines", "blueLines", ["measure"]],
  ["layer-green-lines", "greenLines", ["measure"]],
  ["layer-dead-reckoning", "deadReckoning", []],
  ["layer-areas", "areas", []],
  ["layer-area-islands", "areaIslands", ["areas", "islands"]],
  ["layer-searches", "searches", []],
  ["layer-search-lines", "searchLines", ["searches"]],
  ["layer-search-islands", "searchIslands", ["searches", "islands"]],
  ["layer-winds", "winds", []],
  ["layer-grid", "grid", []],
  ["layer-labels", "labels", []],
  ["layer-boats", "boats", []],
  ["layer-islands", "islands", []],
  ["layer-track", "track", []],
  ["layer-track-lines", "trackLines", ["track"]],
  ["layer-track-cv", "trackCoordinateViewer", ["track"]],
  ["layer-track-voyage", "trackVoyageRecorder", ["track"]],
  ["layer-track-voyage-automatic", "trackVoyageAutomaticLocations", ["track", "trackVoyageRecorder"]],
  ["layer-track-voyage-manual", "trackVoyageManualLocations", ["track", "trackVoyageRecorder"]],
  ["layer-track-winds", "trackWinds", ["track"]],
  ["layer-vanilla", "vanillaMap", []],
  ["layer-imported-map", "importedMap", []],
  // Secret islands are part of whichever map is on.
  ["layer-secrets", "secretIslands", ["vanillaMap|importedMap"]],
  ["layer-trade-winds", "tradeWinds", []],
  ["layer-expanded-winds", "expandedWinds", ["tradeWinds"]]
]);

function renderLayerControls() {
  const chart = activeChart();
  const layers = chart.layers;
  // The imported map is offered only on a chart imported from Scrambled Seas.
  elements["layer-imported-row"].hidden = !chart.scramble;
  // Hidden positions exist only with equipment readings on.
  const shown = (key) => key === "importedMap" ? layers.importedMap && Boolean(chart.scramble) : layers[key];
  for (const [elementId, key, parents] of LAYER_CONTROLS) {
    elements[elementId].checked = layers[key];
    elements[elementId].disabled = parents.some((parent) => !parent.split("|").some(shown));
  }
  elements["clear-track"].disabled = activeChart().track.length === 0;
}

// Shows the active route, or a saved route while it or one of its waypoints is selected.
export function renderRouteSummary() {
  const chart = activeChart();
  const saved = selection?.kind === "saved-route" ? selectedItem()
    : selection?.kind === "saved-point" ? savedRouteForPoint(chart, selection.id) : null;
  const points = saved?.points ?? chart.route;
  const summary = summarizeRoute(points, chart.circumnavigation);
  elements["route-circumnavigation"].checked = chart.circumnavigation;
  // The Route button turns the panel off; while on, it shows with a route.
  const panel = workspace.settings.routePanel;
  elements["show-route-panel"].setAttribute("aria-pressed", String(panel.shown));
  elements["route-summary"].hidden = !panel.shown || points.length === 0;
  elements["route-summary-title"].textContent = saved ? saved.name : "Route";
  elements["route-actions"].hidden = Boolean(saved);
  elements["route-distance"].textContent = `${formatNm(summary.totalNm)} nm`;
  if (document.activeElement !== elements["route-speed"]) elements["route-speed"].value = chart.speedKn;
  elements["route-eta"].textContent = formatDuration(summary.totalNm / chart.speedKn);
  placeFloating(elements["route-summary"], panel);
}

export function renderInspector() {
  const item = selectedItem();
  renderTrackConnect();
  const isFeature = selection?.kind === "feature" && item;
  const isRoute = (selection?.kind === "route" || selection?.kind === "saved-point") && item;
  const isSavedRoute = selection?.kind === "saved-route" && item;
  const isMeasure = (selection?.kind === "measure" || selection?.kind === "line") && item;
  const isSearch = selection?.kind === "search" && item;
  const isWind = selection?.kind === "wind" && item;
  const isTrack = selection?.kind === "track" && item;
  const isMapIsland = selection?.kind === "map-island" && item;
  const isDr = selection?.kind === "dr" && item;
  const isNote = selection?.kind === "note" && item;
  elements["note-inspector"].hidden = !isNote;
  if (isNote) renderNoteInspector(item);
  elements["dr-inspector"].hidden = !isDr;
  if (isDr) renderDrInspector(item);
  elements["empty-inspector"].hidden = Boolean(item);
  elements["feature-inspector"].hidden = !isFeature;
  elements["route-inspector"].hidden = !isRoute;
  elements["saved-route-inspector"].hidden = !isSavedRoute;
  elements["measure-inspector"].hidden = !isMeasure;
  elements["search-inspector"].hidden = !isSearch;
  elements["wind-inspector"].hidden = !isWind;
  elements["track-inspector"].hidden = !isTrack;
  elements["map-island-inspector"].hidden = !isMapIsland;
  if (isMapIsland) {
    elements["map-island-name"].textContent = islandById(item.id)?.name ?? "Island";
    elements["map-island-detail"].textContent = `${formatCoordinate(item.lat, "lat", 3)} · ${formatCoordinate(item.lon, "lon", 3)}`;
    elements["map-island-notes"].value = item.notes;
  }
  if (isTrack) {
    for (const field of ["name", "day", "time", "wind"]) elements[`track-${field}`].value = item[field];
    elements["track-lat"].value = item.lat.toFixed(4);
    elements["track-lon"].value = item.lon.toFixed(4);
    const recorded = recordedDetail(item, readingKnowledge(activeChart(), item));
    elements["track-recorded"].textContent = recorded;
    elements["track-recorded"].hidden = !recorded;
    // With voyages to compare, a recorded position can be where your own voyage's elapsed time starts.
    elements["track-compare-start"].hidden = !(activeChart().comparisons.length && item.source === "voyage" && Number.isFinite(item.t));
    // A connection made with Connect track can be taken out again from its first position after the gap.
    elements["track-join"].hidden = !item.joinPrevious;
    renderTrackSelection();
  }
  if (isMeasure) renderMeasureInspector(item, selection.kind === "line");
  if (isSearch) renderSearchInspector(item);
  if (isWind) {
    elements["wind-label"].value = item.label;
    elements["wind-lat"].value = item.lat.toFixed(4);
    elements["wind-lon"].value = item.lon.toFixed(4);
    elements["wind-direction"].value = formatDirection(item.bearing);
    elements["wind-day"].value = item.day;
    elements["wind-time"].value = item.time;
  }
  if (isFeature) {
    const isArea = item.rangeNm > 0;
    const encounter = isEncounter(item);
    elements["feature-kind"].textContent = isArea ? "Selected rough area" : encounter ? "Selected encounter" : "Selected location";
    elements["feature-title"].textContent = isArea ? "Edit rough area" : encounter ? "Edit encounter" : "Edit location";
    elements["feature-type"].value = isArea ? "area" : "location";
    elements["feature-name"].value = item.name;
    elements["feature-show-name"].checked = item.showName !== false;
    elements["feature-lat"].value = item.lat.toFixed(4);
    elements["feature-lon"].value = item.lon.toFixed(4);
    elements["feature-day"].value = item.day;
    elements["feature-time"].value = item.time;
    elements["feature-range"].value = item.rangeNm || "";
    elements["feature-range-row"].hidden = !isArea;
    elements["feature-icon-row"].hidden = !encounter;
    if (encounter) elements["feature-icon"].value = item.icon;
    // An island's outline is drawn at its real size, so only marks and encounters take a size.
    elements["feature-size-row"].hidden = isArea || Boolean(visibleIsland(item));
    elements["feature-size"].value = item.size ?? "";
    elements["feature-notes"].value = item.notes;
    const island = visibleIsland(item);
    elements["feature-island-status"].textContent = island ? `${island.name}${item.islandId ? "" : " · matched by name"}` : "None";
    renderBoatControls(item, "feature");
    elements["resolve-feature"].hidden = !item.rangeNm;
    const selectedCount = selectedKeys.size;
    elements["feature-selection-note"].hidden = selectedCount <= 1;
    elements["feature-selection-note"].textContent = `${selectedCount} items selected. Coordinate changes move the whole selection; other fields edit this item.`;
    const position = latestPosition(activeChart(), { followingLive: live.following });
    const origin = position ?? activeChart().route.findLast((point) => point.id !== item.id) ?? null;
    elements["feature-navigation"].hidden = !origin;
    if (origin) elements["feature-navigation"].textContent = `From ${position ? `the latest ${positionLabel(position)}` : "the last waypoint"}: ${formatLeg(origin, item)}`;
  }
  if (isRoute) {
    const savedRoute = selection.kind === "saved-point" ? savedRouteForPoint(activeChart(), item.id) : null;
    const points = savedRoute?.points ?? activeChart().route;
    const index = points.findIndex((point) => point.id === item.id);
    elements["route-point-kind"].textContent = savedRoute ? `Waypoint ${index + 1} of ${savedRoute.name}` : "Selected waypoint";
    elements["select-saved-route"].hidden = !savedRoute;
    elements["route-name"].value = item.name;
    elements["route-lat"].value = item.lat.toFixed(4);
    elements["route-lon"].value = item.lon.toFixed(4);
    elements["route-notes"].value = item.notes;
    elements["route-day"].value = item.day;
    elements["route-time"].value = item.time;
    const previous = points[index - 1];
    const next = points[index + 1];
    const details = [];
    const wrap = activeChart().circumnavigation;
    if (previous) details.push(`From previous: ${formatLeg(previous, item, wrap)}`);
    if (next) details.push(`To next: ${formatLeg(item, next, wrap)}`);
    elements["route-leg-detail"].textContent = details.join("\n") || "Add another waypoint to calculate a leg.";
  }
  if (isSavedRoute) renderSavedRouteInspector(item);
  renderLockControls();
}

// Fields that place or shape an item. A locked item keeps them until it is unlocked.
const PLACEMENT_FIELDS = Object.freeze([
  "feature-type", "feature-lat", "feature-lon", "feature-range", "route-lat", "route-lon", "track-lat", "track-lon", "wind-lat", "wind-lon", "wind-direction",
  "search-lat", "search-lon", "search-direction", "search-distance", "search-spread", "search-tolerance", "note-lat", "note-lon"
]);

function renderLockControls() {
  const chart = activeChart();
  const locked = Boolean(selection) && isLocked(chart, selection);
  for (const button of document.querySelectorAll("[data-lock]")) {
    const label = locked ? "Unlock" : "Lock in place";
    button.classList.toggle("active", locked);
    button.setAttribute("aria-pressed", String(locked));
    button.setAttribute("aria-label", label);
    button.title = label;
  }
  for (const id of PLACEMENT_FIELDS) elements[id].disabled = locked;
  elements["resolve-feature"].disabled = locked;
  const refs = selectedRefs().filter((ref) => ref.kind !== "map-island");
  elements["lock-selected"].disabled = !refs.some((ref) => !isLocked(chart, ref));
  elements["unlock-selected"].disabled = !refs.some((ref) => isLocked(chart, ref));
}

function renderNoteInspector(note) {
  elements["note-kind"].textContent = "Selected note";
  elements["note-name"].value = note.name;
  elements["note-size"].value = note.size ?? "";
  elements["note-lat"].value = note.lat.toFixed(4);
  elements["note-lon"].value = note.lon.toFixed(4);
  elements["note-day"].value = note.day;
  elements["note-time"].value = note.time;
  const recorded = recordedDetail(note);
  elements["note-recorded"].textContent = recorded;
  elements["note-recorded"].hidden = !recorded;
}

// Where a DR position is, and the course, speed and time that put it there.
function renderDrInspector(position) {
  elements["dr-label"].value = position.label;
  elements["dr-detail"].textContent = [
    `${formatCoordinate(position.lat, "lat", 3)} · ${formatCoordinate(position.lon, "lon", 3)}`,
    formatGameTime(position.t),
    `Course: ${formatBearing(position.course)} · Speed: ${position.speedKn} kn · Time sailed: ${formatDuration(position.hours)} · Distance: ${formatNm(position.speedKn * position.hours)} nm`,
    `Starting position: ${position.from.label || "a position"}`,
    position.sigmaNm > 0 ? `Possible error: about ${formatNm(position.sigmaNm)} nm, growing by ${position.percent}% of the distance sailed` : ""
  ].filter(Boolean).join("\n");
}

function renderSavedRouteInspector(route) {
  const summary = summarizeRoute(route.points, activeChart().circumnavigation);
  const speed = activeChart().speedKn;
  elements["saved-route-name"].value = route.name;
  elements["saved-route-visible"].checked = !route.hidden;
  elements["saved-route-detail"].textContent = [
    `${route.points.length} waypoint${route.points.length === 1 ? "" : "s"} · ${formatNm(summary.totalNm)} nm`,
    `${formatDuration(summary.totalNm / speed)} at ${speed} kn`
  ].join("\n");
}

function renderMeasureInspector(measure, kept) {
  elements["measure-kind"].textContent = kept ? "Chart line" : "Measure line";
  elements["line-colour-row"].hidden = !kept;
  elements["line-colour"].value = measure.color ?? "";
  elements["keep-measure"].hidden = kept;
  elements["measure-note"].textContent = kept ? "Drag either end to adjust the line." : "Drag either end to adjust the line. Measuring again replaces it unless you keep it.";
  const nm = distanceNm(measure, measure.end);
  const speed = activeChart().speedKn;
  const at = (point) => `${formatCoordinate(point.lat, "lat", 3)} · ${formatCoordinate(point.lon, "lon", 3)}`;
  elements["measure-detail"].textContent = [
    `${formatNm(nm)} nm · ${formatBearing(bearingDegrees(measure, measure.end))}`,
    `Back: ${formatBearing(bearingDegrees(measure.end, measure))}`,
    `${formatDuration(nm / speed)} at ${speed} kn`,
    `From ${at(measure)}`,
    `To ${at(measure.end)}`
  ].join("\n");
}

function renderSearchInspector(search) {
  elements["search-label"].value = search.label;
  elements["search-lat"].value = search.lat.toFixed(4);
  elements["search-lon"].value = search.lon.toFixed(4);
  elements["search-direction"].value = formatDirection(search.bearing);
  elements["search-distance"].value = search.distanceNm;
  elements["search-spread"].value = search.spreadDeg;
  elements["search-tolerance"].value = search.tolerancePct;
  const island = searchIsland(search);
  elements["search-island-status"].textContent = island ? `${island.name}${search.islandId ? "" : " · matched by name"}` : "None";
  renderBoatControls(search, "search");
  const extent = searchExtent(search);
  elements["search-summary"].textContent = [
    `Search ${formatNm(extent.nearNm)}–${formatNm(extent.farNm)} nm out, between ${plainDegrees(extent.fromDeg)} and ${plainDegrees(extent.toDeg)}.`,
    `Up to ${formatNm(extent.widthNm)} nm across at the far edge.`,
    ...(search.anchor ? [`Locked to ${anchorTarget(activeChart(), search.anchor)?.name || "a waypoint"}: moves with it. Type a new origin to unlock.`] : []),
    `Centre: ${formatCoordinate(extent.centre.lat, "lat", 3)} · ${formatCoordinate(extent.centre.lon, "lon", 3)}`
  ].join("\n");
}

function renderBoatControls(item, prefix) {
  const boats = assignedBoats(item);
  elements[`${prefix}-boat-status`].textContent = boats.length === 1 ? `${boats[0].name} · ${boats[0].provider}` : boatNames(boats) || "None";
  elements[`choose-${prefix}-boat`].textContent = boats.length ? "Edit boats" : "Choose boats";
}

function boatNames(boats) {
  return boats.map((boat) => boat.name).join(", ");
}

function withDayTime(detail, item) {
  return item.day || item.time ? `${detail} · ${[item.day && `Day ${item.day}`, item.time].filter(Boolean).join(" ")}` : detail;
}

export function renderFeatureList() {
  const query = elements["feature-search"].value.trim().toLowerCase();
  const filter = elements["item-filter"].value;
  const chart = activeChart();
  const items = [
    ...chart.features.map((item) => {
      const boats = assignedBoats(item);
      const location = item.rangeNm ? `Area · ${formatNm(item.rangeNm)} nm radius` : assignedIsland(item)?.name ?? (item.day ? `Day ${item.day}${item.time ? ` ${item.time}` : ""}` : LOCATION_ICONS[item.icon]?.label ?? "Location");
      return { kind: "feature", item, name: item.name || (item.rangeNm ? "Rough area" : "Location"), detail: boats.length ? `${location} · ${boatNames(boats)}` : location, marker: boats.length ? "⛵" : visibleIsland(item) ? "◈" : item.rangeNm ? "◎" : "●" };
    }),
    ...chart.route.map((item, index) => ({ kind: "route", item, name: item.name || `Waypoint ${index + 1}`, detail: withDayTime("Route waypoint", item), marker: "◆" })),
    ...chart.savedRoutes.map((item) => ({
      kind: "saved-route",
      item,
      name: item.name,
      detail: `Saved route · ${item.points.length} waypoints · ${formatNm(summarizeRoute(item.points, chart.circumnavigation).totalNm)} nm${item.hidden ? " · hidden" : ""}`,
      search: item.points.map((point) => `${point.name} ${point.notes}`).join(" "),
      marker: "◇"
    })),
    ...chart.searches.map((item) => ({ kind: "search", item, name: item.label || "Search area", detail: `${formatDirection(item.bearing)} · ${formatNm(item.distanceNm)} nm${assignedBoats(item).length ? ` · ${boatNames(assignedBoats(item))}` : ""}`, marker: "⌖" })),
    ...chart.measures.map((item) => ({ kind: "measure", item, name: "Measure line", detail: `${formatNm(distanceNm(item, item.end))} nm · ${formatBearing(bearingDegrees(item, item.end))}`, marker: "↔" })),
    ...chart.segments.map((item) => ({ kind: "line", item, name: `Kept ${item.color} line`, detail: `${formatNm(distanceNm(item, item.end))} nm · ${formatBearing(bearingDegrees(item, item.end))}`, marker: "╱" })),
    ...chart.winds.map((item) => ({ kind: "wind", item, name: item.label || "Wind", detail: withDayTime(`Flows toward ${formatDirection(item.bearing)}`, item), marker: "➤" })),
    ...chart.notes.map((item) => ({ kind: "note", item, name: item.name || firstLine(item.text) || "Note", detail: withDayTime("Note", item), search: item.text, marker: "✎" })),
    ...chart.drPositions.map((item) => ({ kind: "dr", item, name: item.label || "DR position", detail: [formatGameTime(item.t), item.sigmaNm > 0 ? `±${formatNm(item.sigmaNm)} nm` : ""].filter(Boolean).join(" · ") || "Dead reckoning", marker: "◓" }))
  ].filter((entry) => (filter === "all" || entry.kind === filter)
    && `${entry.name} ${entry.detail} ${assignedBoats(entry.item).map((boat) => boat.provider).join(" ")} ${entry.item.notes ?? ""} ${entry.search ?? ""}`.toLowerCase().includes(query));
  elements["feature-count"].textContent = chart.features.length + chart.route.length + chart.savedRoutes.length + chart.searches.length + chart.measures.length + chart.segments.length + chart.winds.length + chart.drPositions.length + chart.notes.length;
  elements["feature-list"].replaceChildren(...items.map((entry) => {
    const { kind, item } = entry;
    const focus = chartItemFocusPoint(kind, item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `feature-row kind-${kind}${item.hidden ? " hidden-item" : ""}${isSelected(kind, item.id) ? " selected" : ""}${selection?.kind === kind && selection.id === item.id ? " is-primary" : ""}`;
    button.innerHTML = `<span class="marker"></span><span><strong></strong><small></small></span><span class="coords"></span>`;
    button.querySelector(".marker").textContent = entry.marker;
    button.querySelector("strong").textContent = entry.name;
    button.querySelector("small").textContent = isLocked(chart, { kind, id: item.id }) ? `${entry.detail} · Locked` : entry.detail;
    button.querySelector(".coords").textContent = `${focus.lat.toFixed(1)}°, ${focus.lon.toFixed(1)}°`;
    button.addEventListener("click", (event) => {
      selectItem(kind, item.id, { additive: event.shiftKey });
      if (!event.shiftKey) centerOn(focus);
    });
    return button;
  }));
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "fineprint";
    empty.textContent = query ? "No chart items match this search." : "Your chart items will collect here.";
    elements["feature-list"].append(empty);
  }
}

function firstLine(text) {
  return String(text ?? "").trim().split(/\r?\n/)[0].slice(0, 60);
}

const TRACK_EVENT_TEXT = { start: "Recording started", stop: "Recording stopped", sleep: "Fell asleep", wake: "Woke up", mark: "Location recorded", "race-start": "Race start", "race-checkpoint": "Race checkpoint", "race-finish": "Race finish" };

// What Voyage Recorder noted beside the position: the boat, its course and speed, and why it was noted.
// With equipment readings on, course and speed show only with a compass and a chip log.
function recordedDetail(item, knowledge = { course: true, speed: true }) {
  const course = knowledge.course && Number.isFinite(item.course) ? formatBearing(item.course) : "";
  const speed = knowledge.speed && Number.isFinite(item.knots) ? `${item.knots.toFixed(1)} kn` : "";
  const motion = course && speed ? `${course} at ${speed}` : course || speed;
  const hull = Number.isFinite(item.hull) ? `hull ${item.hull}% damaged` : "";
  return [item.boat, motion, hull, TRACK_EVENT_TEXT[item.event]].filter(Boolean).join(" · ");
}

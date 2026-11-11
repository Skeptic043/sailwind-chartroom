// Renders the side panels: chart header, layers, route summary, inspectors and the chart item list.
import { anchorTarget, bearingFixes, chartItemFocusPoint, formatCoordinate, formatDuration, savedRouteForPoint, searchExtent, summarizeRoute } from "./model.mjs";
import { assignedIsland, searchIsland, visibleIsland } from "./islands.mjs";
import { assignedBoat } from "./boats.mjs";
import { formatBearing, formatDirection, formatLeg, formatNm, plainDegrees } from "./format.mjs";
import { elements } from "./dom.mjs";
import { activeChart, isSelected, selectItem, selectedItem, selectedKeys, selection, updateUndoButtons, workspace } from "./state.mjs";
import { centerOn, drawChart } from "./render.mjs";
import { addLocation } from "./edits.mjs";

export function renderEverything() {
  renderHeader();
  renderShortcuts();
  renderLayerControls();
  renderRouteSummary();
  renderInspector();
  renderFeatureList();
  updateUndoButtons();
  drawChart();
}

// Tool buttons and the help list show whatever keys Settings assigns.
function renderShortcuts() {
  const { shortcuts } = workspace.settings;
  for (const button of document.querySelectorAll(".tool[data-mode]")) {
    const key = shortcuts[button.dataset.mode]?.toUpperCase() ?? "";
    button.querySelector("b").textContent = key;
    button.title = `${button.querySelector("span").textContent} (${key})`;
  }
  for (const kbd of document.querySelectorAll("kbd[data-shortcut]")) kbd.textContent = shortcuts[kbd.dataset.shortcut]?.toUpperCase() ?? "";
}

function renderHeader() {
  elements["chart-select"].replaceChildren(...workspace.charts.map((chart) => {
    const option = document.createElement("option");
    option.value = chart.id;
    option.textContent = chart.seed ? `${chart.name} · seed ${chart.seed}` : chart.name;
    option.selected = chart.id === workspace.activeChartId;
    return option;
  }));
}

function renderLayerControls() {
  const layers = activeChart().layers;
  elements["layer-grid"].checked = layers.grid;
  elements["layer-labels"].checked = layers.labels;
  elements["layer-track"].checked = layers.track;
  elements["layer-distances"].checked = layers.routeDistances;
  elements["layer-bearings"].checked = layers.bearings;
  elements["layer-winds"].checked = layers.winds;
  elements["layer-boats"].checked = layers.boats;
  elements["layer-vanilla"].checked = layers.vanillaMap;
  // Secret islands and trade winds are parts of the vanilla map, so they keep their setting but wait for it.
  for (const [elementId, key] of [["layer-secrets", "secretIslands"], ["layer-trade-winds", "tradeWinds"]]) {
    elements[elementId].checked = layers[key];
    elements[elementId].disabled = !layers.vanillaMap;
  }
  elements["clear-track"].disabled = activeChart().track.length === 0;
  elements["clear-bearings"].disabled = activeChart().bearings.length === 0;
}

// Shows the active route, or a saved route while it or one of its waypoints is selected.
export function renderRouteSummary() {
  const chart = activeChart();
  const saved = selection?.kind === "saved-route" ? selectedItem()
    : selection?.kind === "saved-point" ? savedRouteForPoint(chart, selection.id) : null;
  const points = saved?.points ?? chart.route;
  const summary = summarizeRoute(points);
  elements["route-summary"].hidden = points.length === 0;
  elements["route-summary-title"].textContent = saved ? saved.name : "Route";
  elements["route-actions"].hidden = Boolean(saved);
  elements["route-distance"].textContent = `${formatNm(summary.totalNm)} nm`;
  const nextLeg = summary.legs[0];
  elements["route-bearing"].textContent = nextLeg ? formatBearing(nextLeg.bearing) : "—";
  if (document.activeElement !== elements["route-speed"]) elements["route-speed"].value = chart.speedKn;
  elements["route-eta"].textContent = formatDuration(summary.totalNm / chart.speedKn);
}

export function renderInspector() {
  const item = selectedItem();
  const isFeature = selection?.kind === "feature" && item;
  const isRoute = (selection?.kind === "route" || selection?.kind === "saved-point") && item;
  const isSavedRoute = selection?.kind === "saved-route" && item;
  const isBearing = selection?.kind === "bearing" && item;
  const isSearch = selection?.kind === "search" && item;
  const isWind = selection?.kind === "wind" && item;
  elements["empty-inspector"].hidden = Boolean(item);
  elements["feature-inspector"].hidden = !isFeature;
  elements["route-inspector"].hidden = !isRoute;
  elements["saved-route-inspector"].hidden = !isSavedRoute;
  elements["bearing-inspector"].hidden = !isBearing;
  elements["search-inspector"].hidden = !isSearch;
  elements["wind-inspector"].hidden = !isWind;
  if (isBearing) renderBearingInspector(item);
  if (isSearch) renderSearchInspector(item);
  if (isWind) {
    elements["wind-label"].value = item.label;
    elements["wind-lat"].value = item.lat.toFixed(4);
    elements["wind-lon"].value = item.lon.toFixed(4);
    elements["wind-direction"].value = formatDirection(item.bearing);
  }
  if (isFeature) {
    const isArea = item.rangeNm > 0;
    elements["feature-kind"].textContent = isArea ? "Selected rough area" : "Selected location";
    elements["feature-title"].textContent = isArea ? "Edit rough area" : "Edit location";
    elements["feature-type"].value = isArea ? "area" : "location";
    elements["feature-name"].value = item.name;
    elements["feature-lat"].value = item.lat.toFixed(4);
    elements["feature-lon"].value = item.lon.toFixed(4);
    elements["feature-day"].value = item.day;
    elements["feature-time"].value = item.time;
    elements["feature-range"].value = item.rangeNm || "";
    elements["feature-range-row"].hidden = !isArea;
    elements["feature-notes"].value = item.notes;
    const island = visibleIsland(item);
    elements["feature-island-status"].textContent = island ? `${island.name}${item.islandId ? "" : " · matched by name"}` : "None";
    renderBoatControls(item, "feature");
    elements["resolve-feature"].hidden = !item.rangeNm;
    const selectedCount = selectedKeys.size;
    elements["feature-selection-note"].hidden = selectedCount <= 1;
    elements["feature-selection-note"].textContent = `${selectedCount} items selected. Coordinate changes move the whole selection; other fields edit this item.`;
    const origin = activeChart().track.at(-1) ?? activeChart().route.findLast((point) => point.id !== item.id) ?? null;
    elements["feature-navigation"].hidden = !origin;
    if (origin) elements["feature-navigation"].textContent = `From last fix: ${formatLeg(origin, item)}`;
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
    const previous = points[index - 1];
    const next = points[index + 1];
    const details = [];
    if (previous) details.push(`From previous: ${formatLeg(previous, item)}`);
    if (next) details.push(`To next: ${formatLeg(item, next)}`);
    elements["route-leg-detail"].textContent = details.join("\n") || "Add another waypoint to calculate a leg.";
  }
  if (isSavedRoute) renderSavedRouteInspector(item);
}

function renderSavedRouteInspector(route) {
  const summary = summarizeRoute(route.points);
  const speed = activeChart().speedKn;
  elements["saved-route-name"].value = route.name;
  elements["saved-route-visible"].checked = !route.hidden;
  elements["saved-route-detail"].textContent = [
    `${route.points.length} waypoint${route.points.length === 1 ? "" : "s"} · ${formatNm(summary.totalNm)} nm`,
    `${formatDuration(summary.totalNm / speed)} at ${speed} kn`
  ].join("\n");
}

function renderBearingInspector(bearing) {
  elements["bearing-label"].value = bearing.label;
  elements["bearing-lat"].value = bearing.lat.toFixed(4);
  elements["bearing-lon"].value = bearing.lon.toFixed(4);
  elements["bearing-value"].value = bearing.bearing.toFixed(1);
  const bearings = activeChart().bearings;
  const fixes = bearingFixes(bearings).filter((fix) => fix.ids.includes(bearing.id));
  const rows = fixes.map((fix) => {
    const other = bearings.find((candidate) => candidate.id === fix.ids.find((id) => id !== bearing.id));
    const row = document.createElement("div");
    row.className = "fix-row";
    row.innerHTML = `<span><strong></strong><small></small></span><button type="button">Add location</button>`;
    row.querySelector("strong").textContent = `Crosses ${other.label || formatBearing(other.bearing)}`;
    row.querySelector("small").textContent = `${formatCoordinate(fix.lat, "lat", 3)} · ${formatCoordinate(fix.lon, "lon", 3)} · ${Math.round(fix.cut)}° cut${fix.cut < 30 ? " (weak)" : ""}`;
    row.querySelector("button").addEventListener("click", () => {
      addLocation(fix, bearing.label || other.label || "Bearing fix", { notes: `Fixed by bearings ${formatBearing(bearing.bearing)} and ${formatBearing(other.bearing)}${fix.cut < 30 ? " (weak cut)" : ""}.` });
    });
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "fineprint";
    empty.textContent = "Take another bearing to the same object from a different position to fix it.";
    rows.push(empty);
  }
  elements["bearing-fixes"].replaceChildren(...rows);
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
  const boat = assignedBoat(item);
  elements[`${prefix}-boat-status`].textContent = boat ? `${boat.name} · ${boat.provider}` : "None";
}

export function renderFeatureList() {
  const query = elements["feature-search"].value.trim().toLowerCase();
  const filter = elements["item-filter"].value;
  const chart = activeChart();
  const items = [
    ...chart.features.map((item) => {
      const boat = assignedBoat(item);
      const location = item.rangeNm ? `Area · ${formatNm(item.rangeNm)} nm radius` : assignedIsland(item)?.name ?? (item.day ? `Day ${item.day}${item.time ? ` ${item.time}` : ""}` : "Location");
      return { kind: "feature", item, name: item.name || (item.rangeNm ? "Rough area" : "Location"), detail: boat ? `${location} · ${boat.name}` : location, marker: boat ? "⛵" : visibleIsland(item) ? "◈" : item.rangeNm ? "◎" : "●" };
    }),
    ...chart.route.map((item, index) => ({ kind: "route", item, name: item.name || `Waypoint ${index + 1}`, detail: "Route waypoint", marker: "◆" })),
    ...chart.savedRoutes.map((item) => ({
      kind: "saved-route",
      item,
      name: item.name,
      detail: `Saved route · ${item.points.length} waypoints · ${formatNm(summarizeRoute(item.points).totalNm)} nm${item.hidden ? " · hidden" : ""}`,
      search: item.points.map((point) => `${point.name} ${point.notes}`).join(" "),
      marker: "◇"
    })),
    ...chart.searches.map((item) => ({ kind: "search", item, name: item.label || "Search area", detail: `${formatDirection(item.bearing)} · ${formatNm(item.distanceNm)} nm${assignedBoat(item) ? ` · ${assignedBoat(item).name}` : ""}`, marker: "⌖" })),
    ...chart.bearings.map((item) => ({ kind: "bearing", item, name: item.label || "Bearing", detail: formatBearing(item.bearing), marker: "↗" })),
    ...chart.winds.map((item) => ({ kind: "wind", item, name: item.label || "Wind", detail: `Flows toward ${formatDirection(item.bearing)}`, marker: "➤" }))
  ].filter((entry) => (filter === "all" || entry.kind === filter)
    && `${entry.name} ${entry.detail} ${assignedBoat(entry.item)?.provider ?? ""} ${entry.item.notes ?? ""} ${entry.search ?? ""}`.toLowerCase().includes(query));
  elements["feature-count"].textContent = chart.features.length + chart.route.length + chart.savedRoutes.length + chart.searches.length + chart.bearings.length + chart.winds.length;
  elements["feature-list"].replaceChildren(...items.map((entry) => {
    const { kind, item } = entry;
    const focus = chartItemFocusPoint(kind, item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `feature-row kind-${kind}${item.hidden ? " hidden-item" : ""}${isSelected(kind, item.id) ? " selected" : ""}${selection?.kind === kind && selection.id === item.id ? " is-primary" : ""}`;
    button.innerHTML = `<span class="marker"></span><span><strong></strong><small></small></span><span class="coords"></span>`;
    button.querySelector(".marker").textContent = entry.marker;
    button.querySelector("strong").textContent = entry.name;
    button.querySelector("small").textContent = entry.detail;
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

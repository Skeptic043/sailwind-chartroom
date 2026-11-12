// Draws the chart canvas and moves its view. Tool previews are drawn by interaction.mjs through setOverlay().
import { mapPalette, paperTile } from "./theme.mjs";
import { MAX_ZOOM, MIN_ZOOM, NM_PER_DEGREE, WORLD_BOUNDS, bearingDegrees, clusteredLabelIds, destinationPoint, distanceNm, formatDuration, searchChartLabel, searchEvidenceOpacity, searchExtent, searchIconAnchors, searchNameLabelIds, searchOverlapGroups, shownItems, summarizeRoute, tradeWindAt } from "./model.mjs";
import { islandWorldBounds } from "./islands.mjs";
import { VANILLA_MAP, importedMapIslands } from "./scrambled-seas.mjs";
import { boatMarkerSize, drawBoatSilhouette, visibleBoat } from "./boats.mjs";
import { clamp, formatBearing, formatDirection, formatNm, isNightTime, nearlyMultiple, shortCoordinate } from "./format.mjs";
import { canvas, context, elements } from "./dom.mjs";
import { activeChart, isSelected, persist } from "./state.mjs";
import { boatIconBounds, boatIconBoundsAt, chartIsland, chartSearchIsland, islandPixelSpan, screenToWorld, symbolSize, worldToScreen } from "./viewport.mjs";

let visibleChartLabels = new Set();

export function resizeCanvas() {
  const rectangle = canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.max(1, Math.round(rectangle.width * scale));
  canvas.height = Math.max(1, Math.round(rectangle.height * scale));
  context.setTransform(scale, 0, 0, scale, 0, 0);
  drawChart();
}

function labelKey(kind, id) {
  return `${kind}:${id}`;
}

function labelVisible(kind, id) {
  return visibleChartLabels.has(labelKey(kind, id));
}

function chartLabelCandidates() {
  const chart = activeChart();
  const candidates = [];
  const searches = shownItems(chart, "search");
  const namedSearchLabels = searchNameLabelIds(searches);
  const searchAnchors = searchIconAnchors(searches);
  context.font = LABEL_FONT;
  // below is how far under its point a label's top edge is drawn; a search's name sits above its centre.
  const add = (kind, id, name, point, selected = false, priority = 10, below = 12) => {
    if (!name || !point) return;
    const screen = worldToScreen(point);
    candidates.push({ id: labelKey(kind, id), name, x: screen.x, y: screen.y + below, width: context.measureText(name).width, selected, priority });
  };
  // The player's own names come first; a vanilla name shows only where it has room.
  for (const { island, centre, item } of vanillaIslands()) if (!island.partOf) add(item ? "imported" : "vanilla", island.id, island.name, centre, false, 60);
  for (const feature of shownItems(chart, "feature")) if (feature.showName !== false) add("feature", feature.id, feature.name, feature, isSelected("feature", feature.id), 0);
  for (const search of searches) {
    const selected = isSelected("search", search.id);
    if (search.label && !namedSearchLabels.has(search.id) && !selected) continue;
    add("search", search.id, search.label || "Search area", searchAnchors.get(search.id) ?? searchExtent(search).centre, selected, 0, -24);
  }
  for (const point of shownItems(chart, "route")) add("route", point.id, point.name, point, isSelected("route", point.id), 30);
  for (const route of shownItems(chart, "saved-route")) {
    const active = isSelected("saved-route", route.id) || route.points.some((point) => isSelected("saved-point", point.id));
    for (const point of route.points) add("saved-point", point.id, point.name, point, isSelected("saved-point", point.id), 35);
    if (active && chart.layers.routeDistances) summarizeRoute(route.points).legs.forEach((leg, index) => {
      add("saved-leg", `${route.id}:${index}`, "Route distance", { lat: (leg.from.lat + leg.to.lat) / 2, lon: (leg.from.lon + leg.to.lon) / 2 }, false, 40);
    });
  }
  summarizeRoute(shownItems(chart, "route")).legs.forEach((leg, index) => {
    if (!chart.layers.routeDistances) return;
    add("route-leg", index, "Route distance", { lat: (leg.from.lat + leg.to.lat) / 2, lon: (leg.from.lon + leg.to.lon) / 2 }, false, 40);
  });
  if (chart.layers.winds) for (const wind of chart.winds) add("wind", wind.id, wind.label, wind, isSelected("wind", wind.id));
  if (chart.layers.track && chart.track.length) add("track", "last", "Last fix", chart.track.at(-1));
  return candidates;
}


let overlay = () => {};

export function boatColours(palette, selected) {
  return selected
    ? { stroke: palette.boatSelected, fill: palette.boatSelectedFill, sailFill: palette.boatSelectedSail }
    : { stroke: palette.boat, fill: palette.boatFill, sailFill: palette.boatSail };
}
const MIN_VISIBLE_ISLAND_PX = 5;
// Zoom at which the paper tile shows at its own size; it scales with the chart within limits around it.
const PAPER_NATIVE_ZOOM = 35;

// Lets the active tool draw its preview above the chart on every redraw.
export function setOverlay(draw) {
  overlay = draw;
}

export function drawChart() {
  const rectangle = canvas.getBoundingClientRect();
  const width = rectangle.width;
  const height = rectangle.height;
  if (!width || !height) return;
  const palette = mapPalette();
  visibleChartLabels = clusteredLabelIds(chartLabelCandidates());

  const gradient = context.createRadialGradient(width * .45, height * .4, 0, width * .45, height * .4, Math.max(width, height));
  gradient.addColorStop(0, palette.paperA);
  gradient.addColorStop(1, palette.paperB);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  // The Sailwind paper is anchored to the chart, so it pans and zooms with the lines and marks.
  const tile = paperTile();
  if (tile) {
    const pattern = context.createPattern(tile, "repeat");
    const origin = worldToScreen({ lat: 0, lon: 0 });
    // Limited so the paper never blurs to blobs close in or turns to noise far out; past the limits it pans but stops scaling.
    const scale = clamp(activeChart().view.zoom / PAPER_NATIVE_ZOOM, 0.2, 6);
    pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, origin.x, origin.y]));
    context.save();
    context.globalAlpha = palette.texture;
    context.fillStyle = pattern;
    context.fillRect(0, 0, width, height);
    context.restore();
  }
  if (activeChart().layers.grid) drawGrid(width, height, palette);
  drawWorldBorder(palette);
  if (activeChart().layers.tradeWinds) {
    // As faint as the vanilla map, so the arrows sit beneath the chart's own marks.
    context.save();
    context.globalAlpha = 0.55;
    drawTradeWinds(width, height, palette);
    context.restore();
  }
  drawVanillaMap(width, height, palette);
  drawLines(palette);
  drawAreas(palette);
  drawSearches(palette);
  if (activeChart().layers.winds) drawWinds(palette);
  drawSavedRoutes(palette);
  drawRoute(palette);
  // Coordinate Viewer positions sit above route lines, which often run along them.
  if (activeChart().layers.track) drawTrack(palette);
  drawFeatures(palette);
  overlay(palette);
  drawCompassRose(width - 56, height - 64, palette);
  updateZoomLabel();
}

function drawGrid(width, height, palette) {
  const zoom = activeChart().view.zoom;
  const candidates = [.01, .02, .05, .1, .25, .5, 1, 2, 5, 10, 20, 30, 45];
  const step = candidates.find((candidate) => candidate * zoom >= 64) ?? 45;
  const fineStep = step / (step === .25 ? 5 : step === 30 || step === 45 ? 3 : 2);
  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(width, height);
  const startLon = Math.ceil(topLeft.lon / fineStep) * fineStep;
  const endLon = bottomRight.lon;
  const startLat = Math.ceil(bottomRight.lat / fineStep) * fineStep;
  const endLat = topLeft.lat;
  context.save();
  context.textBaseline = "top";
  for (let lon = startLon; lon <= endLon + .0001; lon += fineStep) {
    const x = worldToScreen({ lat: 0, lon }).x;
    const major = nearlyMultiple(lon, step);
    context.strokeStyle = major ? palette.grid : palette.fine;
    context.lineWidth = major ? 1 : .7;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    if (major && activeChart().layers.labels) gridLabel(shortCoordinate(lon, "lon", step), x + 5, 6, palette);
  }
  for (let lat = startLat; lat <= endLat + .0001; lat += fineStep) {
    const y = worldToScreen({ lat, lon: 0 }).y;
    const major = nearlyMultiple(lat, step);
    context.strokeStyle = major ? palette.grid : palette.fine;
    context.lineWidth = major ? 1 : .7;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
    if (major && activeChart().layers.labels) gridLabel(shortCoordinate(lat, "lat", step), 6, y + 5, palette);
  }
  context.restore();
}

// Grid labels sit on a dark halo so they stay readable over lines and marks.
function gridLabel(text, x, y, palette) {
  context.font = "600 12.5px ui-sans-serif, system-ui";
  context.lineWidth = 3.5;
  context.lineJoin = "round";
  context.strokeStyle = palette.paperB;
  context.strokeText(text, x, y);
  context.fillStyle = palette.ink;
  context.fillText(text, x, y);
}

function drawWorldBorder(palette) {
  const northwest = worldToScreen({ lat: WORLD_BOUNDS.maxLat, lon: WORLD_BOUNDS.minLon });
  const southeast = worldToScreen({ lat: WORLD_BOUNDS.minLat, lon: WORLD_BOUNDS.maxLon });
  context.save();
  context.strokeStyle = palette.faded;
  context.lineWidth = 2;
  context.setLineDash([8, 7]);
  context.strokeRect(northwest.x, northwest.y, southeast.x - northwest.x, southeast.y - northwest.y);
  context.restore();
}

// Kept lines in their own colours. A selected line also shows its distance and bearing.
function drawLines(palette) {
  for (const line of shownItems(activeChart(), "line")) {
    const selected = isSelected("line", line.id);
    const a = worldToScreen(line);
    const b = worldToScreen(line.end);
    context.save();
    context.strokeStyle = palette.lines[line.color];
    context.fillStyle = palette.lines[line.color];
    context.lineWidth = selected ? 3 : 2;
    context.lineCap = "round";
    drawLine(a, b);
    if (selected) {
      for (const end of [a, b]) { context.beginPath(); context.arc(end.x, end.y, 4.5, 0, Math.PI * 2); context.fill(); }
      selectionHalo(a, palette);
      selectionHalo(b, palette);
    }
    context.restore();
    if (selected) lineLabel(line, line.end, palette);
  }
}

function drawTrack(palette) {
  const track = activeChart().track;
  if (!track.length) return;
  context.save();
  context.strokeStyle = palette.track;
  context.lineWidth = 1.5;
  context.setLineDash([3, 5]);
  drawPolyline(track);
  context.setLineDash([]);
  for (const point of track) {
    const screen = worldToScreen(point);
    context.fillStyle = isNightTime(point.time) ? palette.night : palette.track;
    context.beginPath();
    context.arc(screen.x, screen.y, 2.2, 0, Math.PI * 2);
    context.fill();
    if (isSelected("track", point.id)) selectionHalo(screen, palette);
  }
  const last = track.at(-1);
  const previous = track.at(-2);
  const screen = worldToScreen(last);
  context.translate(screen.x, screen.y);
  context.rotate(previous ? bearingDegrees(previous, last) * Math.PI / 180 : 0);
  context.fillStyle = palette.track;
  context.strokeStyle = palette.paperB;
  context.lineWidth = 1.5;
  context.beginPath(); context.moveTo(0, -9); context.lineTo(6, 7); context.lineTo(0, 4); context.lineTo(-6, 7); context.closePath();
  context.fill(); context.stroke();
  context.restore();
  if (activeChart().layers.labels && labelVisible("track", "last")) labelText(`Last fix${last.day ? ` · day ${last.day}` : ""}${last.time ? ` ${last.time}` : ""}`, screen.x, screen.y + 11, palette);
}

function drawAreas(palette) {
  context.save();
  for (const feature of shownItems(activeChart(), "feature")) {
    if (feature.rangeNm) drawAreaCircle(feature, feature.rangeNm, isSelected("feature", feature.id), palette);
  }
  context.restore();
}

export function drawAreaCircle(center, rangeNm, selected, palette) {
  const screen = worldToScreen(center);
  context.beginPath();
  context.arc(screen.x, screen.y, rangeNm / NM_PER_DEGREE * activeChart().view.zoom, 0, Math.PI * 2);
  context.fillStyle = palette.areaFill;
  context.fill();
  context.strokeStyle = selected ? palette.select : palette.accent;
  context.lineWidth = selected ? 2 : 1.4;
  context.setLineDash([6, 4]);
  context.stroke();
  context.setLineDash([]);
}

function drawSearches(palette) {
  const searches = shownItems(activeChart(), "search");
  const namedLabels = searchNameLabelIds(searches);
  const groups = searchOverlapGroups(searches);
  const overlapping = new Set(groups.flatMap((group) => group.map((search) => search.id)));
  const anchors = searchIconAnchors(searches);
  // The shared island is whichever one the group's searches show, whoever carries the name.
  const sharedIslands = new Map(groups.flatMap((group) => {
    const island = group.map(chartSearchIsland).find(Boolean) ?? null;
    return group.map((search) => [search.id, island]);
  }));
  for (const group of groups) drawSearchOverlap(group);
  for (const search of searches) {
    const selected = isSelected("search", search.id);
    drawSearchWedge(search, selected, palette, searchEvidenceOpacity(overlapping.has(search.id)), namedLabels.has(search.id) || selected, labelVisible("search", search.id), anchors.get(search.id), sharedIslands.get(search.id), activeChart().layers.searchLines);
  }
}

function traceSearchPath(search) {
  const { nearNm, farNm, fromDeg, toDeg } = searchExtent(search);
  const steps = Math.max(2, Math.ceil((toDeg - fromDeg) / 2));
  const arc = (nm, reverse) => Array.from({ length: steps + 1 }, (_, index) => {
    const degrees = reverse ? toDeg - (toDeg - fromDeg) * index / steps : fromDeg + (toDeg - fromDeg) * index / steps;
    return worldToScreen(destinationPoint(search, degrees, nm));
  });
  context.beginPath();
  [...arc(farNm, false), ...arc(nearNm, true)].forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
  context.closePath();
}

function drawSearchOverlap(group) {
  context.save();
  for (const search of group) {
    traceSearchPath(search);
    context.clip();
  }
  context.fillStyle = `rgba(${mapPalette().searchRgb},.34)`;
  const rectangle = canvas.getBoundingClientRect();
  context.fillRect(0, 0, rectangle.width, rectangle.height);
  context.restore();
}

// iconAt moves the island and name off the search's own centre, to where overlapping searches for the
// same place meet; null leaves them to the search that carries them.
export function drawSearchWedge(search, selected, palette, evidenceOpacity = .12, showName = true, showLabel = true, iconAt = undefined, sharedIsland = null, showLine = true) {
  const { nearNm, farNm, fromDeg, toDeg, centre } = searchExtent(search);
  const shared = iconAt !== undefined;
  const previewIsland = iconAt === null ? null : shared ? sharedIsland : chartSearchIsland(search);
  const far = worldToScreen(destinationPoint(search, search.bearing, farNm));
  const origin = worldToScreen(search);
  const middle = worldToScreen(iconAt ?? centre);
  context.save();
  traceSearchPath(search);
  context.fillStyle = `rgba(${palette.searchRgb},${evidenceOpacity})`;
  context.fill();
  context.strokeStyle = selected ? palette.select : palette.bearing;
  context.lineWidth = selected ? 2 : 1.4;
  context.stroke();
  // The line from where the search was heard, ending at the point it was heard from.
  if (showLine) {
    context.setLineDash([4, 6]);
    context.lineWidth = 1;
    context.strokeStyle = palette.faded;
    drawLine(origin, far);
    context.setLineDash([]);
    context.fillStyle = palette.bearing;
    // The point the search was heard from: a small dot that grows a little when zoomed in.
    context.beginPath(); context.arc(origin.x, origin.y, symbolSize("dot"), 0, Math.PI * 2); context.fill();
    if (selected) selectionHalo(origin, palette);
  }
  let previewHeight = 0;
  let previewScale = 1;
  if (previewIsland) {
    const nativeSpan = Math.max(1, islandPixelSpan(previewIsland));
    previewScale = clamp(28 / nativeSpan, 1, 8);
    previewHeight = (previewIsland.bounds.maxLat - previewIsland.bounds.minLat) * activeChart().view.zoom * previewScale;
    context.save();
    context.globalAlpha = .62;
    drawIslandSilhouette(iconAt ?? centre, previewIsland, false, palette, previewScale);
    context.restore();
  }
  let labelOffset = Math.max(14, previewHeight / 2 + 11);
  const boat = activeChart().layers.boats ? visibleBoat(search) : null;
  if (boat) {
    // The boat stays at its own search's centre, beside the island only when the island is there too.
    const bounds = boatIconBoundsAt(centre, shared ? null : previewIsland, previewScale, boat);
    drawBoatSilhouette(context, boat, bounds, {
      ...boatColours(palette, selected),
      lineWidth: selected ? 1.7 : 1.25,
      detail: "marker"
    });
    if (!iconAt) labelOffset = Math.max(labelOffset, worldToScreen(centre).y - (bounds.y - bounds.height / 2) + 8);
  }
  if (activeChart().layers.labels && showLabel) {
    const label = searchChartLabel(search, showName) || `${formatDirection(search.bearing)} · ${formatNm(search.distanceNm)} nm`;
    labelPill(label, middle.x, middle.y - labelOffset, palette);
  }
  context.restore();
}

export function magnetRing(screen, palette) {
  context.save();
  context.strokeStyle = palette.select;
  context.lineWidth = 1.5;
  context.beginPath(); context.arc(screen.x, screen.y, 6, 0, Math.PI * 2); context.stroke();
  context.restore();
}

function drawWinds(palette) {
  for (const wind of activeChart().winds) drawWindIndicator(wind, isSelected("wind", wind.id), palette);
}

const WIND_ARROW_PX = 34;

export function drawWindIndicator(wind, selected, palette) {
  const length = symbolSize("wind");
  const size = length / WIND_ARROW_PX;
  const start = worldToScreen(wind);
  const radians = wind.bearing * Math.PI / 180;
  const end = { x: start.x + Math.sin(radians) * length, y: start.y - Math.cos(radians) * length };
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  context.save();
  context.strokeStyle = selected ? palette.select : palette.track;
  context.fillStyle = selected ? palette.select : palette.track;
  context.lineWidth = (selected ? 2.5 : 2) * Math.max(size, 0.6);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.translate(end.x, end.y);
  context.rotate(angle);
  context.scale(Math.max(size, 0.5), Math.max(size, 0.5));
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(-9, -5);
  context.lineTo(-6, 0);
  context.lineTo(-9, 5);
  context.closePath();
  context.fill();
  context.restore();
  if (selected) selectionHalo(start, palette);
  if (activeChart().layers.labels && wind.label && labelVisible("wind", wind.id)) labelText(wind.label, start.x, start.y + 12, palette);
}

// The measure line, and the one being drawn: distance, bearing and passage time at the chart's speed.
export function drawMeasureLine(from, to, selected, palette) {
  const a = worldToScreen(from);
  const b = worldToScreen(to);
  context.save();
  context.strokeStyle = palette.paperB;
  context.lineWidth = selected ? 5 : 4;
  context.globalAlpha = .55;
  drawLine(a, b);
  context.globalAlpha = 1;
  context.strokeStyle = palette.select;
  context.lineWidth = selected ? 2.5 : 1.75;
  context.setLineDash([7, 5]);
  drawLine(a, b);
  context.setLineDash([]);
  for (const end of [a, b]) {
    context.fillStyle = palette.paperA;
    context.beginPath(); context.arc(end.x, end.y, selected ? 5 : 4, 0, Math.PI * 2); context.fill(); context.stroke();
  }
  context.restore();
  lineLabel(from, to, palette);
}

function lineLabel(from, to, palette) {
  const a = worldToScreen(from);
  const b = worldToScreen(to);
  const speed = activeChart().speedKn;
  const nm = distanceNm(from, to);
  const text = `${formatNm(nm)} nm · ${formatBearing(bearingDegrees(from, to))} · ${formatDuration(nm / speed)} at ${speed} kn`;
  // The label sits beside the middle of the line, on its upper side, far enough out to clear it at any angle.
  context.save();
  context.font = PILL_FONT;
  const halfWidth = context.measureText(text).width / 2 + 6;
  context.restore();
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let normal = { x: (b.y - a.y) / length, y: -(b.x - a.x) / length };
  if (normal.y > 0) normal = { x: -normal.x, y: -normal.y };
  const offset = Math.abs(normal.x) * halfWidth + Math.abs(normal.y) * 9 + 6;
  labelPill(text, (a.x + b.x) / 2 + normal.x * offset, (a.y + b.y) / 2 + normal.y * offset, palette);
}

// Saved routes sit back at reduced opacity until the route or one of its waypoints is selected.
function drawSavedRoutes(palette) {
  for (const route of shownItems(activeChart(), "saved-route")) {
    const routeSelected = isSelected("saved-route", route.id);
    const active = routeSelected || route.points.some((point) => isSelected("saved-point", point.id));
    context.save();
    context.globalAlpha = active ? .95 : .55;
    context.strokeStyle = routeSelected ? palette.select : palette.route;
    context.fillStyle = palette.route;
    context.lineWidth = routeSelected ? 2.5 : 2;
    context.lineJoin = "round";
    drawPolyline(route.points);
    summarizeRoute(route.points).legs.forEach((leg, index) => {
      const from = worldToScreen(leg.from);
      const to = worldToScreen(leg.to);
      if (active) drawArrow(from, to, palette.route);
      if (active && activeChart().layers.routeDistances && labelVisible("saved-leg", `${route.id}:${index}`)) {
        labelPill(`${formatNm(leg.nm)} nm · ${Math.round(leg.bearing)}°`, (from.x + to.x) / 2, (from.y + to.y) / 2 - 12, palette);
      }
    });
    for (const point of route.points) {
      const screen = worldToScreen(point);
      if (isSelected("saved-point", point.id)) selectionHalo(screen, palette);
      context.beginPath();
      context.arc(screen.x, screen.y, symbolSize("dot"), 0, Math.PI * 2);
      context.fill();
      if (point.name && activeChart().layers.labels && labelVisible("saved-point", point.id)) labelText(point.name, screen.x, screen.y + 10, palette);
    }
    context.restore();
  }
}

function drawRoute(palette) {
  const route = shownItems(activeChart(), "route");
  if (!route.length) return;
  context.save();
  context.strokeStyle = palette.route;
  context.fillStyle = palette.route;
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  drawPolyline(route);
  context.font = "bold 10px ui-sans-serif, system-ui";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const summary = summarizeRoute(route);
  summary.legs.forEach((leg, index) => {
    const from = worldToScreen(leg.from);
    const to = worldToScreen(leg.to);
    drawArrow(from, to, palette.route);
    if (activeChart().layers.routeDistances && labelVisible("route-leg", index)) {
      const x = (from.x + to.x) / 2;
      const y = (from.y + to.y) / 2;
      const label = `${formatNm(leg.nm)} nm · ${Math.round(leg.bearing)}°`;
      labelPill(label, x, y - 12, palette);
    }
  });
  route.forEach((point, index) => {
    const screen = worldToScreen(point);
    const selected = isSelected("route", point.id);
    if (selected) selectionHalo(screen, palette);
    context.fillStyle = palette.paperA;
    context.strokeStyle = palette.route;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(screen.x, screen.y, symbolSize("waypoint"), 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = palette.ink;
    // The waypoint number only fits once the waypoint is near full size.
    if (symbolSize("waypoint") >= 4.5) {
      context.font = "bold 8px ui-sans-serif, system-ui";
      context.fillText(String(index + 1), screen.x, screen.y + .5);
    }
    if (point.name && activeChart().layers.labels && labelVisible("route", point.id)) labelText(point.name, screen.x, screen.y + 12, palette);
  });
  context.restore();
}

// The map islands on show: the game's own map, and the chart's imported Scrambled Seas world.
function vanillaIslands() {
  const layers = activeChart().layers;
  return [...(layers.vanillaMap ? VANILLA_MAP : []), ...(layers.importedMap ? importedMapIslands(activeChart()) : [])]
    .filter(({ island }) => layers.secretIslands || !island.secret);
}

// The game's own map, drawn faintly beneath the player's chart. It cannot be selected or edited.
function drawVanillaMap(width, height, palette) {
  context.save();
  context.globalAlpha = 0.55;
  for (const { island, centre, item } of vanillaIslands()) {
    const screen = worldToScreen(centre);
    const selected = item ? isSelected("map-island", item.id) : false;
    if (selected) context.globalAlpha = 1;
    drawIslandSilhouette(centre, island, selected, palette);
    context.globalAlpha = 0.55;
    if (islandPixelSpan(island) < MIN_VISIBLE_ISLAND_PX) {
      context.fillStyle = palette.islandDot;
      context.beginPath();
      context.arc(screen.x, screen.y, symbolSize("mark"), 0, Math.PI * 2);
      context.fill();
    }
    if (activeChart().layers.labels && labelVisible(item ? "imported" : "vanilla", island.id)) labelText(island.name, screen.x, screen.y + 13, palette);
  }
  context.restore();
}

const TRADE_WIND_SPACING_PX = 56;
const TRADE_WIND_ARROW_PX = 22;

function drawTradeWinds(width, height, palette) {
  // One arrow per degree close in; further out the arrows thin to keep their spacing on screen.
  const step = [1, 2, 5, 10, 20].find((degrees) => degrees * activeChart().view.zoom >= TRADE_WIND_SPACING_PX) ?? 30;
  const northwest = screenToWorld(0, 0);
  const southeast = screenToWorld(width, height);
  const first = (value) => Math.floor(value / step) * step + step / 2;
  const latitudes = [];
  for (let lat = first(southeast.lat); lat <= northwest.lat && lat < 90; lat += step) latitudes.push(lat);
  // The Al'Ankh and Emerald winds blow in bands only two and three degrees tall. Once the rows are
  // further apart than that, the bands get a row of their own so they never drop off the chart.
  const rows = step > 2 ? [...latitudes.filter((lat) => lat < 30 || lat > 33), 31] : latitudes;
  const colours = { aestrin: palette.bearing, alankh: palette.accent, emerald: palette.track, southEasterly: palette.route, southWesterly: palette.lines.blue };
  const borderExpander = activeChart().layers.expandedWinds;
  context.lineWidth = 1.5;
  for (let lon = first(northwest.lon); lon <= southeast.lon; lon += step) {
    for (const lat of rows) {
      const wind = tradeWindAt(lat, lon, borderExpander);
      if (!wind) continue;
      context.strokeStyle = colours[wind.zone];
      context.fillStyle = colours[wind.zone];
      const centre = worldToScreen({ lat, lon });
      const half = TRADE_WIND_ARROW_PX / 2;
      context.save();
      context.translate(centre.x, centre.y);
      context.rotate(Math.atan2(-wind.north, wind.east));
      context.beginPath();
      context.moveTo(-half, 0);
      context.lineTo(half, 0);
      context.stroke();
      context.beginPath();
      context.moveTo(half, 0);
      context.lineTo(half - 7, -4);
      context.lineTo(half - 7, 4);
      context.closePath();
      context.fill();
      context.restore();
    }
  }
}

function drawFeatures(palette) {
  for (const feature of shownItems(activeChart(), "feature")) {
    const screen = worldToScreen(feature);
    const selected = isSelected("feature", feature.id);
    const island = chartIsland(feature);
    context.save();
    // A location showing its island needs no yellow mark; the outline is the mark. Far out, where the
    // outline is smaller than a few pixels, a land-coloured dot keeps the island visible.
    if (island) {
      drawIslandSilhouette(feature, island, selected, palette);
      if (islandPixelSpan(island) < MIN_VISIBLE_ISLAND_PX) {
        context.fillStyle = palette.islandDot;
        context.beginPath();
        context.arc(screen.x, screen.y, symbolSize("mark"), 0, Math.PI * 2);
        context.fill();
      }
    } else {
      if (selected) selectionHalo(screen, palette);
      context.strokeStyle = palette.accent;
      context.fillStyle = palette.paperA;
      const markRadius = feature.rangeNm ? 4 : symbolSize("mark");
      context.lineWidth = (selected ? 2.5 : 1.8) * Math.min(1, markRadius / 5);
      context.beginPath();
      context.arc(screen.x, screen.y, markRadius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    const boat = activeChart().layers.boats ? visibleBoat(feature) : null;
    if (boat) {
      const bounds = boatIconBounds(feature);
      // Outlines thicken as a boat grows with its island, so a large boat still reads clearly.
      const weight = clamp(bounds.width / boatMarkerSize(boat).width, 1, 3);
      drawBoatSilhouette(context, boat, bounds, {
        ...boatColours(palette, selected),
        lineWidth: (selected ? 1.7 : 1.25) * weight,
        detail: "marker"
      });
    }
    if (activeChart().layers.labels && labelVisible("feature", feature.id)) labelText(feature.name, screen.x, screen.y + 13, palette);
    context.restore();
  }
}

export function drawIslandSilhouette(feature, island, selected, palette, scale = 1) {
  const fills = palette.islandFills;
  context.save();
  for (const shape of island.shapes) {
    context.beginPath();
    for (const ring of shape.rings) {
      for (let index = 0; index < ring.length; index += 2) {
        const point = worldToScreen({ lat: feature.lat + ring[index + 1] * scale, lon: feature.lon + ring[index] * scale });
        if (index) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y);
      }
      context.closePath();
    }
    context.fillStyle = fills[shape.kind] ?? fills[0];
    context.fill("evenodd");
    context.strokeStyle = selected ? palette.select : shape.kind === 1 ? palette.route : palette.faded;
    context.lineWidth = selected ? 2 : 1;
    context.stroke();
  }
  if (selected) selectionHalo(worldToScreen(feature), palette);
  context.restore();
}

function drawCompassRose(x, y, palette) {
  context.save();
  context.translate(x, y);
  context.strokeStyle = palette.faded;
  context.fillStyle = palette.faded;
  context.lineWidth = 1;
  context.beginPath(); context.arc(0, 0, 24, 0, Math.PI * 2); context.stroke();
  for (let index = 0; index < 8; index += 1) {
    context.rotate(Math.PI / 4);
    context.beginPath(); context.moveTo(0, -19); context.lineTo(0, -24); context.stroke();
  }
  context.beginPath(); context.moveTo(0, -20); context.lineTo(5, 6); context.lineTo(0, 3); context.lineTo(-5, 6); context.closePath(); context.fill();
  context.font = "bold 9px Georgia, serif"; context.textAlign = "center"; context.fillText("N", 0, -30);
  context.restore();
}

function drawPolyline(points) {
  if (points.length < 2) return;
  context.beginPath();
  points.forEach((point, index) => {
    const screen = worldToScreen(point);
    if (index === 0) context.moveTo(screen.x, screen.y);
    else context.lineTo(screen.x, screen.y);
  });
  context.stroke();
}

export function drawLine(a, b) {
  context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
}

function drawArrow(from, to, color) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 42) return;
  const x = (from.x + to.x) / 2;
  const y = (from.y + to.y) / 2;
  const angle = Math.atan2(dy, dx);
  context.save(); context.translate(x, y); context.rotate(angle); context.fillStyle = color;
  context.beginPath(); context.moveTo(7, 0); context.lineTo(-4, -4); context.lineTo(-2, 0); context.lineTo(-4, 4); context.closePath(); context.fill(); context.restore();
}

function selectionHalo(screen, palette) {
  context.save();
  context.strokeStyle = palette.select;
  context.lineWidth = 2;
  context.setLineDash([2, 3]);
  context.beginPath(); context.arc(screen.x, screen.y, 12, 0, Math.PI * 2); context.stroke();
  context.restore();
}

const LABEL_FONT = "600 11.5px ui-sans-serif, system-ui";

function labelText(text, x, y, palette) {
  context.save();
  context.font = LABEL_FONT;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.lineWidth = 3;
  context.strokeStyle = palette.paperB;
  context.strokeText(text, x, y);
  context.fillStyle = palette.ink;
  context.fillText(text, x, y);
  context.restore();
}

const PILL_FONT = "bold 11px ui-sans-serif, system-ui";

export function labelPill(text, x, y, palette) {
  context.save();
  context.font = PILL_FONT;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = context.measureText(text).width + 12;
  context.fillStyle = palette.paperB;
  context.strokeStyle = palette.grid;
  roundedRect(x - width / 2, y - 9, width, 18, 6);
  context.fill(); context.stroke();
  context.fillStyle = palette.ink;
  context.fillText(text, x, y + .5);
  context.restore();
}

function roundedRect(x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function updateZoomLabel() {
  const nmPerHundredPixels = 100 / activeChart().view.zoom * NM_PER_DEGREE;
  elements["zoom-label"].textContent = `${nmPerHundredPixels >= 10 ? Math.round(nmPerHundredPixels) : nmPerHundredPixels.toFixed(1)} nm / 100 px`;
}

export function fitData() {
  const chart = activeChart();
  // Only what the chart shows; hidden layers stay out of the fit.
  const points = [...shownItems(chart, "route"), ...shownItems(chart, "saved-point"), ...(chart.layers.track ? chart.track : []),
    ...shownItems(chart, "measure").flatMap((measure) => [measure, measure.end]), ...shownItems(chart, "wind"), ...shownItems(chart, "line").flatMap((line) => [line, line.end])];
  // A Scrambled Seas world's map counts while it is shown, so the whole world fits on screen.
  for (const { centre, item } of vanillaIslands()) if (item) points.push(centre);
  for (const feature of shownItems(chart, "feature")) {
    points.push(feature);
    if (feature.rangeNm) points.push(...[0, 90, 180, 270].map((bearing) => destinationPoint(feature, bearing, feature.rangeNm)));
    const island = chartIsland(feature);
    if (island) {
      const bounds = islandWorldBounds(island, feature);
      points.push({ lat: bounds.minLat, lon: bounds.minLon }, { lat: bounds.maxLat, lon: bounds.maxLon });
    }
  }
  for (const search of shownItems(chart, "search")) {
    const extent = searchExtent(search);
    // Without its search line, a search is just its area, from the near edge out.
    const edges = chart.layers.searchLines ? [extent.farNm] : [extent.nearNm, extent.farNm];
    if (chart.layers.searchLines) points.push(search);
    for (const nm of edges) points.push(...[extent.fromDeg, search.bearing, extent.toDeg].map((bearing) => destinationPoint(search, bearing, nm)));
  }
  if (!points.length) {
    activeChart().view = { lat: 10, lon: 0, zoom: 5 };
    persist(); drawChart(); return;
  }
  fitPoints(points);
}

export function fitPoints(points) {
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const bounds = { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) };
  const rectangle = canvas.getBoundingClientRect();
  const width = Math.max(.5, bounds.maxLon - bounds.minLon);
  const height = Math.max(.5, bounds.maxLat - bounds.minLat);
  activeChart().view = {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lon: (bounds.minLon + bounds.maxLon) / 2,
    zoom: clamp(Math.min((rectangle.width - 100) / width, (rectangle.height - 100) / height), MIN_ZOOM, MAX_ZOOM)
  };
  persist(); drawChart();
}

export function centerOn(point) {
  activeChart().view.lat = point.lat;
  activeChart().view.lon = point.lon;
  activeChart().view.zoom = Math.max(activeChart().view.zoom, 12);
  persist(); drawChart();
}

// Finds what is under the pointer and where drawing clicks snap to.
import { NM_PER_DEGREE, destinationPoint, insideSearch, searchExtent, searchIconAnchors, summarizeRoute, visibleSavedRoutes } from "./model.mjs";
import { islandContains } from "./islands.mjs";
import { visibleBoat } from "./boats.mjs";
import { clamp } from "./format.mjs";
import { activeChart, selectedItem, selection } from "./state.mjs";
import { boatIconBounds, boatIconBoundsAt, chartIsland, chartSearchIsland, islandPixelSpan, screenToWorld, symbolSize, worldToScreen } from "./viewport.mjs";

const POINT_MAGNET_PX = 11;

const LINE_MAGNET_PX = 7;

// Repeated clicks on one spot step through the items stacked there.
let hitCycle = null;
const SAVED_ROUTE_LINE_PX = 5;
const MEASURE_LINE_PX = 6;
const MEASURE_END_PX = 9;

export function resetHitCycle() {
  hitCycle = null;
}

function findHits(x, y) {
  const chart = activeChart();
  const world = screenToWorld(x, y);
  const candidates = [];
  const consider = (kind, id, point, distanceOverride = null, passive = false) => {
    const screen = worldToScreen(point);
    candidates.push({ kind, id, passive, distance: distanceOverride ?? Math.hypot(screen.x - x, screen.y - y) });
  };
  for (const feature of chart.features) {
    const island = chartIsland(feature);
    const inside = island && islandPixelSpan(island) >= 14 && islandContains(island, feature, world);
    const boatBounds = chart.layers.boats && visibleBoat(feature) ? boatIconBounds(feature) : null;
    const insideBoat = boatBounds && x >= boatBounds.x - boatBounds.width / 2 && x <= boatBounds.x + boatBounds.width / 2
      && y >= boatBounds.y - boatBounds.height / 2 && y <= boatBounds.y + boatBounds.height / 2;
    consider("feature", feature.id, feature, inside || insideBoat ? 0 : null);
  }
  for (const point of chart.route) consider("route", point.id, point);
  for (const route of visibleSavedRoutes(chart)) {
    for (const point of route.points) consider("saved-point", point.id, point);
    // Clicking a saved route's line picks the whole route; its waypoints win when they are as close.
    for (const leg of summarizeRoute(route.points).legs) {
      const line = { a: worldToScreen(leg.from), b: worldToScreen(leg.to) };
      const near = closestOnSegment(line, { x, y });
      const distance = Math.hypot(near.x - x, near.y - y);
      if (distance <= SAVED_ROUTE_LINE_PX) consider("saved-route", route.id, leg.from, distance + 3);
    }
  }
  const iconAnchors = searchIconAnchors(chart.searches);
  for (const search of chart.searches) {
    let insideBoat = false;
    if (chart.layers.boats && visibleBoat(search)) {
      const island = iconAnchors.has(search.id) ? null : chartSearchIsland(search);
      const scale = island ? clamp(28 / Math.max(1, islandPixelSpan(island)), 1, 8) : 1;
      const boat = visibleBoat(search);
      const bounds = boatIconBoundsAt(searchExtent(search).centre, island, scale, boat);
      insideBoat = x >= bounds.x - bounds.width / 2 && x <= bounds.x + bounds.width / 2
        && y >= bounds.y - bounds.height / 2 && y <= bounds.y + bounds.height / 2;
    }
    const searchOrigin = worldToScreen(search);
    const originDistance = Math.hypot(searchOrigin.x - x, searchOrigin.y - y);
    if (insideBoat || originDistance <= 13) consider("search", search.id, search, insideBoat ? 0 : originDistance);
    else if (insideSearch(search, world)) consider("search", search.id, search, 12, true);
  }
  // A wind arrow is clickable along its whole drawn length.
  if (chart.layers.winds) for (const wind of chart.winds) {
    const start = worldToScreen(wind);
    const radians = wind.bearing * Math.PI / 180;
    const length = symbolSize("wind");
    const end = { x: start.x + Math.sin(radians) * length, y: start.y - Math.cos(radians) * length };
    const near = closestOnSegment({ a: start, b: end }, { x, y });
    consider("wind", wind.id, wind, Math.hypot(near.x - x, near.y - y));
  }
  // The measure line is clickable along its length; marks at its ends win when they are as close.
  if (chart.layers.measure) for (const measure of chart.measures) {
    const near = closestOnSegment({ a: worldToScreen(measure), b: worldToScreen(measure.end) }, { x, y });
    const distance = Math.hypot(near.x - x, near.y - y);
    if (distance <= MEASURE_LINE_PX) consider("measure", measure.id, measure, distance + 3);
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.filter((candidate) => candidate.distance <= 13);
}

export function findHit(x, y, { cycle = false } = {}) {
  const hits = findHits(x, y);
  if (!cycle) return hits[0] ?? null;
  if (!hits.length) {
    hitCycle = null;
    return null;
  }
  const signature = hits.map((hit) => `${hit.kind}:${hit.id}:${hit.passive ? 1 : 0}`).join("|");
  const continuing = hitCycle
    && hitCycle.signature === signature
    && Math.hypot(hitCycle.x - x, hitCycle.y - y) <= 6;
  const index = continuing ? (hitCycle.index + 1) % hits.length : 0;
  hitCycle = { x, y, signature, index };
  return hits[index];
}

// Which end of the selected measure line is under the pointer, so it can be dragged on its own.
export function selectedMeasureEnd(screen) {
  const item = selection?.kind === "measure" && activeChart().layers.measure ? selectedItem() : null;
  if (!item) return null;
  const distanceTo = (point) => {
    const projected = worldToScreen(point);
    return Math.hypot(projected.x - screen.x, projected.y - screen.y);
  };
  const [start, end] = [distanceTo(item), distanceTo(item.end)];
  if (Math.min(start, end) > MEASURE_END_PX) return null;
  return start <= end ? "start" : "end";
}

export function onSelectedAreaEdge(screen) {
  const item = selection?.kind === "feature" ? selectedItem() : null;
  if (!item?.rangeNm) return false;
  const center = worldToScreen(item);
  const radius = item.rangeNm / NM_PER_DEGREE * activeChart().view.zoom;
  return Math.abs(Math.hypot(screen.x - center.x, screen.y - center.y) - radius) <= 6;
}

// Drawing clicks snap to charted positions, then to where two lines cross, then onto a single line,
// so new work lines up exactly with old work at any zoom. Holding Ctrl places freely.
export function snapPoint(screen, free = false) {
  const raw = screenToWorld(screen.x, screen.y);
  if (free) return raw;
  let best = null;
  let bestDistance = POINT_MAGNET_PX;
  for (const point of magnetPoints()) {
    const projected = worldToScreen(point);
    const distance = Math.hypot(projected.x - screen.x, projected.y - screen.y);
    if (distance < bestDistance) { best = point; bestDistance = distance; }
  }
  if (best) return { lat: best.lat, lon: best.lon, snapped: true, anchor: anchorOf(best) };
  const near = magnetLines()
    .map((line) => ({ line, point: closestOnSegment(line, screen) }))
    .map((candidate) => ({ ...candidate, distance: Math.hypot(candidate.point.x - screen.x, candidate.point.y - screen.y) }))
    .filter((candidate) => candidate.distance <= LINE_MAGNET_PX)
    .sort((a, b) => a.distance - b.distance);
  const crossing = near.length >= 2 ? segmentCrossing(near[0].line, near[1].line) : null;
  const target = crossing && Math.hypot(crossing.x - screen.x, crossing.y - screen.y) <= POINT_MAGNET_PX ? crossing : near[0]?.point;
  return target ? { ...screenToWorld(target.x, target.y), snapped: true } : raw;
}

// Marks and waypoints can carry things drawn from them; other magnets (track, centres) cannot.
function anchorOf(point) {
  const chart = activeChart();
  if (chart.features.includes(point)) return { kind: "feature", id: point.id };
  if (chart.route.includes(point)) return { kind: "route", id: point.id };
  if (visibleSavedRoutes(chart).some((route) => route.points.includes(point))) return { kind: "saved-point", id: point.id };
  return null;
}

function magnetPoints() {
  const chart = activeChart();
  return [
    ...chart.features,
    ...chart.route,
    ...visibleSavedRoutes(chart).flatMap((route) => route.points),
    ...(chart.layers.track ? chart.track : []),
    ...chart.searches.map((search) => searchExtent(search).centre)
  ];
}

// Charted lines in screen space: search centre lines, route legs and imported lines.
function magnetLines() {
  const chart = activeChart();
  const lines = [];
  const add = (a, b) => lines.push({ a: worldToScreen(a), b: worldToScreen(b) });
  for (const search of chart.searches) add(search, destinationPoint(search, search.bearing, searchExtent(search).farNm));
  for (const points of [chart.route, ...visibleSavedRoutes(chart).map((route) => route.points)]) {
    for (const leg of summarizeRoute(points).legs) add(leg.from, leg.to);
  }
  for (const segment of chart.segments) add(segment.a, segment.b);
  return lines;
}

// How far along a heading from the origin (in pixels) the nearest charted line or mark sits to the cursor, as nm.
export function snapAlongRay(origin, bearing, screen) {
  const start = worldToScreen(origin);
  const radians = bearing * Math.PI / 180;
  const direction = { x: Math.sin(radians), y: -Math.cos(radians) };
  const along = (point) => (point.x - start.x) * direction.x + (point.y - start.y) * direction.y;
  const across = (point) => Math.abs((point.x - start.x) * direction.y - (point.y - start.y) * direction.x);
  const candidates = magnetPoints().map(worldToScreen).filter((point) => across(point) <= POINT_MAGNET_PX).map(along);
  for (const line of magnetLines()) {
    const hit = rayCrossing(start, direction, line);
    if (hit !== null) candidates.push(hit);
  }
  const cursor = along(screen);
  const best = candidates.filter((t) => t > 1).sort((a, b) => Math.abs(a - cursor) - Math.abs(b - cursor))[0];
  return best !== undefined && Math.abs(best - cursor) <= POINT_MAGNET_PX ? best / activeChart().view.zoom * NM_PER_DEGREE : null;
}

function cross(u, v) {
  return u.x * v.y - u.y * v.x;
}

function closestOnSegment({ a, b }, point) {
  const d = { x: b.x - a.x, y: b.y - a.y };
  const length = d.x * d.x + d.y * d.y;
  const t = length ? clamp(((point.x - a.x) * d.x + (point.y - a.y) * d.y) / length, 0, 1) : 0;
  return { x: a.x + d.x * t, y: a.y + d.y * t };
}

// Distance along the ray to where it meets the segment, or null when they miss or run parallel.
function rayCrossing(start, direction, { a, b }) {
  const d = { x: b.x - a.x, y: b.y - a.y };
  const denominator = cross(direction, d);
  if (Math.abs(denominator) < 1e-9) return null;
  const w = { x: a.x - start.x, y: a.y - start.y };
  const t = cross(w, d) / denominator;
  const s = cross(w, direction) / denominator;
  return t > 0 && s >= 0 && s <= 1 ? t : null;
}

function segmentCrossing(first, second) {
  const direction = { x: first.b.x - first.a.x, y: first.b.y - first.a.y };
  const t = rayCrossing(first.a, direction, second);
  return t !== null && t <= 1 ? { x: first.a.x + direction.x * t, y: first.a.y + direction.y * t } : null;
}

export function nearestTrackPoint(screen) {
  if (!activeChart().layers.track) return null;
  let best = null;
  let bestDistance = 8;
  for (const point of activeChart().track) {
    const projected = worldToScreen(point);
    const distance = Math.hypot(projected.x - screen.x, projected.y - screen.y);
    if (distance < bestDistance) { best = point; bestDistance = distance; }
  }
  return best;
}

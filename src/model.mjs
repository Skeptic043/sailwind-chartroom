import { islandById } from "./islands.mjs";
import { scrambledIslands } from "./scrambled-seas.mjs";

// Exported files are { format, version, exportedAt, charts }. The version counts changes to the saved
// shape of a chart; when it increases, upgrade older files in importChartData before they are sanitized.
export const FILE_FORMAT = "sailwind-chartroom";
// 2: lines run from lat and lon to end, like the measure line, instead of from a to b.
export const SCHEMA_VERSION = 2;
export const NM_PER_DEGREE = 140;
// Longitude reaches all the way round, so Scrambled Seas worlds as wide as the globe fit on a chart.
export const WORLD_BOUNDS = Object.freeze({ minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 });
export const MIN_ZOOM = 1.5;
export const MAX_ZOOM = 600;
export const MAX_RANGE_NM = 500;

export function makeId(prefix = "id") {
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${token}`;
}

export function createChart({ name = "Uncharted Sea", seed = "" } = {}) {
  const now = new Date().toISOString();
  return {
    id: makeId("chart"),
    name: cleanText(name, 80) || "Uncharted Sea",
    seed: cleanText(seed, 80),
    createdAt: now,
    updatedAt: now,
    view: { lat: 10, lon: 0, zoom: 5 },
    layers: defaultLayers(),
    speedKn: 6,
    features: [],
    route: [],
    savedRoutes: [],
    track: [],
    measures: [],
    winds: [],
    searches: [],
    segments: []
  };
}

// The View menu's layers. The first group follows the chart tools, each with its own parts beneath it;
// the vanilla map and the trade winds start hidden.
const LAYER_DEFAULTS = Object.freeze({
  locations: true, locationIslands: true,
  routes: true, routeDistances: true, savedRoutes: true,
  measure: true, redLines: true, blueLines: true, greenLines: true,
  areas: true, areaIslands: true,
  searches: true, searchLines: true, searchIslands: true,
  winds: true,
  grid: true, labels: true, boats: true, islands: true, track: true,
  vanillaMap: false, secretIslands: false, tradeWinds: false, expandedWinds: false
});

function defaultLayers() {
  return { ...LAYER_DEFAULTS };
}

// Whether a chart item is drawn, clickable and a magnet. Hidden items stay listed under Chart items.
export function itemShown(chart, kind, item) {
  const layers = chart.layers;
  if (kind === "feature") return item.rangeNm ? layers.areas : layers.locations;
  if (kind === "route") return layers.routes;
  if (kind === "saved-point" || kind === "saved-route") return layers.routes && layers.savedRoutes;
  if (kind === "search") return layers.searches;
  if (kind === "wind") return layers.winds;
  if (kind === "measure") return layers.measure;
  if (kind === "line") return layers.measure && layers[`${item.color}Lines`];
  return true;
}

// The items of one kind the chart draws. A saved route also hides on its own.
export function shownItems(chart, kind) {
  if (kind === "saved-route") return itemShown(chart, kind) ? visibleSavedRoutes(chart) : [];
  if (kind === "saved-point") return shownItems(chart, "saved-route").flatMap((route) => route.points);
  return chartItems(chart, kind).filter((item) => itemShown(chart, kind, item));
}

// Whether island outlines show for a location, rough area or search area.
export function islandsShown(chart, kind, item) {
  const layers = chart.layers;
  if (!layers.islands) return false;
  if (kind === "search") return layers.searchIslands;
  return item?.rangeNm ? layers.areaIslands : layers.locationIslands;
}

// Adding to a hidden layer shows it again, so new work never lands out of sight.
export function revealLayer(chart, kind, item) {
  const layers = chart.layers;
  if (kind === "feature") layers[item.rangeNm ? "areas" : "locations"] = true;
  if (kind === "route" || kind === "saved-point") layers.routes = true;
  if (kind === "saved-point") layers.savedRoutes = true;
  if (kind === "search") layers.searches = true;
  if (kind === "wind") layers.winds = true;
  if (kind === "measure") layers.measure = true;
  if (kind === "line") layers.measure = layers[`${item.color}Lines`] = true;
}

export function createWorkspace() {
  const chart = createChart({ name: "My Scrambled Sea" });
  return {
    version: SCHEMA_VERSION,
    activeChartId: chart.id,
    layout: defaultLayout(),
    settings: defaultSettings(),
    charts: [chart]
  };
}

// Each chart tool has one rebindable key. F (fit chart) and I (island library) stay fixed.
export const CHART_TOOLS = Object.freeze([
  { mode: "select", label: "Select & pan", key: "v" },
  { mode: "location", label: "Add location", key: "l" },
  { mode: "route", label: "Plot route", key: "r" },
  { mode: "measure", label: "Measure", key: "m" },
  { mode: "area", label: "Rough area", key: "a" },
  { mode: "search", label: "Search area", key: "s" },
  { mode: "wind", label: "Add wind", key: "w" }
]);
const FIXED_KEYS = new Set(["f", "i"]);

export function defaultShortcuts() {
  return Object.fromEntries(CHART_TOOLS.map((tool) => [tool.mode, tool.key]));
}

// Returns the shortcuts as lowercase single keys, or throws with a message the player can act on.
export function validateShortcuts(value) {
  const shortcuts = {};
  const owners = new Map();
  for (const tool of CHART_TOOLS) {
    const key = String(value?.[tool.mode] ?? "").trim().toLowerCase();
    if (!/^[a-z0-9]$/.test(key)) throw new Error(`Choose one letter or number for ${tool.label}.`);
    if (FIXED_KEYS.has(key)) throw new Error(`${key.toUpperCase()} is already used to ${key === "f" ? "fit the chart" : "open the island library"}.`);
    if (owners.has(key)) throw new Error(`${owners.get(key)} and ${tool.label} can't share ${key.toUpperCase()}.`);
    owners.set(key, tool.label);
    shortcuts[tool.mode] = key;
  }
  return shortcuts;
}

// Interface sizes in percent. 0 follows the Windows text size.
export const INTERFACE_SIZES = Object.freeze([0, 100, 125, 150, 175, 200]);
// Theme ids match src/theme.mjs and the [data-theme] blocks in styles.css.
export const THEME_IDS = Object.freeze(["chartroom", "sailwind"]);
export const APPEARANCE_IDS = Object.freeze(["system", "light", "dark"]);

// App settings live in the workspace so the host saves them with the charts.
export function defaultSettings() {
  return { shortcuts: defaultShortcuts(), checkForUpdates: true, skippedUpdate: "", interfaceSize: 0, theme: "chartroom", appearance: "system" };
}

function sanitizeSettings(value) {
  return {
    shortcuts: sanitizeShortcuts(value?.shortcuts),
    checkForUpdates: value?.checkForUpdates !== false,
    skippedUpdate: cleanText(value?.skippedUpdate, 40),
    interfaceSize: INTERFACE_SIZES.includes(value?.interfaceSize) ? value.interfaceSize : 0,
    theme: THEME_IDS.includes(value?.theme) ? value.theme : "chartroom",
    appearance: APPEARANCE_IDS.includes(value?.appearance) ? value.appearance : "system"
  };
}

function sanitizeShortcuts(value) {
  try {
    return validateShortcuts({ ...defaultShortcuts(), ...(value && typeof value === "object" ? value : {}) });
  } catch {
    return defaultShortcuts();
  }
}

export function sanitizeWorkspace(value) {
  if (!value || typeof value !== "object") return createWorkspace();
  const charts = Array.isArray(value.charts) ? value.charts.map(sanitizeChart).filter(Boolean) : [];
  if (!charts.length) return createWorkspace();
  const activeChartId = charts.some((chart) => chart.id === value.activeChartId)
    ? value.activeChartId
    : charts[0].id;
  return {
    version: SCHEMA_VERSION,
    activeChartId,
    layout: sanitizeLayout(value.layout),
    settings: sanitizeSettings(value.settings),
    charts
  };
}

export function sanitizeChart(value) {
  if (!value || typeof value !== "object") return null;
  const base = createChart({ name: value.name, seed: value.seed });
  const view = value.view && typeof value.view === "object" ? value.view : {};
  base.id = cleanText(value.id, 120) || base.id;
  base.createdAt = validDate(value.createdAt) || base.createdAt;
  base.updatedAt = validDate(value.updatedAt) || base.updatedAt;
  base.view = {
    lat: clampNumber(view.lat, WORLD_BOUNDS.minLat, WORLD_BOUNDS.maxLat, base.view.lat),
    lon: clampNumber(view.lon, WORLD_BOUNDS.minLon, WORLD_BOUNDS.maxLon, base.view.lon),
    zoom: clampNumber(view.zoom, MIN_ZOOM, MAX_ZOOM, base.view.zoom)
  };
  base.layers = Object.fromEntries(Object.entries(LAYER_DEFAULTS).map(([key, shown]) => [key, shown ? value.layers?.[key] !== false : value.layers?.[key] === true]));
  base.speedKn = clampNumber(value.speedKn, 0.1, 30, base.speedKn);
  base.features = arrayOf(value.features, sanitizeFeature);
  base.route = arrayOf(value.route, sanitizeRoutePoint);
  base.savedRoutes = arrayOf(value.savedRoutes, sanitizeSavedRoute);
  base.track = arrayOf(value.track, (point) => sanitizeTrackPoint(point));
  // A chart keeps one measure line; a new measurement replaces it.
  base.measures = arrayOf(value.measures, sanitizeMeasure).slice(-1);
  base.winds = arrayOf(value.winds, sanitizeWind);
  base.searches = arrayOf(value.searches, sanitizeSearch);
  base.segments = arrayOf(value.segments, sanitizeSegment);
  const scramble = sanitizeScramble(value.scramble);
  if (scramble) base.scramble = scramble;
  followAnchors(base);
  return base;
}

function defaultLayout() {
  return { leftWidth: 270, rightWidth: 320, leftOpen: true, rightOpen: true };
}

function sanitizeLayout(value) {
  const fallback = defaultLayout();
  return {
    leftWidth: clampNumber(value?.leftWidth, 190, 480, fallback.leftWidth),
    rightWidth: clampNumber(value?.rightWidth, 190, 480, fallback.rightWidth),
    leftOpen: value?.leftOpen !== false,
    rightOpen: value?.rightOpen !== false
  };
}

export function createFeature({ lat, lon, name = "New location", notes = "", day = "", time = "", rangeNm = 0, islandId = "", showIsland = true, boatId = "", boatCorner = "se", showBoat = true }) {
  return sanitizeFeature({ id: makeId("feature"), lat, lon, name, notes, day, time, rangeNm, islandId, showIsland, boatId, boatCorner, showBoat });
}

export function locationRangeForType(type, rangeNm) {
  if (type !== "area") return 0;
  const value = Number(rangeNm);
  return Number.isFinite(value) && value > 0 ? clampNumber(value, 0.1, MAX_RANGE_NM, 10) : 10;
}

// Kept lines come in the three colours the Sailwind web map draws with.
export const LINE_COLOURS = Object.freeze(["red", "blue", "green"]);

// A measure line kept on the chart as a line of its own.
export function createLine(measure, color = LINE_COLOURS[0]) {
  return sanitizeSegment({ id: makeId("line"), lat: measure.lat, lon: measure.lon, end: measure.end, color });
}

export function createMeasure(from, to) {
  return sanitizeMeasure({ id: makeId("measure"), lat: from.lat, lon: from.lon, end: { lat: to.lat, lon: to.lon } });
}

export function createWind({ lat, lon, bearing, label = "", day = "", time = "" }) {
  return sanitizeWind({ id: makeId("wind"), lat, lon, bearing, label, day, time });
}

export function createRoutePoint({ lat, lon, name = "", notes = "", day = "", time = "" }) {
  return sanitizeRoutePoint({ id: makeId("route"), lat, lon, name, notes, day, time });
}

// Saving moves the active route's waypoints, ids and all, into a separate route that stays editable.
export function archiveActiveRoute(chart) {
  if (!chart?.route?.length) return null;
  const savedRoutes = Array.isArray(chart.savedRoutes) ? chart.savedRoutes : (chart.savedRoutes = []);
  const archived = {
    id: makeId("saved-route"),
    name: `Route ${savedRoutes.length + 1}`,
    createdAt: new Date().toISOString(),
    hidden: false,
    points: chart.route.map(sanitizeRoutePoint).filter(Boolean)
  };
  savedRoutes.push(archived);
  const moved = new Set(archived.points.map((point) => point.id));
  for (const search of chart.searches ?? []) {
    if (search.anchor?.kind === "route" && moved.has(search.anchor.id)) search.anchor = { kind: "saved-point", id: search.anchor.id };
  }
  chart.route = [];
  chart.updatedAt = archived.createdAt;
  return archived;
}

export function visibleSavedRoutes(chart) {
  return chart.savedRoutes.filter((route) => !route.hidden);
}

export function savedRouteForPoint(chart, pointId) {
  return chart.savedRoutes.find((route) => route.points.some((point) => point.id === pointId)) ?? null;
}

// A search area is a rough heading and distance from where it was given: "about 120 nm SSE".
// A compass point covers 11.25° either side, and the distance is trusted to within a percentage.
export const DEFAULT_SPREAD_DEG = 11.25;
export const DEFAULT_TOLERANCE_PCT = 10;

export function createSearch({ lat, lon, bearing, distanceNm, spreadDeg = DEFAULT_SPREAD_DEG, tolerancePct = DEFAULT_TOLERANCE_PCT, label = "", anchor = null, boatId = "", boatCorner = "se", showBoat = true }) {
  return sanitizeSearch({ id: makeId("search"), lat, lon, bearing, distanceNm, spreadDeg, tolerancePct, label, anchor, boatId, boatCorner, showBoat });
}

// A search drawn from a mark or waypoint stays locked to it: its origin follows that item when it moves,
// and keeps its last position if the item is deleted.
const ANCHOR_KINDS = new Set(["feature", "route", "saved-point"]);

export function anchorTarget(chart, anchor) {
  return anchor && ANCHOR_KINDS.has(anchor.kind) ? itemForRef(chart, anchor) : null;
}

export function followAnchors(chart) {
  for (const search of chart.searches) {
    if (!search.anchor) continue;
    const target = anchorTarget(chart, search.anchor);
    if (target) {
      search.lat = target.lat;
      search.lon = target.lon;
    } else {
      delete search.anchor;
    }
  }
  return chart;
}

// Every kind of item a selection can hold. A saved route owns its waypoints, which can also be selected alone.
const ITEM_LISTS = { feature: "features", route: "route", measure: "measures", line: "segments", wind: "winds", search: "searches" };
export const ITEM_KINDS = Object.freeze([...Object.keys(ITEM_LISTS), "saved-route", "saved-point"]);

export function chartItems(chart, kind) {
  if (kind === "saved-route") return chart.savedRoutes;
  if (kind === "saved-point") return chart.savedRoutes.flatMap((route) => route.points);
  return chart[ITEM_LISTS[kind]] ?? [];
}

export function itemForRef(chart, ref) {
  return ref ? chartItems(chart, ref.kind).find((item) => item.id === ref.id) ?? null : null;
}

// A selected saved route stands for all of its waypoints.
function pointRefs(chart, refs) {
  return (refs ?? []).flatMap((ref) => ref?.kind === "saved-route"
    ? (itemForRef(chart, ref)?.points ?? []).map((point) => ({ kind: "saved-point", id: point.id }))
    : [ref]);
}

export function removeChartItems(chart, refs) {
  const idsOf = (kind) => new Set(refs.filter((ref) => ref.kind === kind).map((ref) => ref.id));
  for (const [kind, key] of Object.entries(ITEM_LISTS)) {
    const ids = idsOf(kind);
    if (ids.size) chart[key] = chart[key].filter((item) => !ids.has(item.id));
  }
  const routes = idsOf("saved-route");
  const points = idsOf("saved-point");
  for (const route of chart.savedRoutes) route.points = route.points.filter((point) => !points.has(point.id));
  chart.savedRoutes = chart.savedRoutes.filter((route) => !routes.has(route.id) && route.points.length);
  followAnchors(chart);
}

export function translateChartItems(chart, refs, delta, { strict = false } = {}) {
  const unique = new Map();
  for (const ref of pointRefs(chart, refs)) {
    const item = itemForRef(chart, ref);
    if (item) unique.set(`${ref.kind}:${ref.id}`, { ref, item });
  }
  const selected = new Set(unique.keys());
  const moving = [...unique.values()].filter(({ ref, item }) => {
    if (ref.kind !== "search" || !item.anchor) return true;
    return !selected.has(`${item.anchor.kind}:${item.anchor.id}`);
  });
  let lat = Number(delta?.lat) || 0;
  let lon = Number(delta?.lon) || 0;
  // A measure line moves both of its ends.
  const limits = moving.flatMap(({ item }) => item.end ? [item, item.end] : [item]).reduce((result, point) => ({
    minLat: Math.max(result.minLat, WORLD_BOUNDS.minLat - point.lat),
    maxLat: Math.min(result.maxLat, WORLD_BOUNDS.maxLat - point.lat),
    minLon: Math.max(result.minLon, WORLD_BOUNDS.minLon - point.lon),
    maxLon: Math.min(result.maxLon, WORLD_BOUNDS.maxLon - point.lon)
  }), { minLat: -Infinity, maxLat: Infinity, minLon: -Infinity, maxLon: Infinity });
  if (strict && (lat < limits.minLat || lat > limits.maxLat || lon < limits.minLon || lon > limits.maxLon)) {
    throw new Error("That move would put part of the selection outside the chart.");
  }
  lat = clampNumber(lat, limits.minLat, limits.maxLat, 0);
  lon = clampNumber(lon, limits.minLon, limits.maxLon, 0);
  for (const { ref, item } of moving) {
    item.lat += lat;
    item.lon += lon;
    if (item.end) {
      item.end.lat += lat;
      item.end.lon += lon;
    }
    if (ref.kind === "search" && item.anchor) delete item.anchor;
  }
  followAnchors(chart);
  return { lat, lon };
}

function sanitizeAnchor(value) {
  const id = cleanText(value?.id, 120);
  return id && ANCHOR_KINDS.has(value.kind) ? { kind: value.kind, id } : null;
}

function sanitizeSearch(value) {
  const bearing = sanitizeBearing(value);
  if (!bearing) return null;
  const distance = clampNumber(value.distanceNm, 0, MAX_SEARCH_NM, 0);
  if (!distance) return null;
  const anchor = sanitizeAnchor(value.anchor);
  const boatId = cleanText(value.boatId, 120);
  const islandId = cleanText(value.islandId, 120);
  return {
    ...bearing,
    ...(islandId && { islandId }),
    ...(value.showIsland === false && { showIsland: false }),
    distanceNm: distance,
    spreadDeg: clampNumber(value.spreadDeg, 0, 90, DEFAULT_SPREAD_DEG),
    tolerancePct: clampNumber(value.tolerancePct, 0, 90, DEFAULT_TOLERANCE_PCT),
    ...(anchor && { anchor }),
    ...(boatId && { boatId, boatCorner: "se", showBoat: true })
  };
}

const MAX_SEARCH_NM = 5000;

export function searchExtent(search) {
  const marginNm = search.distanceNm * search.tolerancePct / 100;
  return {
    nearNm: Math.max(0, search.distanceNm - marginNm),
    farNm: search.distanceNm + marginNm,
    fromDeg: search.bearing - search.spreadDeg,
    toDeg: search.bearing + search.spreadDeg,
    centre: destinationPoint(search, search.bearing, search.distanceNm),
    // Across the wedge at its far edge: the widest stretch you may have to sweep.
    widthNm: 2 * (search.distanceNm + marginNm) * Math.sin(Math.min(search.spreadDeg, 90) * Math.PI / 180)
  };
}

export function insideSearch(search, point) {
  const { nearNm, farNm } = searchExtent(search);
  const nm = distanceNm(search, point);
  if (nm < nearNm || nm > farNm) return false;
  const offset = Math.abs(((bearingDegrees(search, point) - search.bearing + 540) % 360) - 180);
  return offset <= search.spreadDeg;
}

function searchPolygon(search) {
  const { nearNm, farNm, fromDeg, toDeg } = searchExtent(search);
  const steps = Math.max(2, Math.ceil((toDeg - fromDeg) / 2));
  const arc = (nm, reverse) => Array.from({ length: steps + 1 }, (_, index) => {
    const degrees = reverse ? toDeg - (toDeg - fromDeg) * index / steps : fromDeg + (toDeg - fromDeg) * index / steps;
    return destinationPoint(search, degrees, nm);
  });
  return [...arc(farNm, false), ...arc(nearNm, true)];
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.lon - p.lon) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lon - p.lon);
  const onSegment = (p, q, r) => q.lon >= Math.min(p.lon, r.lon) - 1e-9 && q.lon <= Math.max(p.lon, r.lon) + 1e-9
    && q.lat >= Math.min(p.lat, r.lat) - 1e-9 && q.lat <= Math.max(p.lat, r.lat) + 1e-9;
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) < 1e-9 && onSegment(a, c, b))
    || (Math.abs(abD) < 1e-9 && onSegment(a, d, b))
    || (Math.abs(cdA) < 1e-9 && onSegment(c, a, d))
    || (Math.abs(cdB) < 1e-9 && onSegment(c, b, d));
}

function segmentIntersectionPoint(a, b, c, d) {
  const r = { x: b.lon - a.lon, y: b.lat - a.lat };
  const s = { x: d.lon - c.lon, y: d.lat - c.lat };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < 1e-12) return null;
  const offset = { x: c.lon - a.lon, y: c.lat - a.lat };
  const t = (offset.x * s.y - offset.y * s.x) / denominator;
  const u = (offset.x * r.y - offset.y * r.x) / denominator;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { lat: a.lat + r.y * t, lon: a.lon + r.x * t };
}

export function searchAreasOverlap(first, second) {
  const a = searchPolygon(first);
  const b = searchPolygon(second);
  if (a.some((point) => insideSearch(second, point)) || b.some((point) => insideSearch(first, point))) return true;
  for (let ai = 0; ai < a.length; ai += 1) {
    const aNext = (ai + 1) % a.length;
    for (let bi = 0; bi < b.length; bi += 1) {
      if (segmentsIntersect(a[ai], a[aNext], b[bi], b[(bi + 1) % b.length])) return true;
    }
  }
  return false;
}

// The middle of the stretch every one of these searches covers, or null when they share none.
export function commonSearchOverlap(searches) {
  if (!Array.isArray(searches) || searches.length < 2) return null;
  const polygons = searches.map(searchPolygon);
  const candidates = [
    ...polygons.flat(),
    ...searches.map((search) => searchExtent(search).centre)
  ];
  for (let first = 0; first < polygons.length; first += 1) {
    for (let second = first + 1; second < polygons.length; second += 1) {
      const a = polygons[first];
      const b = polygons[second];
      for (let ai = 0; ai < a.length; ai += 1) {
        for (let bi = 0; bi < b.length; bi += 1) {
          const point = segmentIntersectionPoint(a[ai], a[(ai + 1) % a.length], b[bi], b[(bi + 1) % b.length]);
          if (point) candidates.push(point);
        }
      }
    }
  }
  // The shared stretch's corners: outline points and crossings that lie inside every search.
  const shared = candidates.filter((point) => searches.every((search) => insideSearch(search, point)));
  if (!shared.length) return null;
  const middle = {
    lat: shared.reduce((sum, point) => sum + point.lat, 0) / shared.length,
    lon: shared.reduce((sum, point) => sum + point.lon, 0) / shared.length
  };
  if (searches.every((search) => insideSearch(search, middle))) return middle;
  // A curved stretch can leave its middle outside it; the nearest corner is always inside.
  const distance = (point) => Math.hypot(point.lat - middle.lat, point.lon - middle.lon);
  return shared.reduce((nearest, point) => distance(point) < distance(nearest) ? point : nearest);
}

// Searches for the same place that overlap share one island and name, drawn where they all meet.
// Maps each such search to that point for the one that carries the name, and to null for the rest.
export function searchIconAnchors(searches) {
  const named = searchNameLabelIds(searches);
  const anchors = new Map();
  for (const group of searchOverlapGroups(searches)) {
    const centre = commonSearchOverlap(group);
    for (const search of group) anchors.set(search.id, named.has(search.id) ? centre : null);
  }
  return anchors;
}

// Resolving a named search answers every search with that name. An unnamed search stands alone.
export function searchesAnsweredBy(searches, search) {
  const name = cleanText(search.label, 100).toLowerCase();
  return name ? searches.filter((other) => cleanText(other.label, 100).toLowerCase() === name) : [search];
}

export function searchOverlapGroups(searches) {
  const named = (searches ?? []).filter((search) => search?.id && cleanText(search.label, 100));
  const remaining = new Set(named.map((_, index) => index));
  const groups = [];
  while (remaining.size) {
    const seed = remaining.values().next().value;
    const label = cleanText(named[seed].label, 100).toLowerCase();
    const component = [];
    const queue = [seed];
    remaining.delete(seed);
    while (queue.length) {
      const index = queue.shift();
      component.push(named[index]);
      for (const other of [...remaining]) {
        if (cleanText(named[other].label, 100).toLowerCase() !== label || !searchAreasOverlap(named[index], named[other])) continue;
        remaining.delete(other);
        queue.push(other);
      }
    }
    if (component.length > 1 && commonSearchOverlap(component)) groups.push(component);
  }
  return groups;
}

export function searchEvidenceOpacity(hasOverlap) {
  return hasOverlap ? 0 : 0.12;
}

export function chartItemFocusPoint(kind, item) {
  if (kind === "search") return searchExtent(item).centre;
  if (kind === "measure" || kind === "line") return { lat: (item.lat + item.end.lat) / 2, lon: (item.lon + item.end.lon) / 2 };
  if (kind === "saved-route") {
    const lats = item.points.map((point) => point.lat);
    const lons = item.points.map((point) => point.lon);
    return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
  }
  return item;
}

const LANDMARK_LABEL_PRIORITY = new Map([
  ["gold rock", 0],
  ["dragon cliffs", 1],
  ["kicia", 2],
  ["fort aestrin", 3]
]);

// Border Expander's trade winds: the game's three, and two more in the south. Where they overlap,
// the smallest wins, as in Border Expander.
const BORDER_EXPANDER_WINDS = Object.freeze([
  { zone: "aestrin", minLon: -200, maxLon: 200, minLat: 33, maxLat: 90, east: 1, north: 0.5 },
  { zone: "alankh", minLon: -200, maxLon: -2, minLat: 30, maxLat: 33, east: 0.75, north: 0.75 },
  { zone: "emerald", minLon: -2, maxLon: 200, minLat: 30, maxLat: 32, east: -1, north: -0.5 },
  { zone: "southEasterly", minLon: -200, maxLon: 200, minLat: -30, maxLat: 15, east: -1, north: 0.5 },
  { zone: "southWesterly", minLon: -200, maxLon: 200, minLat: -60, maxLat: -33, east: 1, north: -0.5 }
].sort((a, b) => (a.maxLon - a.minLon) * (a.maxLat - a.minLat) - (b.maxLon - b.minLon) * (b.maxLat - b.minLat)));

// The game's permanent trade wind at a position: which of its wind zones this is, and the east and
// north parts of the direction the wind blows toward. Null where there is none: the game has no trade
// wind south of 30°N, and Border Expander adds its own bands.
export function tradeWindAt(lat, lon, borderExpander = false) {
  if (borderExpander) {
    const band = BORDER_EXPANDER_WINDS.find((wind) => lon >= wind.minLon && lon < wind.maxLon && lat >= wind.minLat && lat < wind.maxLat);
    return band ? { zone: band.zone, east: band.east, north: band.north } : null;
  }
  if (lat < 30) return null;
  if (lat > 33) return { zone: "aestrin", east: 1, north: 0.5 };
  if (lon < -2) return { zone: "alankh", east: 0.75, north: 0.75 };
  if (lat < 32) return { zone: "emerald", east: -1, north: -0.5 };
  return null;
}

const LABEL_GAP_PX = 6;
const LABEL_HEIGHT_PX = 14;

// The labels that fit without covering one another. Each item is the centre of its label's top edge
// and the label's width; where two would overlap, the selected, landmark or higher-priority one stays.
export function clusteredLabelIds(items) {
  const candidates = (items ?? []).filter((item) => item?.id && String(item.name ?? "").trim()
    && Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y)));
  const width = (item) => Number(item.width) > 0 ? Number(item.width) : String(item.name).trim().length * 6.5;
  const ranked = candidates.map((item, index) => ({ item, index }))
    .sort((a, b) => Number(Boolean(b.item.selected)) - Number(Boolean(a.item.selected))
    || (LANDMARK_LABEL_PRIORITY.get(String(a.item.name).trim().toLowerCase()) ?? 99)
      - (LANDMARK_LABEL_PRIORITY.get(String(b.item.name).trim().toLowerCase()) ?? 99)
    || (Number.isFinite(Number(a.item.priority)) ? Number(a.item.priority) : 50)
      - (Number.isFinite(Number(b.item.priority)) ? Number(b.item.priority) : 50)
    || a.index - b.index);
  const accepted = [];
  const visible = new Set();
  for (const { item } of ranked) {
    if (accepted.some((other) => Math.abs(Number(item.x) - Number(other.x)) < (width(item) + width(other)) / 2 + LABEL_GAP_PX
      && Math.abs(Number(item.y) - Number(other.y)) < LABEL_HEIGHT_PX + LABEL_GAP_PX)) continue;
    accepted.push(item);
    visible.add(item.id);
  }
  return visible;
}

export function searchNameLabelIds(searches) {
  const named = (searches ?? []).filter((search) => search?.id && cleanText(search.label, 100));
  const remaining = new Set(named.map((_, index) => index));
  const visible = new Set();
  while (remaining.size) {
    const seed = remaining.values().next().value;
    const label = cleanText(named[seed].label, 100).toLowerCase();
    const component = [];
    const queue = [seed];
    remaining.delete(seed);
    while (queue.length) {
      const index = queue.shift();
      component.push(index);
      for (const other of [...remaining]) {
        if (cleanText(named[other].label, 100).toLowerCase() !== label || !searchAreasOverlap(named[index], named[other])) continue;
        remaining.delete(other);
        queue.push(other);
      }
    }
    const centres = component.map((index) => searchExtent(named[index]).centre);
    const centre = centres.reduce((sum, point) => ({
      lat: sum.lat + point.lat / centres.length,
      lon: sum.lon + point.lon / centres.length
    }), { lat: 0, lon: 0 });
    const winner = component.map((index, position) => ({ index, point: centres[position] }))
      .sort((a, b) => Math.hypot(a.point.lat - centre.lat, a.point.lon - centre.lon)
        - Math.hypot(b.point.lat - centre.lat, b.point.lon - centre.lon)
        || a.index - b.index)[0];
    visible.add(named[winner.index].id);
  }
  return visible;
}

export function searchChartLabel(search, showName = true) {
  return showName ? cleanText(search?.label, 100) : "";
}

function sanitizeFeature(value) {
  if (!value || !isFiniteCoordinate(value.lat, value.lon)) return null;
  const islandId = cleanText(value.islandId, 120);
  const boatId = cleanText(value.boatId, 120);
  return {
    id: cleanText(value.id, 120) || makeId("feature"),
    lat: Number(value.lat),
    lon: Number(value.lon),
    name: cleanText(value.name, 100),
    notes: cleanText(value.notes, 1000),
    day: cleanText(value.day, 30),
    time: cleanText(value.time, 30),
    rangeNm: clampNumber(value.rangeNm, 0, MAX_RANGE_NM, 0),
    ...(islandId && { islandId }),
    showIsland: value.showIsland !== false,
    ...(value.showName === false && { showName: false }),
    ...(boatId && { boatId, boatCorner: "se", showBoat: true })
  };
}

function sanitizeBearing(value) {
  const point = sanitizePoint(value, "bearing");
  if (!point || !Number.isFinite(Number(value.bearing))) return null;
  return {
    id: point.id,
    lat: point.lat,
    lon: point.lon,
    bearing: ((Number(value.bearing) % 360) + 360) % 360,
    label: cleanText(value.label, 100)
  };
}

function sanitizeMeasure(value) {
  const point = sanitizePoint(value, "measure");
  if (!point || !isFiniteCoordinate(value.end?.lat, value.end?.lon)) return null;
  return { id: point.id, lat: point.lat, lon: point.lon, end: { lat: Number(value.end.lat), lon: Number(value.end.lon) } };
}

function sanitizeWind(value) {
  const wind = sanitizeBearing(value);
  if (!wind) return null;
  const label = cleanText(value.label, 100);
  return {
    id: cleanText(value.id, 120) || makeId("wind"),
    lat: wind.lat,
    lon: wind.lon,
    bearing: wind.bearing,
    label: label.toLowerCase() === "trade wind" ? "" : label,
    day: cleanText(value.day, 30),
    time: cleanText(value.time, 30)
  };
}

function sanitizePoint(value, prefix) {
  if (!value || !isFiniteCoordinate(value.lat, value.lon)) return null;
  return {
    id: cleanText(value.id, 120) || makeId(prefix),
    lat: Number(value.lat),
    lon: Number(value.lon),
    name: cleanText(value.name, 100)
  };
}

function sanitizeRoutePoint(value) {
  const point = sanitizePoint(value, "route");
  return point ? { ...point, notes: cleanText(value.notes, 1000), day: cleanText(value.day, 30), time: cleanText(value.time, 30) } : null;
}

function sanitizeSavedRoute(value) {
  const points = arrayOf(value?.points, sanitizeRoutePoint);
  if (!points.length) return null;
  return {
    id: cleanText(value.id, 120) || makeId("saved-route"),
    name: cleanText(value.name, 100) || "Saved route",
    createdAt: validDate(value.createdAt) || new Date().toISOString(),
    hidden: value.hidden === true,
    points
  };
}

function sanitizeTrackPoint(value) {
  const point = sanitizePoint(value, "track");
  if (!point) return null;
  return {
    ...point,
    day: cleanText(value.day, 30),
    time: cleanText(value.time, 30),
    wind: cleanText(value.wind, 30)
  };
}

// Lines share the measure line's shape. Lines from older charts and web map files ran from a to b, and
// web map colours are names such as "redline"; anything else becomes the first colour.
function sanitizeSegment(value) {
  const start = value?.a ?? value;
  const end = value?.b ?? value?.end;
  if (!value || !isFiniteCoordinate(start?.lat, start?.lon) || !isFiniteCoordinate(end?.lat, end?.lon)) return null;
  const colour = String(value.color ?? "").toLowerCase();
  return {
    id: cleanText(value.id, 120) || makeId("line"),
    lat: Number(start.lat),
    lon: Number(start.lon),
    end: { lat: Number(end.lat), lon: Number(end.lon) },
    color: LINE_COLOURS.find((name) => colour.includes(name)) ?? LINE_COLOURS[0]
  };
}

export function parseCoordinate(input, axis) {
  if (typeof input === "number") return validateAxis(input, axis);
  let text = String(input ?? "").trim().toUpperCase().replaceAll(",", ".");
  if (!text) throw new Error(`${axisLabel(axis)} is required.`);

  const cardinalMatch = text.match(/[NSEW]/g) ?? [];
  const cardinal = cardinalMatch.at(-1) ?? "";
  text = text.replace(/[NSEW]/g, " ");
  const numbers = text.match(/[-+]?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (!numbers.length || numbers.some((number) => !Number.isFinite(number))) {
    throw new Error(`Could not read ${axisLabel(axis).toLowerCase()}.`);
  }

  let sign = numbers[0] < 0 ? -1 : 1;
  let value = Math.abs(numbers[0]);
  if (numbers.length > 1) value += Math.abs(numbers[1]) / 60;
  if (numbers.length > 2) value += Math.abs(numbers[2]) / 3600;
  if (cardinal === "S" || cardinal === "W") sign = -1;
  if (cardinal === "N" || cardinal === "E") sign = 1;
  if ((axis === "lat" && /[EW]/.test(cardinal)) || (axis === "lon" && /[NS]/.test(cardinal))) {
    throw new Error(`${cardinal} is not valid for ${axisLabel(axis).toLowerCase()}.`);
  }
  return validateAxis(sign * value, axis);
}

export function formatCoordinate(value, axis, precision = 2) {
  const numeric = validateAxis(Number(value), axis);
  const cardinal = axis === "lat" ? (numeric < 0 ? "S" : "N") : (numeric < 0 ? "W" : "E");
  return `${Math.abs(numeric).toFixed(precision)}° ${cardinal}`;
}

export function distanceNm(a, b) {
  return Math.hypot(Number(b.lon) - Number(a.lon), Number(b.lat) - Number(a.lat)) * NM_PER_DEGREE;
}

export function bearingDegrees(a, b) {
  const radians = Math.atan2(Number(b.lon) - Number(a.lon), Number(b.lat) - Number(a.lat));
  return (radians * 180 / Math.PI + 360) % 360;
}

export function destinationPoint(origin, bearing, nm) {
  const radians = Number(bearing) * Math.PI / 180;
  const degrees = Number(nm) / NM_PER_DEGREE;
  return {
    lat: Number(origin.lat) + Math.cos(radians) * degrees,
    lon: Number(origin.lon) + Math.sin(radians) * degrees
  };
}

export function parseBearing(input) {
  const text = String(input ?? "").trim().toUpperCase().replaceAll(",", ".");
  if (!text) throw new Error("Bearing is required.");
  const compassIndex = COMPASS_POINTS.findIndex((point) => point.toUpperCase() === text);
  if (compassIndex >= 0) return compassIndex * COMPASS_STEP_DEG;
  const numeric = Number(text.replace(/[°\sT]+$/u, ""));
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 360) throw new Error("Bearing must be 0–360° or a compass point such as NE or NbE.");
  return numeric % 360;
}

export function formatDuration(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  const totalMinutes = Math.round(hours * 60);
  const days = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  if (days) return `${days}d ${h}h`;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

// The 32 points of the compass, 11.25° apart: "NbE" is north by east.
const COMPASS_POINTS = ["N", "NbE", "NNE", "NEbN", "NE", "NEbE", "ENE", "EbN", "E", "EbS", "ESE", "SEbE", "SE", "SEbS", "SSE", "SbE", "S", "SbW", "SSW", "SWbS", "SW", "SWbW", "WSW", "WbS", "W", "WbN", "WNW", "NWbW", "NW", "NWbN", "NNW", "NbW"];
export const COMPASS_STEP_DEG = 360 / COMPASS_POINTS.length;

export function compassPoint(degrees) {
  return COMPASS_POINTS[Math.round(((degrees % 360) + 360) % 360 / COMPASS_STEP_DEG) % COMPASS_POINTS.length];
}

export function summarizeRoute(route) {
  const legs = [];
  let totalNm = 0;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    const nm = distanceNm(from, to);
    const bearing = bearingDegrees(from, to);
    totalNm += nm;
    legs.push({ index, from, to, nm, bearing, compass: compassPoint(bearing) });
  }
  return { legs, totalNm };
}

export function parseCoordinateViewer(text) {
  const points = [];
  let day = "";
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const dayMatch = line.match(/^Day\s*:\s*(.+)$/i);
    if (dayMatch) {
      day = cleanText(dayMatch[1], 30);
      continue;
    }
    const normalized = line.replace(/(?<=\d),(?=\d)/g, ".");
    const parts = normalized.split(/\s+/);
    if (parts.length < 2) continue;
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (!isFiniteCoordinate(lat, lon)) continue;
    let time = "";
    let wind = "";
    if (parts.length >= 4 && Number.isFinite(Number(parts[2])) && Number.isFinite(Number(parts[3]))) {
      const decimalHours = Number(parts[2]);
      const hours = Math.floor(decimalHours);
      const minutes = Math.floor((decimalHours - hours) * 60);
      time = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
      wind = compassPoint(Number(parts[3]));
    }
    points.push({ id: makeId("track"), lat, lon, name: "", day, time, wind });
  }
  if (!points.length) throw new Error("No valid Coordinate Viewer positions were found.");
  return points;
}

export function exportFile(charts) {
  return { format: FILE_FORMAT, version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), charts };
}

export function importChartData(value, suggestedName = "Imported chart") {
  if (value?.format === FILE_FORMAT) {
    if (!Number.isInteger(value.version) || value.version < 1) throw new Error("This Chartroom file has no readable format version.");
    if (value.version > SCHEMA_VERSION) throw new Error("This file was saved by a newer version of Chartroom. Update Chartroom to open it.");
    const charts = arrayOf(value.charts, sanitizeChart);
    if (!charts.length) throw new Error("This Chartroom file contains no charts.");
    return charts.map(freshImport);
  }
  // Files from before the format label: whole-workspace backups and single raw charts.
  if (value?.charts) {
    return sanitizeWorkspace(value).charts.map(freshImport);
  }
  if (Array.isArray(value?.features) || Array.isArray(value?.route) || Array.isArray(value?.track)) {
    const chart = sanitizeChart({ ...value, name: value.name || suggestedName });
    if (!chart) throw new Error("The chart file is not valid.");
    chart.id = makeId("chart");
    chart.name = uniqueImportedName(chart.name);
    return [chart];
  }
  if (value && (Array.isArray(value.path) || Array.isArray(value.points) || Array.isArray(value.goals) || value.islands)) {
    return [importLegacyMap(value, suggestedName)];
  }
  throw new Error("This file is not a Chartroom or Sailwind Interactive Map export.");
}

// A new chart for a Scrambled Seas world, with the game map on to show where its islands went.
export function importScrambledSeas(world) {
  const seed = Number.isInteger(world.seed) ? String(world.seed) : "";
  const chart = createChart({ name: uniqueImportedName(seed ? `Scrambled Seas ${seed}` : "Scrambled Seas"), seed });
  chart.scramble = sanitizeScramble({ islands: scrambledIslands(world) });
  chart.layers.vanillaMap = true;
  // Scrambled Seas records whether Border Expander was installed, and so whether its trade winds blow.
  chart.layers.expandedWinds = world.borderExpander === true;
  return chart;
}

function sanitizeScramble(value) {
  if (!value?.islands || typeof value.islands !== "object") return null;
  const islands = Object.fromEntries(Object.entries(value.islands)
    .filter(([id, point]) => islandById(id) && isFiniteCoordinate(point?.lat, point?.lon))
    .map(([id, point]) => [id, { lat: Number(point.lat), lon: Number(point.lon) }]));
  return Object.keys(islands).length ? { islands } : null;
}

export function importLegacyMap(value, name = "Imported legacy map") {
  const chart = createChart({ name: uniqueImportedName(name) });
  const legacyPoints = [...(value.points ?? []), ...(value.goals ?? [])];
  chart.features = legacyPoints.map((point, index) => {
    const [lon, lat] = point.pos ?? [];
    if (!isFiniteCoordinate(lat, lon)) return null;
    return createFeature({
      lat,
      lon,
      name: point.description || (index < (value.points?.length ?? 0) ? "Imported mark" : "Imported destination"),
      day: point.day,
      time: point.time,
      notes: point.winddir ? `Recorded wind: ${point.winddir}` : ""
    });
  }).filter(Boolean);
  chart.route = (value.path ?? []).map((point) => {
    const [lon, lat] = point.pos ?? [];
    return isFiniteCoordinate(lat, lon) ? createRoutePoint({ lat, lon, name: point.description, day: point.day, time: point.time }) : null;
  }).filter(Boolean);
  chart.segments = (value.lines ?? []).map((line) => {
    const a = line.p0 ?? line.a;
    const b = line.p1 ?? line.b;
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    return sanitizeSegment({ a: { lon: a[0], lat: a[1] }, b: { lon: b[0], lat: b[1] }, color: line.colour });
  }).filter(Boolean);
  for (const [id, position] of Object.entries(value.islands ?? {})) {
    const island = islandById(id);
    if (!island || !isFiniteCoordinate(position?.y, position?.x)) continue;
    chart.features.push(createFeature({
      lat: Number(position.y) + (island.sourceMapOffset?.lat ?? 0),
      lon: Number(position.x) + (island.sourceMapOffset?.lon ?? 0),
      name: island.name,
      islandId: island.id
    }));
  }
  chart.updatedAt = new Date().toISOString();
  return chart;
}

export function featuresToCsv(features) {
  const header = ["name", "latitude", "longitude", "day", "time", "range_nm", "island_id", "show_island", "boat_id", "notes"];
  const rows = features.map((feature) => [
    feature.name,
    feature.lat,
    feature.lon,
    feature.day,
    feature.time,
    feature.rangeNm || "",
    feature.islandId || "",
    feature.showIsland !== false,
    feature.boatId || "",
    feature.notes
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function isFiniteCoordinate(lat, lon) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))
    && Number(lat) >= WORLD_BOUNDS.minLat && Number(lat) <= WORLD_BOUNDS.maxLat
    && Number(lon) >= WORLD_BOUNDS.minLon && Number(lon) <= WORLD_BOUNDS.maxLon;
}

function validateAxis(value, axis) {
  if (!Number.isFinite(value)) throw new Error(`${axisLabel(axis)} must be a number.`);
  const limit = axis === "lat" ? WORLD_BOUNDS.maxLat : WORLD_BOUNDS.maxLon;
  if (value < -limit || value > limit) throw new Error(`${axisLabel(axis)} must be between -${limit}° and ${limit}°.`);
  return value;
}

function axisLabel(axis) {
  return axis === "lat" ? "Latitude" : "Longitude";
}

function arrayOf(value, mapper) {
  return Array.isArray(value) ? value.map(mapper).filter(Boolean) : [];
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function validDate(value) {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return new Date(value).toISOString();
}

// Text a spreadsheet would read as a formula gets a leading apostrophe, so opening a shared chart's
// CSV can never run anything. Numbers, including negative coordinates, stay numbers.
function csvCell(value) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function freshImport(chart) {
  return { ...chart, id: makeId("chart"), name: uniqueImportedName(chart.name) };
}

function uniqueImportedName(name) {
  return cleanText(`${name || "Imported chart"} (imported)`, 80);
}

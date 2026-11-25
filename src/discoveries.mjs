// Voyage Recorder port visits and landfalls share an island location. Missions become search or rough areas.
import { NM_PER_DEGREE, createFeature, createSearch, distanceNm, insideSearch, isEncounter, isFiniteCoordinate, newRecorderNotes, newVisits, revealLayer } from "./model.mjs";
import { assignedIsland, islandById, islandWorldBounds } from "./islands.mjs";
import { islandIdForNumber } from "./scrambled-seas.mjs";

// A search drawn this close to a mission's origin, for the same destination, is the same search.
const SAME_ORIGIN_NM = 1;
// Sailwind's globe uses 9000 game metres per degree. Allow about 9 metres for origin shifts.
const SAME_ISLAND_DEGREES = 0.001;

// What to change on the chart for these ports, landfalls and missions, including areas the player reached.
export function discoveredMarks(chart, { ports = [], landfalls = [], missions = [] }, { clearReached = true } = {}) {
  const features = [];
  const searches = [];
  const outlines = new Map();
  const cleared = new Set();
  const answered = new Set();
  const resolveAreas = (name, islandId, points) => {
    if (!clearReached) return;
    const marks = answeredByLocation(chart, { name, islandId }, points);
    for (const id of marks.answered) answered.add(id);
    for (const id of marks.cleared) cleared.add(id);
  };
  const charted = (name, islandId) => [...chart.features, ...features].some((feature) => !cleared.has(feature.id) && named(feature, name, islandId));
  const plot = (location) => {
    const matches = (feature) => matchesDiscovery(feature, location);
    const existing = chart.features.find(matches);
    const pendingIndex = features.findIndex(matches);
    if (existing) {
      if (pendingIndex >= 0) features.splice(pendingIndex, 1);
      if (location.showIsland && existing.discovery && !existing.showIsland && !outlines.has(existing.id)) {
        // An older chart's pin has no saved starting point. The original landing can supply it on replay.
        const pin = existing.discovery.pin ??
          landfalls.find((visit) => sameDiscovery(visit, existing.discovery) && samePosition(existing, visit));
        if (canPlaceOutline(existing, location.islandId, pin)) {
          outlines.set(existing.id, { id: existing.id, islandId: location.islandId, discovery: location.discovery, name: existing.name,
            before: { lat: existing.lat, lon: existing.lon }, position: { lat: location.lat, lon: location.lon } });
        }
      }
    } else if (pendingIndex < 0) {
      features.push(createFeature(location));
    } else {
      const pending = features[pendingIndex];
      if (location.showIsland && canPlaceOutline(pending, location.islandId)) placeOutline(pending, location);
    }
  };
  for (const visit of ports) {
    const islandId = islandIdForNumber(visit.island);
    const discovery = visit.island > 0 ? {
      source: "native", islandId: String(visit.island), islandLat: visit.lat, islandLon: visit.lon
    } : null;
    const outline = discoveryOutline(islandById(islandId), visit);
    resolveAreas(visit.port, islandId);
    plot(discoveryLocation(visit, visit.port, islandId, discovery, outline));
  }
  for (const visit of landfalls) {
    const terra = visit.source === "terra-incognita";
    const island = islandById(terra ? `terra-incognita/${visit.prefab ?? ""}` : visit.source === "piece" ? visit.islandId : islandIdForNumber(visit.islandId));
    const islandId = island?.id ?? "";
    const name = terra ? visit.name || island?.name || visit.islandId : island?.name || visit.name || `Island ${visit.islandId}`;
    const outline = terra && island ? { lat: visit.islandLat, lon: visit.islandLon } : discoveryOutline(island, visit);
    const points = [visit, { lat: visit.islandLat, lon: visit.islandLon }];
    if (outline) points.push(outline);
    resolveAreas(name, islandId, points);
    plot(discoveryLocation(visit, name, islandId, visit, outline));
  }
  const reached = (name, islandId) => ports.some((visit) => sameName(visit.port, name) || (islandId && islandIdForNumber(visit.island) === islandId));
  for (const mission of missions) {
    const islandId = islandIdForNumber(mission.destinationIsland);
    if (charted(mission.destination, islandId) || reached(mission.destination, islandId)) continue;
    const origin = { lat: mission.originLat, lon: mission.originLon };
    if (Number.isFinite(mission.heading) && Number.isFinite(mission.miles)) {
      const drawn = [...chart.searches, ...searches].some((search) => !answered.has(search.id) && sameName(search.label, mission.destination) && distanceNm(search, origin) <= SAME_ORIGIN_NM);
      if (drawn) continue;
      // A direction covers half the gap to the next either side, on the compass the hint was given on.
      searches.push(createSearch({ ...origin, bearing: mission.heading, distanceNm: mission.miles, spreadDeg: 180 / mission.points, label: mission.destination }));
    } else if (Number.isFinite(mission.approxLat)) {
      // Rounded coordinates put the destination somewhere in a cell of that size round them.
      const cellDegrees = 10 ** -mission.decimals;
      features.push(createFeature({
        lat: mission.approxLat, lon: mission.approxLon, name: mission.destination, day: mission.day, time: mission.time,
        rangeNm: Math.round(cellDegrees / 2 * Math.SQRT2 * NM_PER_DEGREE * chart.clockPercent / 100 * 10) / 10
      }));
    }
  }
  return { features, searches, outlines: [...outlines.values()], cleared: [...cleared], answered: [...answered] };
}

function samePosition(a, b) {
  return a.lat === b.lat && a.lon === b.lon;
}

function discoveryLocation(visit, name, islandId, identity, outline) {
  const { lat, lon } = outline ?? visit;
  let discovery = null;
  if (identity) {
    const { source, islandId, islandLat, islandLon, prefab, yaw } = identity;
    discovery = { source, islandId, islandLat, islandLon, ...(prefab && { prefab, yaw }), ...(!outline && { pin: { lat, lon } }) };
  }
  return { lat, lon, name, day: visit.day, time: visit.time, islandId, showIsland: Boolean(outline), discovery };
}

function canPlaceOutline(feature, islandId, pin = feature.discovery?.pin) {
  return feature.discovery && pin && samePosition(feature, pin) && !feature.showIsland &&
    !feature.locked && !feature.icon && !(feature.rangeNm > 0) &&
    (feature.islandId === islandId || (!feature.islandId && feature.discovery.source === "terra-incognita"));
}

function placeOutline(feature, { lat, lon, islandId, discovery }) {
  Object.assign(feature, { lat, lon, islandId, showIsland: true });
  if (discovery?.prefab) Object.assign(feature.discovery, { prefab: discovery.prefab, yaw: discovery.yaw });
  delete feature.discovery.pin;
}

function nearIslandRoot(visit, lat, lon) {
  return Math.hypot(visit.islandLat - lat, visit.islandLon - lon) <= SAME_ISLAND_DEGREES;
}

function sameDiscovery(visit, other) {
  return other?.source === visit.source && other.islandId === visit.islandId && nearIslandRoot(visit, other.islandLat, other.islandLon);
}

function matchesDiscovery(feature, location) {
  const { discovery: visit, islandId, name } = location;
  if (feature.discovery) {
    if (visit) return sameDiscovery(visit, feature.discovery);
    // A port record without an island number can still describe a known location.
    return feature.discovery.source === "native" && sameName(feature.name, name) &&
      nearIslandRoot(feature.discovery, location.lat, location.lon);
  }
  if (feature.rangeNm > 0 || isEncounter(feature)) return false;
  if (!visit) return sameName(feature.name, name);
  const island = islandById(islandId);
  if (!island || assignedIsland(feature)?.id !== islandId) return false;
  if (nearIslandRoot(visit, feature.lat, feature.lon)) return true;
  if (location.showIsland && Math.hypot(feature.lat - location.lat, feature.lon - location.lon) <= SAME_ISLAND_DEGREES) return true;
  // Older port marks and manual locations can use a different anchor from the game root.
  const { minLat, maxLat, minLon, maxLon } = islandWorldBounds(island, feature);
  return visit.islandLat >= minLat && visit.islandLat <= maxLat && visit.islandLon >= minLon && visit.islandLon <= maxLon;
}

// A location answers matching areas. An automatic landfall also needs to be within the area it answers.
export function answeredByLocation(chart, location, points) {
  if (location.rangeNm > 0 || isEncounter(location)) return { cleared: [], answered: [] };
  return {
    cleared: chart.features.filter((area) => area.rangeNm > 0 && area.id !== location.id && sameName(area.name, location.name) &&
      (!points || points.some((point) => distanceNm(area, point) <= area.rangeNm))).map((area) => area.id),
    answered: chart.searches.filter((search) => named(search, location.name, location.islandId) &&
      (!points || points.some((point) => insideSearch(search, point)))).map((search) => search.id)
  };
}

// What else a recording adds to a chart beside its track and marks: notes not seen before, new port visits,
// and the latest session's game, world and mods. add(key, items) and setRecording(recording) apply them,
// inside or outside undo as the caller needs. Returns the notes added.
export function addRecordingExtras(chart, { notes = [], visits = [], session = null }, { add, setRecording }) {
  const freshNotes = newRecorderNotes(chart, notes);
  const freshVisits = newVisits(chart, visits);
  if (freshNotes.length) {
    add("notes", freshNotes);
    revealLayer(chart, "note", freshNotes[0]);
  }
  if (freshVisits.length) add("visits", freshVisits);
  if (session) setRecording(session);
  return freshNotes;
}

// Applies discoveries to a chart or to a snapshot that might already contain a landing.
export function applyMarks(chart, marks) {
  removeAnswered(chart, marks);
  for (const { id, islandId, discovery, before, position } of marks.outlines) {
    const feature = chart.features.find((item) => item.id === id);
    if (feature && canPlaceOutline(feature, islandId, before)) placeOutline(feature, { ...position, islandId, discovery });
  }
  for (const feature of marks.features) {
    const existing = feature.discovery && chart.features.find((item) => matchesDiscovery(item, feature));
    if (existing) {
      if (feature.showIsland && canPlaceOutline(existing, feature.islandId)) placeOutline(existing, feature);
    } else {
      chart.features.push(feature);
    }
  }
  chart.searches.push(...marks.searches);
}

// Drops the areas a location answered from a chart or a snapshot of it.
export function removeAnswered(chart, { cleared, answered }) {
  chart.features = chart.features.filter((feature) => !cleared.includes(feature.id));
  chart.searches = chart.searches.filter((search) => !answered.includes(search.id));
}

export function hasMarks({ features, searches, outlines, cleared, answered }) {
  return features.length + searches.length + outlines.length + cleared.length + answered.length > 0;
}

// Apply the same move to the catalog outline that Scrambled Seas applied to the island.
function discoveryOutline(island, visit) {
  if (!island?.sourceCenter) return null;
  if (Number.isFinite(visit.offsetLat) && Number.isFinite(visit.offsetLon)) {
    const lat = island.sourceCenter.lat + visit.offsetLat;
    const lon = island.sourceCenter.lon + visit.offsetLon;
    if (isFiniteCoordinate(lat, lon)) return { lat, lon };
  }
  return visit.vanilla ? island.sourceCenter : null;
}

function named(item, name, islandId) {
  return (islandId && item.islandId === islandId) || sameName(item.name ?? item.label, name);
}

// Names match whatever their case, spaces or punctuation: "Dragon CLiffs" is Dragon Cliffs.
function sameName(a, b) {
  const key = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return key(a) !== "" && key(a) === key(b);
}

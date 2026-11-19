// Turns what Voyage Recorder noted into chart marks. A port reached becomes a location on its island, placed
// as an imported Scrambled Seas world places it (the island's outline moved by the island's offset), and it
// removes the search areas and rough areas for it. A mission read from the mission book becomes a search
// area, or a rough area when Scrambled Seas gives coordinates. Destinations already charted, and searches
// already drawn from the same place, are left alone. A location placed or named by hand answers the same
// search areas and rough areas.
import { NM_PER_DEGREE, createFeature, createSearch, distanceNm, isEncounter, newRecorderNotes, newVisits, revealLayer } from "./model.mjs";
import { islandById } from "./islands.mjs";
import { islandIdForNumber } from "./scrambled-seas.mjs";

// A search drawn this close to a mission's origin, for the same destination, is the same search.
const SAME_ORIGIN_NM = 1;

// What to change on the chart for these ports and missions: features and searches to add, and, with
// clearReached, the rough areas and searches a reached port answers.
export function discoveredMarks(chart, { ports = [], missions = [] }, { clearReached = true } = {}) {
  const features = [];
  const searches = [];
  const cleared = new Set();
  const answered = new Set();
  const charted = (name, islandId) => [...chart.features, ...features].some((feature) => !cleared.has(feature.id) && named(feature, name, islandId));
  // A rough area isn't the place itself, so a port reached still becomes a location beside one that stays.
  const located = (name, islandId) => [...chart.features, ...features].some((feature) => !(feature.rangeNm > 0) && named(feature, name, islandId));
  for (const visit of ports) {
    const islandId = islandIdForNumber(visit.island);
    if (clearReached) {
      for (const search of chart.searches) if (named(search, visit.port, islandId)) answered.add(search.id);
      // Rough areas go by name only: one drawn by hand carries no island.
      for (const area of chart.features) if (area.rangeNm > 0 && sameName(area.name, visit.port)) cleared.add(area.id);
    }
    if (located(visit.port, islandId)) continue;
    features.push(createFeature({ ...islandPlace(islandId, visit), name: visit.port, day: visit.day, time: visit.time, islandId }));
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
  return { features, searches, cleared: [...cleared], answered: [...answered] };
}

// The search areas and rough areas a location placed or named by hand answers, as a reached port would:
// searches for its name or island, rough areas for its name. Rough areas and encounters answer nothing.
export function answeredByLocation(chart, location) {
  if (location.rangeNm > 0 || isEncounter(location)) return { cleared: [], answered: [] };
  return {
    cleared: chart.features.filter((area) => area.rangeNm > 0 && area.id !== location.id && sameName(area.name, location.name)).map((area) => area.id),
    answered: chart.searches.filter((search) => named(search, location.name, location.islandId)).map((search) => search.id)
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

// Applies the marks straight to a chart, inside an undoable edit.
export function applyMarks(chart, marks) {
  removeAnswered(chart, marks);
  chart.features.push(...marks.features);
  chart.searches.push(...marks.searches);
}

// Drops the rough areas and searches a reached port answered from a chart, or from a snapshot of it.
export function removeAnswered(chart, { cleared, answered }) {
  chart.features = chart.features.filter((feature) => !cleared.includes(feature.id));
  chart.searches = chart.searches.filter((search) => !answered.includes(search.id));
}

export function hasMarks({ features, searches, cleared, answered }) {
  return features.length + searches.length + cleared.length + answered.length > 0;
}

// Where the chart's island goes: its outline's centre moved by the island's offset in this world, as for an
// imported Scrambled Seas world, so it lines up with recorded positions. Without the offset or the island,
// the island's centre in the game.
function islandPlace(islandId, visit) {
  const island = islandId ? islandById(islandId) : null;
  if (island && Number.isFinite(visit.offsetLat) && Number.isFinite(visit.offsetLon)) {
    return { lat: island.sourceCenter.lat + visit.offsetLat, lon: island.sourceCenter.lon + visit.offsetLon };
  }
  return { lat: visit.lat, lon: visit.lon };
}

function named(item, name, islandId) {
  return (islandId && item.islandId === islandId) || sameName(item.name ?? item.label, name);
}

// Names match whatever their case, spaces or punctuation: "Dragon CLiffs" is Dragon Cliffs.
function sameName(a, b) {
  const key = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return key(a) !== "" && key(a) === key(b);
}

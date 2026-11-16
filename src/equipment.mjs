// Equipment readings: an optional, per-chart rule that recorded positions show only what the player's
// instruments could have told them at the time. Voyage Recorder still records everything; this decides
// what the chart shows. Instruments are what the player says they had, kept as a timeline by game time,
// so buying a chronometer later never reveals positions from before it.

export const INSTRUMENTS = Object.freeze([
  { id: "compass", label: "Compass" },
  { id: "sun-compass", label: "Sun compass" },
  { id: "chronometer", label: "Chronometer" },
  { id: "clock", label: "Clock" },
  { id: "quadrant", label: "Quadrant" },
  { id: "chip-log", label: "Chip log" }
]);
const INSTRUMENT_IDS = new Set(INSTRUMENTS.map((instrument) => instrument.id));

// A sight is good for about an hour either side of local noon. Night is when the sun is down; the game
// puts dawn between about 6:10 and 6:50 local time, so 6:00 to 18:00 is taken as day.
const NOON_WINDOW_HOURS = 1;
const DAY_START = 6;
const DAY_END = 18;
const MAX_CHANGES = 200;

export function defaultEquipment() {
  return { enabled: false, changes: [] };
}

// changes: [{ t, items }], oldest first. t is the game time from which the items apply; null means from the
// start of the chart.
export function sanitizeEquipment(value) {
  const changes = Array.isArray(value?.changes) ? value.changes.map((change) => ({
    t: Number.isFinite(change?.t) && change.t >= 0 ? Number(change.t) : null,
    items: [...new Set((Array.isArray(change?.items) ? change.items : []).filter((id) => INSTRUMENT_IDS.has(id)))]
  })) : [];
  changes.sort((a, b) => (a.t ?? -1) - (b.t ?? -1));
  return { enabled: value?.enabled === true, changes: changes.slice(-MAX_CHANGES) };
}

// The instruments the player had at game time t, or now when t is unknown.
export function instrumentsAt(equipment, t) {
  const changes = equipment?.changes ?? [];
  if (!Number.isFinite(t)) return new Set(changes.at(-1)?.items ?? []);
  let items = [];
  for (const change of changes) {
    if ((change.t ?? -Infinity) > t) break;
    items = change.items;
  }
  return new Set(items);
}

// Records the instruments the player has now, applying from game time t (the latest recorded position)
// onward. A change at the same time as the last one replaces it.
export function setInstruments(equipment, items, t) {
  const change = { t: Number.isFinite(t) && t >= 0 ? t : null, items: [...new Set(items.filter((id) => INSTRUMENT_IDS.has(id)))] };
  const last = equipment.changes.at(-1);
  if (last && (last.t ?? null) === change.t) equipment.changes[equipment.changes.length - 1] = change;
  else equipment.changes.push(change);
  if (equipment.changes.length > MAX_CHANGES) equipment.changes.splice(0, equipment.changes.length - MAX_CHANGES);
}

// Local time at a position, in hours: the game's own clock (time at the prime meridian) moved by an hour
// for every 15 degrees east, as Sailwind works it out.
export function localHours(point) {
  if (!Number.isFinite(point?.t)) return null;
  return (((point.t % 24) + point.lon / 15) % 24 + 24) % 24;
}

// What the player could know of a recorded position: { lat, lon, course, speed }. Without the rule
// everything is known. A position without a game time keeps only course and speed, as no sight can be
// placed in time.
export function readingKnowledge(chart, point) {
  if (!chart.equipment?.enabled) return { lat: true, lon: true, course: true, speed: true };
  const items = instrumentsAt(chart.equipment, point.t);
  const local = localHours(point);
  const nearNoon = local !== null && Math.abs(local - 12) <= NOON_WINDOW_HOURS;
  const night = local !== null && (local < DAY_START || local >= DAY_END);
  const sunCompass = items.has("sun-compass");
  const quadrant = items.has("quadrant");
  const timekeeper = items.has("chronometer") || items.has("clock");
  const lat = (nearNoon && (sunCompass || quadrant)) || (night && quadrant);
  const lon = nearNoon && sunCompass && timekeeper;
  return { lat, lon, course: items.has("compass"), speed: items.has("chip-log") };
}

// A recorded position shown in full: its latitude and longitude were both known.
export function fullyKnown(chart, point) {
  const knowledge = readingKnowledge(chart, point);
  return knowledge.lat && knowledge.lon;
}

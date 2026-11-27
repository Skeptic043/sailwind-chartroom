// Equipment readings: an optional, per-chart rule that recorded positions show only what the player's
// instruments could have told them at the time. Voyage Recorder still records everything; this decides
// what the chart shows. Instruments are what the player says they had, kept as a timeline by game time,
// so buying a chronometer later never reveals positions from before it.
//
// Supported navigation-tool mods are opted into per chart (chart.equipment.mods):
// - Kemy's Navigation Tools: Bearing Compass and Binnacle provide compass course (Inclinometer measures
//   ship heel/pitch only, which Chartroom does not record, so it is omitted).
// - Realistic Skies (Fluffy's fork): Almanac, Quintant, Cross-staff, Mariner's astrolabe, Nocturnal,
//   Ring dial, Pocket Watch, and Watch Glass expand celestial sights, lunar distances, and timekeeping,
//   with a per-chart difficulty setting (Chronometers, Magellan, Vanilla) that governs seasons, solar
//   noon drift, Almanac requirements, rough vs. exact fixes, and unavailable tools.
// - Windicators: opting in gates recorded wind direction and speed behind Wind Compass, Telltales /
//   weathervanes, and Anemometer.
// - Climate's Barometer, Thermometer, and Hygrometer are intentionally omitted for now because Voyage
//   Recorder and Chartroom do not record or display atmospheric pressure, temperature, or humidity.

export const EQUIPMENT_MODS = Object.freeze([
  {
    id: "kemy-nav-tools",
    label: "Kemy's Navigation Tools",
    note: "Adds Bearing Compass and Binnacle for course readings."
  },
  {
    id: "realistic-skies",
    label: "Realistic Skies",
    note: "Adds Almanac, celestial sight tools, Nocturnal, Ring dial, Pocket Watch, and Watch Glass."
  },
  {
    id: "windicators",
    label: "Windicators",
    note: "Hides wind direction and speed until you select the matching Windicators tools."
  }
]);

export const REALISTIC_SKIES_DIFFICULTIES = Object.freeze([
  {
    id: "chronometers",
    label: "Chronometers (default)",
    note: "Seasons and equation of time on; all instruments available. Sun compass and Chronocompass need the Almanac."
  },
  {
    id: "magellan",
    label: "Magellan",
    note: "Age before clocks: seasons on; Quintant, Pocket Watch, Chronometer, and Chronocompass unavailable."
  },
  {
    id: "vanilla",
    label: "Vanilla",
    note: "Vanilla equatorial sun and perfect clocks; Ring dial unavailable (requires seasons)."
  }
]);

const RS_DIFFICULTY_IDS = new Set(REALISTIC_SKIES_DIFFICULTIES.map((difficulty) => difficulty.id));

const RS_UNAVAILABLE_BY_DIFFICULTY = Object.freeze({
  chronometers: new Set(),
  magellan: new Set(["chronometer", "chrono-compass", "rs-quintant", "rs-pocket-watch"]),
  vanilla: new Set(["rs-ring-dial"])
});

export const INSTRUMENTS = Object.freeze([
  // Vanilla Sailwind
  { id: "compass", label: "Compass", mod: null, note: "Course and heading" },
  { id: "sun-compass", label: "Sun compass", mod: null, note: "Noon latitude; noon longitude with a timekeeper (needs Almanac with Realistic Skies seasons)" },
  { id: "chronometer", label: "Chronometer", mod: null, note: "Prime-meridian time for longitude" },
  { id: "quadrant", label: "Quadrant", mod: null, note: "Noon and night latitude" },
  { id: "chip-log", label: "Chip log", mod: null, note: "Boat speed in knots" },
  { id: "chrono-compass", label: "Chronocompass", mod: null, note: "Compass, sun compass, and chronometer in one (needs Almanac with Realistic Skies seasons)" },

  // Kemy's Navigation Tools
  { id: "kemy-bearing-compass", label: "Bearing Compass", mod: "kemy-nav-tools", note: "Course and precise bearings" },
  { id: "kemy-binnacle", label: "Binnacle", mod: "kemy-nav-tools", note: "Gimbaled ship compass for course" },

  // Realistic Skies (Fluffy's fork)
  { id: "rs-almanac", label: "Almanac", mod: "realistic-skies", note: "Celestial tables for day/night sight reduction, lunar distances, and seasonal sun declination" },
  { id: "rs-quintant", label: "Quintant", mod: "realistic-skies", note: "Precise day/night heights and lunar distances" },
  { id: "rs-cross-staff", label: "Cross-staff", mod: "realistic-skies", note: "Day/night heights and lunar distances (rough without Almanac)" },
  { id: "rs-astrolabe", label: "Mariner's astrolabe", mod: "realistic-skies", note: "Day/night heights without a horizon" },
  { id: "rs-nocturnal", label: "Nocturnal", mod: "realistic-skies", note: "Rough local time at night for longitude with a timekeeper" },
  { id: "rs-ring-dial", label: "Ring dial", mod: "realistic-skies", note: "Daytime local sun time (away from noon and equinoxes) for longitude with a timekeeper" },
  { id: "rs-pocket-watch", label: "Pocket Watch", mod: "realistic-skies", note: "Prime-meridian timekeeper" },
  { id: "rs-watch-glass", label: "Watch Glass", mod: "realistic-skies", note: "Self-turning watch glass for rough prime-meridian time" },

  // Windicators
  { id: "windicators-wind-compass", label: "Wind Compass", mod: "windicators", note: "Compass wind direction" },
  { id: "windicators-anemometer", label: "Anemometer", mod: "windicators", note: "Wind speed in knots" },
  { id: "windicators-telltales", label: "Telltales / weathervanes", mod: "windicators", note: "Wind direction on the chart" }
]);

const INSTRUMENT_BY_ID = new Map(INSTRUMENTS.map((instrument) => [instrument.id, instrument]));

// A sight is good for about an hour either side of local noon. In vanilla Sailwind, dawn is between about
// 6:10 and 6:50 local time, so 6:00 to 18:00 is taken as day. With Realistic Skies seasons on, axial tilt
// (23.44 deg over a 92-day year starting at the autumn equinox) shifts sunrise/sunset and solar noon.
const NOON_WINDOW_HOURS = 1;
const DAY_START = 6;
const DAY_END = 18;
const RS_YEAR_DAYS = 92;
const RS_AXIAL_TILT_DEG = 23.44;
const RS_EOT_HOURS = 0.33;
const RS_RING_DIAL_MIN_DEC_DEG = 2.5;
const DEG = Math.PI / 180;
const MAX_CHANGES = 200;

export function defaultEquipment() {
  return { enabled: false, mods: [], rsDifficulty: "chronometers", changes: [] };
}

function sanitizeIdList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || id.length > 64 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function sanitizeInstrumentIds(list) {
  return sanitizeIdList(Array.isArray(list) ? list.map((id) => (id === "clock" ? "chronometer" : id)) : []);
}

// changes: [{ t, items }], oldest first. t is the game time from which the items apply; null means from the
// start of the chart. Unknown instrument/mod IDs are preserved so saved charts stay compatible across updates.
export function sanitizeEquipment(value) {
  const mods = sanitizeIdList(value?.mods);
  const rsDifficulty = RS_DIFFICULTY_IDS.has(value?.rsDifficulty) ? value.rsDifficulty : "chronometers";
  const changes = Array.isArray(value?.changes) ? value.changes.map((change) => ({
    t: Number.isFinite(change?.t) && change.t >= 0 ? Number(change.t) : null,
    items: sanitizeInstrumentIds(change?.items)
  })) : [];
  changes.sort((a, b) => (a.t ?? -1) - (b.t ?? -1));
  return { enabled: value?.enabled === true, mods, rsDifficulty, changes: changes.slice(-MAX_CHANGES) };
}

export function instrumentLabel(id) {
  return INSTRUMENT_BY_ID.get(id)?.label ?? id;
}

export function difficultyLabel(id) {
  return REALISTIC_SKIES_DIFFICULTIES.find((difficulty) => difficulty.id === id)?.label ?? "Chronometers (default)";
}

export function unavailableInstruments(equipment) {
  if (!(equipment?.mods ?? []).includes("realistic-skies")) return new Set();
  const difficulty = RS_DIFFICULTY_IDS.has(equipment.rsDifficulty) ? equipment.rsDifficulty : "chronometers";
  return new Set(RS_UNAVAILABLE_BY_DIFFICULTY[difficulty]);
}

export function setEquipmentMods(equipment, mods) {
  equipment.mods = sanitizeIdList(mods);
}

export function setRealisticSkiesDifficulty(equipment, difficulty) {
  equipment.rsDifficulty = RS_DIFFICULTY_IDS.has(difficulty) ? difficulty : "chronometers";
}

export function removeEquipmentChange(equipment, index) {
  if (!Array.isArray(equipment?.changes)) return;
  if (index >= 0 && index < equipment.changes.length) equipment.changes.splice(index, 1);
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

// Active instruments at game time t, filtered to vanilla plus mods currently enabled on the chart,
// excluding tools unavailable in the chosen Realistic Skies difficulty.
function activeInstrumentsAt(equipment, t) {
  const enabledMods = new Set(equipment?.mods ?? []);
  const unavailable = unavailableInstruments(equipment);
  const raw = instrumentsAt(equipment, t);
  const active = new Set();
  for (const id of raw) {
    if (unavailable.has(id)) continue;
    const def = INSTRUMENT_BY_ID.get(id);
    if (!def) continue;
    if (def.mod === null || enabledMods.has(def.mod)) active.add(id);
  }
  return active;
}

// Records the instruments the player has now, applying from game time t (the latest recorded position)
// onward. A change at the same time as the last one replaces it. Unknown or currently disabled-mod
// instruments from the previous entry are preserved so toggling a mod off doesn't erase saved history.
export function setInstruments(equipment, items, t, preserveHidden = false) {
  const next = sanitizeIdList(items);
  if (preserveHidden) {
    const enabledMods = new Set(equipment?.mods ?? []);
    const unavailable = unavailableInstruments(equipment);
    for (const id of instrumentsAt(equipment, null)) {
      const def = INSTRUMENT_BY_ID.get(id);
      if ((!def || unavailable.has(id) || (def.mod !== null && !enabledMods.has(def.mod))) && !next.includes(id)) next.push(id);
    }
  }
  const change = { t: Number.isFinite(t) && t >= 0 ? t : null, items: next };
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

// Solar state at a recorded point: solar noon, day start/end, and sun declination.
// In Realistic Skies (Chronometers and Magellan), day 0 is the autumn equinox on a 92-day year with 23.44 deg
// axial tilt and equation-of-time noon drift.
function solarState(point, realisticSeasons) {
  if (!realisticSeasons || !Number.isFinite(point?.t)) {
    return { noon: 12, halfDay: (DAY_END - DAY_START) / 2, declination: 0 };
  }
  const day = Math.floor(point.t / 24);
  const phase = (2 * Math.PI * (((day % RS_YEAR_DAYS) + RS_YEAR_DAYS) % RS_YEAR_DAYS)) / RS_YEAR_DAYS;
  const declination = -RS_AXIAL_TILT_DEG * Math.sin(phase);
  const noon = 12 + RS_EOT_HOURS * Math.sin(2 * phase);
  const lat = Number.isFinite(point.lat) ? Math.max(-85, Math.min(85, point.lat)) : 30;
  const cosH = Math.max(-1, Math.min(1, -Math.tan(lat * DEG) * Math.tan(declination * DEG)));
  const halfDay = (Math.acos(cosH) / DEG) / 15;
  return { noon, halfDay, declination };
}

// What the player could know of a recorded position: { lat, lon, course, speed, windDir, windSpeed, rough }.
// Without the rule everything is known. A position without a game time keeps only non-celestial readings,
// as no sight can be placed in time.
export function readingKnowledge(chart, point) {
  if (!chart.equipment?.enabled) {
    return { lat: true, lon: true, course: true, speed: true, windDir: true, windSpeed: true, rough: false };
  }
  const enabledMods = new Set(chart.equipment.mods ?? []);
  const rsEnabled = enabledMods.has("realistic-skies");
  const rsDifficulty = RS_DIFFICULTY_IDS.has(chart.equipment.rsDifficulty) ? chart.equipment.rsDifficulty : "chronometers";
  const rsSeasons = rsEnabled && rsDifficulty !== "vanilla";

  const items = activeInstrumentsAt(chart.equipment, point?.t);
  const local = localHours(point);
  const hasTime = local !== null;
  const solar = solarState(point, rsSeasons);
  const noonDelta = hasTime ? Math.min(Math.abs(local - solar.noon), 24 - Math.abs(local - solar.noon)) : Infinity;
  const nearNoon = hasTime && noonDelta <= NOON_WINDOW_HOURS;
  const night = hasTime && solar.halfDay < 12 && noonDelta >= solar.halfDay;
  const dayAwayFromNoon = hasTime && !night && !nearNoon;

  const chronoCompass = items.has("chrono-compass");
  const sunCompass = items.has("sun-compass") || chronoCompass;
  const quadrant = items.has("quadrant");
  const almanac = items.has("rs-almanac");
  const quintant = items.has("rs-quintant");
  const crossStaff = items.has("rs-cross-staff");
  const astrolabe = items.has("rs-astrolabe");
  const rsAltitude = quintant || crossStaff || astrolabe;
  const lunarCapable = almanac && (quintant || crossStaff);
  const exactClock = items.has("chronometer") || chronoCompass || items.has("rs-pocket-watch");
  const watchGlass = items.has("rs-watch-glass");
  const timekeeper = exactClock || watchGlass || lunarCapable;

  // Under Realistic Skies seasons, Sun compass and Chrono-compass need the Almanac's declination/EoT tables
  // for accurate fixes; without the Almanac, they still give rough noon readings.
  const sunCompassAccurate = sunCompass && (!rsSeasons || almanac);
  const sunCompassRough = sunCompass && rsSeasons && !almanac;
  const ringDialUsable = items.has("rs-ring-dial") && rsSeasons && Math.abs(solar.declination) >= RS_RING_DIAL_MIN_DEC_DEG;

  const exactLat = (nearNoon && sunCompassAccurate)
    || (!rsEnabled && ((nearNoon && quadrant) || (night && quadrant)))
    || (rsEnabled && hasTime && almanac && (quintant || astrolabe || crossStaff))
    || (rsEnabled && (nearNoon || night) && (quintant || astrolabe));

  const roughLat = !exactLat && (
    (nearNoon && (sunCompassRough || quadrant || crossStaff))
    || (night && (quadrant || crossStaff))
    || (rsEnabled && hasTime && almanac && quadrant)
  );

  const lat = exactLat || roughLat;

  const exactLon = (nearNoon && sunCompassAccurate && exactClock)
    || (rsEnabled && hasTime && almanac && (quintant || astrolabe || crossStaff) && exactClock);

  const roughLon = !exactLon && (
    (nearNoon && sunCompass && timekeeper)
    || (rsEnabled && hasTime && almanac && (rsAltitude || quadrant) && timekeeper)
    || (night && items.has("rs-nocturnal") && timekeeper)
    || (dayAwayFromNoon && ringDialUsable && timekeeper)
  );

  const lon = exactLon || roughLon;
  const rough = lat && lon && (roughLat || roughLon);

  const course = items.has("compass")
    || chronoCompass
    || items.has("kemy-bearing-compass")
    || items.has("kemy-binnacle");

  const speed = items.has("chip-log");

  const windGated = enabledMods.has("windicators");
  const windDir = !windGated
    || items.has("windicators-wind-compass")
    || items.has("windicators-telltales");
  const windSpeed = !windGated || items.has("windicators-anemometer");

  return { lat, lon, course, speed, windDir, windSpeed, rough };
}

// Human-readable summary of what the chart's current instruments can read.
export function summarizeKnowledge(equipment) {
  if (!equipment?.enabled) return "All recorded values are shown.";
  // Sample mid-season (day 23) so seasonal tools like the Ring dial aren't sampled on the equinox blackout.
  const snapshot = {
    enabled: true,
    mods: equipment.mods ?? [],
    rsDifficulty: equipment.rsDifficulty ?? "chronometers",
    changes: [{ t: null, items: [...instrumentsAt(equipment, null)] }]
  };
  const sample = (hour) => readingKnowledge({ equipment: snapshot }, { t: 23 * 24 + hour, lat: 30, lon: 0 });
  const noon = sample(12);
  const day = sample(9.5);
  const night = sample(23);
  const parts = [];

  if (day.lat && noon.lat && night.lat) parts.push("Latitude (any time)");
  else if (noon.lat && night.lat) parts.push("Latitude (noon & night)");
  else if (noon.lat) parts.push("Latitude (noon)");
  else if (night.lat) parts.push("Latitude (night)");

  if (day.lon && noon.lon && night.lon) parts.push("Longitude (any time)");
  else {
    const windows = [];
    if (noon.lon) windows.push("noon");
    if (day.lon) windows.push("day");
    if (night.lon) windows.push("night");
    if (windows.length) parts.push(`Longitude (${windows.join(" & ")})`);
  }

  const anyFix = [noon, day, night].filter((item) => item.lat && item.lon);
  if (anyFix.length && anyFix.every((item) => item.rough)) parts.push("Rough fixes");

  if (noon.course) parts.push("Course");
  if (noon.speed) parts.push("Speed");
  if ((equipment.mods ?? []).includes("windicators")) {
    if (noon.windDir && noon.windSpeed) parts.push("Wind (direction & speed)");
    else if (noon.windDir) parts.push("Wind direction");
    else if (noon.windSpeed) parts.push("Wind speed");
  }

  return parts.length ? `Reads: ${parts.join(" · ")}` : "No readings unlocked — select instruments below.";
}

// A recorded position shown in full: its latitude and longitude were both known.
export function fullyKnown(chart, point) {
  const knowledge = readingKnowledge(chart, point);
  return knowledge.lat && knowledge.lon;
}

// Voyage files: one trip from a chart's Voyage Recorder track, shared to compare with other players in
// Chartroom or to send to Chartroom Voyages. Format (version 1):
// { format: "sailwind-voyage", version: 1, exported, chartroom, name, note, world, game, plugins?,
//   points: [{ t, utc?, lat, lon, knots?, course?, windFrom?, windKnots?, boat?, hull?, event? }],
//   visits?: [{ kind, port, island, t, utc? }], notes?: [{ t, lat, lon, text }] }
// The save slot, file paths and the game id never leave the player's computer: game is a one-way hash of
// the game id, used only to recognise the same game twice. A voyage without world data says "unknown" and
// can be compared but not entered on Chartroom Voyages.

export const VOYAGE_FORMAT = "sailwind-voyage";
export const VOYAGE_VERSION = 1;
export const VOYAGE_EXTENSION = ".voyage.json";
const MAX_POINTS = 200000;
const MAX_VISITS = 5000;
const MAX_NOTES = 2000;

// What a player can choose to leave out. The track itself is the voyage, so it always goes.
export const SHARE_OPTIONS = Object.freeze([
  { id: "visits", label: "Port visits", default: true },
  { id: "boat", label: "Boat", default: true },
  { id: "wind", label: "Wind", default: true },
  { id: "hull", label: "Hull damage", default: true },
  { id: "plugins", label: "Loaded mods", default: true },
  { id: "notes", label: "Notes", default: false },
  { id: "marks", label: "Recorded locations (marks)", default: false }
]);

export function defaultShare() {
  return Object.fromEntries(SHARE_OPTIONS.map((option) => [option.id, option.default]));
}

// The track's points that can be exported: Voyage Recorder positions with a game time, in order, from the
// latest game, since the chart's world, mods and game id describe that one.
export function exportablePoints(chart) {
  const points = chart.track.filter((point) => point.source === "voyage" && Number.isFinite(point.t));
  const latest = points.findLastIndex((point) => point.newGame);
  return latest > 0 ? points.slice(latest) : points;
}

// The positions points[from..to] (inclusive) of exportablePoints(chart) that a file with these choices holds.
// A session break on a left-out mark moves to the next position, so it isn't lost.
export function chosenPoints(chart, from, to, share = defaultShare()) {
  const chosen = [];
  let pendingBreak = false;
  for (const point of exportablePoints(chart).slice(from, to + 1)) {
    if (!share.marks && point.event === "mark") {
      pendingBreak ||= point.newSession === true;
      continue;
    }
    chosen.push(pendingBreak ? { ...point, newSession: true } : point);
    pendingBreak = false;
  }
  return chosen;
}

// Builds the file for points[from..to] (inclusive) of exportablePoints(chart). gameHash is the hashed game
// id (see hashGameId), or "" when the recording had none.
export function buildVoyageFile(chart, { from, to, share = defaultShare(), name = "", note = "", gameHash = "", version = "" }) {
  const points = chosenPoints(chart, from, to, share);
  if (points.length < 2) throw new Error("Choose at least two positions to export.");
  const start = points[0].t;
  const end = points.at(-1).t;
  const file = {
    format: VOYAGE_FORMAT,
    version: VOYAGE_VERSION,
    exported: new Date().toISOString(),
    chartroom: String(version),
    name: String(name).trim().slice(0, 80),
    note: String(note).trim().slice(0, 500),
    world: chart.recording?.world ?? { kind: "unknown" },
    game: gameHash,
    ...(share.plugins && chart.recording?.plugins && { plugins: chart.recording.plugins }),
    points: points.map((point, index) => exportPoint(point, share, index))
  };
  if (share.visits) file.visits = chart.visits.filter((visit) => visit.t >= start && visit.t <= end).map((visit) => ({ ...visit }));
  if (share.notes) file.notes = chart.notes.filter((entry) => Number.isFinite(entry.t) && entry.t >= start && entry.t <= end)
    .map((entry) => ({ t: entry.t, lat: entry.lat, lon: entry.lon, text: entry.text }));
  return file;
}

// The range's first position always starts its stretch; later session starts keep their break, so a
// comparison doesn't join one sitting to the next.
function exportPoint(point, share, index) {
  return {
    t: round(point.t, 4),
    ...(Number.isFinite(point.utc) && { utc: round(point.utc, 3) }),
    lat: round(point.lat, 7),
    lon: round(point.lon, 7),
    ...(Number.isFinite(point.knots) && { knots: round(point.knots, 1) }),
    ...(Number.isFinite(point.course) && { course: round(point.course, 1) }),
    // The chart keeps where the wind blows toward; the file says where it comes from, as Voyage Recorder does.
    ...(share.wind && Number.isFinite(point.windDeg) && { windFrom: round((point.windDeg + 180) % 360, 1) }),
    ...(share.wind && Number.isFinite(point.windKnots) && { windKnots: round(point.windKnots, 1) }),
    ...(share.boat && point.boat && { boat: point.boat }),
    ...(share.hull && Number.isFinite(point.hull) && { hull: point.hull }),
    ...(point.event && { event: point.event }),
    ...(index > 0 && point.newSession && { newSession: true })
  };
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// A one-way hash of the game id: the first 16 hex digits of its SHA-256, salted so the id itself can't be
// looked up from it.
export async function hashGameId(game) {
  if (!game) return "";
  const bytes = new TextEncoder().encode(`sailwind-voyage:${game}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return [...digest.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Reads a voyage file, checking only what comparing needs. Throws with a message for the player.
export function parseVoyageFile(value) {
  // A run downloaded from a Chartroom Voyages board holds the voyage it was sailed in.
  if (typeof value?.course === "string" && value.voyage?.format === VOYAGE_FORMAT) value = value.voyage;
  if (value?.format !== VOYAGE_FORMAT) throw new Error("This isn't a voyage file. Export one from File > Export voyage.");
  if (!Number.isInteger(value.version) || value.version < 1) throw new Error("This voyage file has no readable version.");
  if (value.version > VOYAGE_VERSION) throw new Error("This voyage file was made by a newer version of Chartroom. Update Chartroom to open it.");
  const points = (Array.isArray(value.points) ? value.points : []).slice(0, MAX_POINTS).filter((point) =>
    Number.isFinite(point?.t) && Number.isFinite(point?.lat) && Number.isFinite(point?.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180
  ).map((point) => ({
    t: Number(point.t),
    lat: Number(point.lat),
    lon: Number(point.lon),
    ...(Number.isFinite(point.utc) && { utc: Number(point.utc) }),
    ...(Number.isFinite(point.knots) && { knots: Number(point.knots) }),
    ...(Number.isFinite(point.course) && { course: Number(point.course) }),
    ...(Number.isFinite(point.windFrom) && { windFrom: Number(point.windFrom) }),
    ...(Number.isFinite(point.windKnots) && { windKnots: Number(point.windKnots) }),
    ...(typeof point.boat === "string" && point.boat && { boat: point.boat.slice(0, 60) }),
    ...(Number.isFinite(point.hull) && { hull: Number(point.hull) }),
    ...(typeof point.event === "string" && point.event && { event: point.event.slice(0, 20) }),
    ...(point.newSession === true && { newSession: true })
  }));
  points.sort((a, b) => a.t - b.t);
  if (points.length < 2) throw new Error("This voyage file has fewer than two positions.");
  const visits = (Array.isArray(value.visits) ? value.visits : []).slice(0, MAX_VISITS).filter((visit) => Number.isFinite(visit?.t) && typeof visit?.port === "string")
    .map((visit) => ({ kind: visit.kind === "depart" ? "depart" : "arrive", port: visit.port.slice(0, 100), island: Number.isInteger(visit.island) ? visit.island : -1, t: Number(visit.t) }));
  const notes = (Array.isArray(value.notes) ? value.notes : []).slice(0, MAX_NOTES).filter((entry) => Number.isFinite(entry?.t) && Number.isFinite(entry?.lat) && Number.isFinite(entry?.lon))
    .map((entry) => ({ t: Number(entry.t), lat: Number(entry.lat), lon: Number(entry.lon), text: String(entry.text ?? "").slice(0, 20000) }));
  return {
    name: String(value.name ?? "").trim().slice(0, 80),
    note: String(value.note ?? "").trim().slice(0, 500),
    world: value.world && typeof value.world === "object" && typeof value.world.kind === "string" ? value.world : { kind: "unknown" },
    game: String(value.game ?? "").slice(0, 40),
    points,
    visits,
    notes
  };
}

// Whether two worlds are the same map. Scrambled Seas worlds match by their layout fingerprint, or by seed
// and settings when a fingerprint is missing. null when either world is unknown.
export function sameWorld(a, b) {
  if (!a || !b || a.kind === "unknown" || b.kind === "unknown") return null;
  if (a.kind !== b.kind) return false;
  if (a.kind === "vanilla") return true;
  if (a.layout && b.layout) return a.layout === b.layout;
  return ["seed", "islandSpread", "minArchipelagoSeparation", "minIslandSeparation", "lonMin", "lonMax", "latMin", "latMax", "borderExpander"].every((key) => a[key] === b[key]);
}

// Where a voyage was after sailing for `elapsed` game hours from game time `start`: the position between the
// two readings either side, or null before the start or after the last reading.
export function positionAtElapsed(points, start, elapsed) {
  const t = start + elapsed;
  if (!points.length || t < points[0].t || t > points.at(-1).t || elapsed < 0) return null;
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (points[middle].t <= t) low = middle; else high = middle;
  }
  const a = points[low];
  const b = points[high];
  const share = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  // The short way across the east and west edges, as the track itself is drawn.
  const dLon = ((b.lon - a.lon + 540) % 360) - 180;
  const lon = ((a.lon + dLon * share + 540) % 360) - 180;
  return { lat: a.lat + (b.lat - a.lat) * share, lon, point: share < 0.5 ? a : b };
}

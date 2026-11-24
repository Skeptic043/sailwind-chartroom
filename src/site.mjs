// Chartroom Voyages, the site for shared voyages, heatmaps and race boards: where it lives, and what Chartroom
// works out locally before sending a player there. Submitting always happens on GitHub, in the player's own
// browser; Chartroom only reads the site's public data and opens its forms.
import { SETTINGS, worldKey } from "./site-world-key.mjs";
import { ISLANDS } from "./site-islands.mjs";
import { validateCourse } from "./site-course.mjs";
import { checkRun } from "./site-race.mjs";

export const SITE_URL = "https://skeptic043.github.io/sailwind-chartroom-voyages/";
export const SITE_REPOSITORY = "https://github.com/Skeptic043/sailwind-chartroom-voyages";
export const WORLD_GENERATOR_URL = "https://skeptic043.github.io/scrambled-seas-world-generator/";
// A waypoint that isn't on an island becomes an open-water mark this wide.
export const MARK_RADIUS_NM = 3;
const MAX_FORM_URL = 8000;

export { worldKey };

// Reads a Scrambled Seas save XML into the world settings object Chartroom Voyages uses.
export function worldFromXml(xml) {
  const read = (tag) => {
    const match = new RegExp(`<${tag}>\\s*(-?\\d+)\\s*</${tag}>`).exec(String(xml));
    return match ? Number(match[1]) : null;
  };
  const world = {
    kind: "scrambled",
    seed: read("worldScramblerSeed"),
    islandSpread: read("islandSpread"),
    minArchipelagoSeparation: read("minArchipelagoSeparation"),
    minIslandSeparation: read("minIslandSeparation"),
    lonMin: read("worldLonMin"),
    lonMax: read("worldLonMax"),
    latMin: read("worldLatMin"),
    latMax: read("worldLatMax"),
    borderExpander: read("borderExpander"),
    scrambler: read("version")
  };
  if (!Number.isInteger(world.seed)) throw new Error("The Scrambled Seas XML has no seed.");
  for (const setting of SETTINGS) {
    if (!Number.isInteger(world[setting])) throw new Error(`The Scrambled Seas XML is missing ${setting}.`);
  }
  if (!worldKey(world)) throw new Error("The Scrambled Seas XML has invalid world bounds.");
  return world;
}

// Whether text is a Scrambled Seas World Generator share link (checked in full on the site).
export function isWorldGeneratorLink(text) {
  let link;
  try {
    link = new URL(String(text ?? "").trim());
  } catch {
    return false;
  }
  if (link.origin + link.pathname !== WORLD_GENERATOR_URL) return false;
  const params = new URLSearchParams(link.hash.replace(/^#/, ""));
  const seed = params.get("seed");
  return params.get("v") === "1" && seed !== null && /^-?\d+$/.test(seed);
}

// The site's issue form for a submission, with fields filled in where GitHub allows it.
export function issueFormUrl(template, fields = {}) {
  const query = new URLSearchParams({ template: `${template}.yml`, ...fields });
  const url = `${SITE_REPOSITORY}/issues/new?${query}`;
  if (url.length > MAX_FORM_URL) throw new Error("This is too long to fill in the form for you.");
  return url;
}

// Whether a link is one Chartroom opens: the site's pages, or a new issue on its repository. The desktop hosts
// check the same in desktop/HostMessage.cs and macos/Sources/ChartroomCore/HostMessage.swift.
export function isSiteLink(url) {
  let link;
  try {
    link = new URL(url);
  } catch {
    return false;
  }
  if (link.protocol !== "https:" || link.username || link.password || link.port) return false;
  return (link.hostname === "skeptic043.github.io" && link.pathname.startsWith("/sailwind-chartroom-voyages/"))
    || (link.hostname === "github.com" && link.pathname === "/Skeptic043/sailwind-chartroom-voyages/issues/new");
}

export function siteUrl(path = "") {
  return new URL(path, SITE_URL).href;
}

// Reads one of the site's JSON files. Throws with a message for the player.
export async function siteData(path, fetcher = globalThis.fetch) {
  let response;
  try {
    response = await fetcher(siteUrl(path), { cache: "no-cache" });
  } catch {
    throw new Error("Chartroom Voyages couldn't be reached. Check your connection and try again.");
  }
  if (!response.ok) throw new Error(response.status === 404 ? "Chartroom Voyages has nothing there yet." : `Chartroom Voyages returned status ${response.status}.`);
  return response.json();
}

// Checks an exported voyage file against a course the way the site will, so problems show before submitting.
export function checkRaceLocally(course, file) {
  return checkRun(validateCourse(course), { ...file, plugins: file.plugins ?? null, visits: file.visits ?? [] });
}

// Which Include checkboxes a race requires to be checked so the entry can pass validation.
export function requiredShareOptions(course) {
  const required = new Set(["plugins"]);
  if (!course) return required;
  const targets = [course.start, ...(course.checkpoints ?? []), course.finish].filter(Boolean);
  if (targets.some((target) => target.island)) required.add("visits");
  if ((Array.isArray(course.rules?.boats) && course.rules.boats.length) || course.rules?.oneBoat) required.add("boat");
  if (Number.isFinite(course.rules?.maxHull)) required.add("hull");
  return required;
}

// Scans all exportable points for the fastest valid run of course and returns { from, to, result } indices
// suitable for the Start/End sliders, or null if no valid run exists in the track.
export function findRaceRunRange(course, points, visits = [], plugins = null) {
  if (!course || !Array.isArray(points) || points.length < 2) return null;
  const checked = validateCourse(course);
  const full = checkRun(checked, { points, visits, plugins });
  if (!full.ok) return null;
  let from = points.findIndex((point) => point.t >= full.start);
  if (from < 0) from = 0;
  else if (from > 0) from -= 1;
  let to = points.findIndex((point, index) => index >= from && point.t >= full.finish);
  if (to < 0) to = points.length - 1;
  if (to <= from) to = Math.min(points.length - 1, from + 1);
  return { from, to, result: full };
}

// A course from a planned route. Each waypoint on a vanilla island becomes that island; any other waypoint,
// and every waypoint in a Scrambled Seas world (whose islands move), becomes an open-water mark. The first
// waypoint is the start. A route that comes back to its start finishes there; otherwise the run ends at the
// last checkpoint reached.
export function courseFromRoute(points, world, options) {
  const key = worldKey(world);
  if (!key) throw new Error("A course for a Scrambled Seas world needs a recording from that world on this chart.");
  const targets = [];
  points.forEach((point, index) => {
    const island = key === "vanilla" ? islandAt(point) : null;
    const target = island
      ? { island: island.id }
      : { name: String(point.name || `Mark ${index + 1}`).slice(0, 60), lat: round(point.lat), lon: round(point.lon), radiusNm: MARK_RADIUS_NM };
    if (!targets.length || !sameTarget(targets.at(-1), target)) targets.push(target);
  });
  if (targets.length < 2) throw new Error("A course needs a route with at least two stops.");
  const [start, ...rest] = targets;
  const returns = rest.length >= 2 && sameTarget(rest.at(-1), start);
  const id = String(options.id || options.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return validateCourse({
    ...options,
    id,
    world: key,
    start,
    checkpoints: returns ? rest.slice(0, -1) : rest,
    finish: returns ? start : { lastCheckpoint: true },
    spoiler: targets.some((target) => target.island && ISLANDS.find((island) => island.id === target.island)?.secret)
  });
}

function islandAt(point) {
  let best = null;
  for (const island of ISLANDS) {
    const distance = Math.hypot(point.lat - island.lat, point.lon - island.lon);
    if (distance <= island.reachDeg && (!best || distance < best.distance)) best = { island, distance };
  }
  return best?.island ?? null;
}

function sameTarget(a, b) {
  return a.island ? a.island === b.island : !b.island && a.lat === b.lat && a.lon === b.lon;
}

function round(value) {
  return Math.round(Number(value) * 1e5) / 1e5;
}

// The site's heatmap as squares to draw: { lat, lon, size, share } with share from 0 to 1.
export function heatmapSquares(heatmap) {
  const { cells = {}, cellDegrees = 0.2, max = 0 } = heatmap ?? {};
  return Object.entries(cells).map(([cell, count]) => {
    const [row, column] = cell.split(",").map(Number);
    return { lat: row * cellDegrees, lon: column * cellDegrees, size: cellDegrees, share: max ? count / max : 0 };
  }).filter((square) => Number.isFinite(square.lat) && Number.isFinite(square.lon));
}

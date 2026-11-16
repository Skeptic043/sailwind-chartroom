// Copied from Chartroom Voyages lib/course.mjs with imports renamed. Change it there and copy it here again, so a
// race checked in Chartroom is checked the same way on the site.
// Courses: a route to race, with rules a voyage file can show. Anyone can create one; the site only checks
// that it is well formed and that its rules can be checked. A course never changes once runs are accepted;
// its author publishes a new version instead.
import { islandById } from "./site-islands.mjs";

const SORTS = new Set(["game", "irl"]);
const MOD_MODES = new Set(["any", "block", "require", "only"]);
const ORDERS = new Set(["fixed", "any"]);
const MAX_CHECKPOINTS = 60;

function target(value, label) {
  if (value?.island) {
    if (!islandById(value.island)) throw new Error(`${label}: unknown island "${value.island}".`);
    return { island: value.island };
  }
  if (Number.isFinite(value?.lat) && Number.isFinite(value?.lon)) {
    const radiusNm = Number(value.radiusNm);
    if (!(radiusNm >= 0.5 && radiusNm <= 50)) throw new Error(`${label}: a mark needs a radius between 0.5 and 50 nm.`);
    return { name: String(value.name ?? "Mark").trim().slice(0, 60) || "Mark", lat: Number(value.lat), lon: Number(value.lon), radiusNm };
  }
  throw new Error(`${label} must be an island or a mark with a position and radius.`);
}

// A checked course, or throws with what's wrong.
export function validateCourse(value) {
  const id = String(value?.id ?? "");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || id.length > 60) throw new Error("A course id is lowercase letters, numbers and dashes.");
  const name = String(value.name ?? "").trim().slice(0, 80);
  if (!name) throw new Error("A course needs a name.");
  if (typeof value.world !== "string" || !/^(vanilla|ss-[0-9a-f]{16})$/.test(value.world)) throw new Error("A course is for vanilla or one Scrambled Seas world.");
  if (value.world !== "vanilla" && (value.checkpoints ?? []).some((checkpoint) => checkpoint?.island)) {
    throw new Error("Islands move in Scrambled Seas worlds, so their courses use marks.");
  }
  const checkpoints = (Array.isArray(value.checkpoints) ? value.checkpoints : []).map((checkpoint, index) => target(checkpoint, `Checkpoint ${index + 1}`));
  if (!checkpoints.length || checkpoints.length > MAX_CHECKPOINTS) throw new Error(`A course has 1 to ${MAX_CHECKPOINTS} checkpoints.`);
  const start = value.start?.any ? { any: true } : target(value.start, "The start");
  const finish = value.finish?.lastCheckpoint ? { lastCheckpoint: true } : target(value.finish, "The finish");
  if (start.any && value.order === "fixed") throw new Error("A course that starts at any checkpoint visits them in any order.");
  const rules = value.rules ?? {};
  const mods = rules.mods ?? { mode: "any" };
  if (!MOD_MODES.has(mods.mode)) throw new Error("Mod rules are any, block, require or only.");
  const plugins = Array.isArray(mods.plugins) ? mods.plugins.map((guid) => String(guid).trim().slice(0, 200)).filter(Boolean) : [];
  if ((mods.mode === "block" || mods.mode === "require") && !plugins.length) throw new Error("Blocked or required mods need at least one plugin id.");
  return {
    id,
    version: Number.isInteger(value.version) && value.version > 0 ? value.version : 1,
    name,
    author: String(value.author ?? "").trim().slice(0, 60),
    description: String(value.description ?? "").trim().slice(0, 1000),
    world: value.world,
    start,
    checkpoints,
    order: ORDERS.has(value.order) ? value.order : "any",
    finish,
    spoiler: value.spoiler === true,
    rules: {
      sortBy: SORTS.has(rules.sortBy) ? rules.sortBy : "game",
      mods: { mode: mods.mode, plugins },
      boats: Array.isArray(rules.boats) ? rules.boats.map((boat) => String(boat).trim().slice(0, 60)).filter(Boolean) : null,
      oneBoat: rules.oneBoat === true,
      maxHull: Number.isFinite(rules.maxHull) ? Math.min(100, Math.max(0, Math.round(rules.maxHull))) : null,
      honour: String(rules.honour ?? "").trim().slice(0, 500)
    }
  };
}

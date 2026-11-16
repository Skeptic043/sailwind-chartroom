// Copied from Chartroom Voyages lib/world-key.mjs with imports renamed. Change it there and copy it here again, so a
// race checked in Chartroom is checked the same way on the site.
// World keys: "vanilla", or "ss-<hash>" of a Scrambled Seas world's seed and every setting that shapes it.
// No Node APIs, so Sailwind Chartroom carries an exact copy in src/site/ to match courses to its charts.

export const SETTINGS = ["seed", "islandSpread", "minArchipelagoSeparation", "minIslandSeparation", "lonMin", "lonMax", "latMin", "latMax", "borderExpander", "scrambler"];

// "vanilla", "ss-<hash>" for a Scrambled Seas world, or null when the world isn't known. A Scrambled Seas world
// missing any of its settings isn't known: without them it can't be told apart from another map.
export function worldKey(world) {
  if (world?.kind === "vanilla") return "vanilla";
  if (world?.kind !== "scrambled" || !SETTINGS.every((key) => Number.isInteger(world[key]))) return null;
  if (world.lonMin >= world.lonMax || world.latMin >= world.latMax) return null;
  return `ss-${fnv(SETTINGS.map((key) => `${key}=${Number.isInteger(world[key]) ? world[key] : ""}`).join("&"))}`;
}

function fnv(text) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

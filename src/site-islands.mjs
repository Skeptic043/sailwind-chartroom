// Copied from Chartroom Voyages lib/islands.mjs with imports renamed. Change it there and copy it here again, so a
// race checked in Chartroom is checked the same way on the site.
// Vanilla Sailwind's islands, from Chartroom's island catalog (outlines from the Sailwind Web Map, MIT; see
// THIRD-PARTY-NOTICES.md), with the game's island numbers that Voyage Recorder writes on port visits.
import { ISLAND_CATALOG } from "./island-catalog.generated.mjs";

// Game island number → catalog id, as in Chartroom's src/scrambled-seas.mjs.
const GAME_ISLANDS = Object.freeze({
  1: "alankh/gold_rock_city", 2: "alankh/alnilem", 3: "alankh/neverdin", 4: "alankh/albacore_town",
  5: "alankh/isle_of_clear_mind", 6: "alankh/lions_fang", 7: "alankh/alchemists_island", 8: "alankh/alankh_academy",
  9: "emerald/dragon_cliffs", 10: "emerald/sanctuary", 11: "emerald/crab_beach", 12: "emerald/new_port",
  13: "emerald/sage_hills", 15: "aestrin/fort_aestrin", 16: "aestrin/sunspire", 17: "aestrin/mount_malefic",
  18: "bay/happy_bay", 19: "aestrin/eastwind", 20: "alankh/oasis", 21: "aestrin/siren_song", 22: "emerald/serpent_isle",
  23: "aestrin/oracle", 25: "chronos/chronos", 26: "firefish/fire_fish_town", 27: "firefish/kicia_bay",
  28: "firefish/senna", 29: "firefish/onna", 30: "aestrin/rock_of_despair",
  31: "firefish/fire_fish_islands/north_sandbar", 32: "alankh/eleann_island", 33: "aestrin/firefly_grotto",
  34: "aestrin/aestra_abbey", 35: "aestrin/fey_valley", 36: "aestrin/bone_isle", 37: "emerald/dead_cove",
  38: "emerald/turtle_island", 39: "emerald/pondering_peak", 40: "alankh/old_ankh_town", 41: "alankh/mirage_mountain",
  42: "alankh/saffron", 67: "better-ports/bottleneck"
});
const NUMBERS = new Map(Object.entries(GAME_ISLANDS).map(([number, id]) => [id, Number(number)]));

// Reaching an island means passing within its outline's reach plus this margin, about three miles.
const REACH_MARGIN_DEG = 0.02;

export const ISLANDS = Object.freeze(ISLAND_CATALOG.map((island) => ({
  id: island.id,
  name: island.name,
  region: island.region,
  secret: island.secret === true,
  number: NUMBERS.get(island.id) ?? null,
  lat: island.sourceCenter.lat,
  lon: island.sourceCenter.lon,
  reachDeg: Math.max(island.bounds.maxLat, -island.bounds.minLat, island.bounds.maxLon, -island.bounds.minLon) + REACH_MARGIN_DEG
})));

export function islandById(id) {
  return ISLANDS.find((island) => island.id === id) ?? null;
}

export { ISLAND_CATALOG };

// Reads the world a Scrambled Seas save describes, and places the game's islands where it moved them.
import { ISLAND_CATALOG, VANILLA_ISLANDS, islandById } from "./islands.mjs";

// Scrambled Seas stores each island's move in metres from where the game places it, 9000 to a degree:
// x east and z north. The offsets are listed by the game's island number, starting from island 1.
const METRES_PER_DEGREE = 9000;

// The game's island numbers, from its "island N" scene objects. 14 (Nightcall) and 24 are not on the
// chart, and 43 is Bottleneck Isle, which Better Ports adds.
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
  42: "alankh/saffron", 43: "better-ports/bottleneck"
});

// The other Fire Fish Lagoon islets are not islands of their own in the game. Each moves with the
// nearest lagoon island, which is an assumption until checked against a scrambled game.
const LAGOON_NUMBERS = [26, 27, 28, 29, 31];
const ISLAND_NUMBERS = new Map(Object.entries(GAME_ISLANDS).map(([number, id]) => [id, Number(number)]));
for (const island of ISLAND_CATALOG) {
  if (island.partOf !== "firefish/fire_fish_islands" || ISLAND_NUMBERS.has(island.id)) continue;
  const distance = (number) => {
    const centre = islandById(GAME_ISLANDS[number]).sourceCenter;
    return Math.hypot(centre.lat - island.sourceCenter.lat, centre.lon - island.sourceCenter.lon);
  };
  ISLAND_NUMBERS.set(island.id, LAGOON_NUMBERS.reduce((best, number) => distance(number) < distance(best) ? number : best));
}

const MAP_ISLANDS = Object.freeze([...VANILLA_ISLANDS, islandById("better-ports/bottleneck")].filter(Boolean));

// Reads the XML file Scrambled Seas writes: its world preset, or the scramble_<slot>.xml it saves
// beside itself when its ExternalSave setting is on. Only that second kind says where the islands went.
export function parseScrambledSeasXml(text) {
  const source = String(text ?? "");
  if (!/<ScrambledSeasSaveContainer[\s>]/.test(source)) throw new Error("This XML file is not a Scrambled Seas world.");
  const number = (name) => Number(source.match(new RegExp(`<${name}>\\s*(-?[\\d.]+)\\s*</${name}>`))?.[1]);
  const list = source.match(/<islandOffsets>([\s\S]*?)<\/islandOffsets>/)?.[1] ?? "";
  const offsets = [...list.matchAll(/<Vector3>([\s\S]*?)<\/Vector3>/g)].map(([, vector]) => ({
    x: Number(vector.match(/<x>\s*(-?[\d.eE+-]+)\s*<\/x>/)?.[1]) || 0,
    z: Number(vector.match(/<z>\s*(-?[\d.eE+-]+)\s*<\/z>/)?.[1]) || 0
  }));
  return { seed: number("worldScramblerSeed"), borderExpander: number("borderExpander") === 1, offsets };
}

// Where each island on the game map sits in this world, by island id.
export function scrambledIslands({ offsets }) {
  if (!offsets?.length) {
    throw new Error("This Scrambled Seas file has no island positions yet. Start a game with it, then import the scramble file Scrambled Seas saves in its plugin folder when its ExternalSave setting is on.");
  }
  const positions = {};
  for (const island of MAP_ISLANDS) {
    const offset = offsets[ISLAND_NUMBERS.get(island.id) - 1];
    if (!offset) continue;
    positions[island.id] = {
      lat: round(island.sourceCenter.lat + offset.z / METRES_PER_DEGREE),
      lon: round(island.sourceCenter.lon + offset.x / METRES_PER_DEGREE)
    };
  }
  return positions;
}

// The islands the game map layer draws for a chart, and where: as the game places them, or where the
// chart's Scrambled Seas world moved them.
export function gameMapIslands(chart) {
  const moved = chart.scramble?.islands;
  if (!moved) return VANILLA_ISLANDS.map((island) => ({ island, centre: island.sourceCenter }));
  return MAP_ISLANDS.filter((island) => moved[island.id]).map((island) => ({ island, centre: moved[island.id] }));
}

function round(value) {
  return Math.round(value * 100000) / 100000;
}

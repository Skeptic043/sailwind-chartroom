// Reads the world a Scrambled Seas save describes, and places the game's islands where it moved them.
import { ISLAND_CATALOG, VANILLA_ISLANDS, islandById, islandShoreDistance } from "./islands.mjs";

// Scrambled Seas stores each island's move in metres from where the game places it, 9000 to a degree:
// x east and z north. The offsets are listed by the game's island number, starting from island 1.
const METRES_PER_DEGREE = 9000;

// The game's island numbers, from its "island N" scene objects. 14 (Nightcall) and 24 are not on the
// chart, and 67 is Bottleneck Isle, which Better Ports adds ("island 67 Bottleneck(Clone)").
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

// The chart's island for a game island number, or "" for one it doesn't show.
export function islandIdForNumber(number) {
  return GAME_ISLANDS[number] ?? "";
}

const ISLAND_NUMBERS = new Map(Object.entries(GAME_ISLANDS).map(([number, id]) => [id, Number(number)]));

// The other Fire Fish Lagoon islets are parts of the numbered lagoon islands: each "island N" root carries a
// landmass mesh that includes them, so each islet moves with its island. Matched against the game's colliders.
const LAGOON_PIECES = Object.freeze({
  "firefish/fire_fish_islands/west_islet": 28,
  "firefish/fire_fish_islands/south_spike_east": 27, "firefish/fire_fish_islands/south_spike_west": 27,
  "firefish/fire_fish_islands/south_island": 26, "firefish/fire_fish_islands/southeast_island": 26,
  "firefish/fire_fish_islands/central_island": 26, "firefish/fire_fish_islands/east_island": 26,
  "firefish/fire_fish_islands/east_islet": 26
});
for (const [id, number] of Object.entries(LAGOON_PIECES)) ISLAND_NUMBERS.set(id, number);
// Shallow sandbars belong to a root the game numbers -1, which Scrambled Seas moves with the whole Lagoon region.
export const LAGOON_ROOT = "island 26 lagoon parent terrain (-1)";
// A sandbar landing outside every islet's outline still belongs to an islet within 0.03 degrees of its shore.
const NEAR_SANDBAR_DEGREES = 0.03;

// Where the game places the roots of the lagoon islands with islets, as world metres, latitude 36 at world zero.
// Used for a sandbar landfall, which has no island root of its own.
const LAGOON_ROOTS = Object.freeze({ 26: [28416, -70722], 27: [26044.6015625, -71137.3984375], 28: [24718.6015625, -69919.3984375] });

// The islet whose outline is nearest the player, within near degrees of its shore.
function pieceAt(pieces, player, near) {
  let best;
  let bestDistance = near;
  for (const piece of pieces) {
    const distance = islandShoreDistance(piece, piece.sourceCenter, player);
    if (distance < bestDistance || (!best && distance <= near)) [best, bestDistance] = [piece, distance];
  }
  return best;
}

// Fire Fish Town, Kicia Bay and Sen'na always keep their islets in the same places around them, so reaching any
// part of one charts all of it: the island at its root, and each islet as a "piece" landfall where the island's
// offset puts it. Given a native landfall or a port visit's root on one of them, or in the game's own world a
// sandbar landfall near one of their islets. Null for anything else, and where the offset isn't known: a
// scrambled world's sandbars stay where the region moved them, away from the islands.
export function lagoonGroup(record, vanilla) {
  let number;
  let root;
  let offset = { offsetLat: 0, offsetLon: 0 };
  if (record.source === "native") {
    number = Number(record.islandId);
    if (!LAGOON_ROOTS[number] || !Number.isFinite(record.islandLat) || !Number.isFinite(record.islandLon)) return null;
    if (Number.isFinite(record.offsetLat) && Number.isFinite(record.offsetLon)) offset = { offsetLat: record.offsetLat, offsetLon: record.offsetLon };
    else if (!vanilla) return null;
    root = { islandLat: record.islandLat, islandLon: record.islandLon };
  } else if (record.source === "unnumbered" && record.islandId === LAGOON_ROOT && vanilla && Number.isFinite(record.lat) && Number.isFinite(record.lon)) {
    const islet = pieceAt(ISLAND_CATALOG.filter((island) => LAGOON_PIECES[island.id]), record, NEAR_SANDBAR_DEGREES);
    if (!islet) return null;
    number = LAGOON_PIECES[islet.id];
    const [x, z] = LAGOON_ROOTS[number];
    root = { islandLat: 36 + z / METRES_PER_DEGREE, islandLon: x / METRES_PER_DEGREE };
  } else {
    return null;
  }
  const islets = ISLAND_CATALOG.filter((island) => LAGOON_PIECES[island.id] === number).map((islet) => ({
    source: "piece", islandId: islet.id, islandLat: islet.sourceCenter.lat + offset.offsetLat, islandLon: islet.sourceCenter.lon + offset.offsetLon, ...offset
  }));
  return [{ source: "native", islandId: String(number), ...root, ...offset }, ...islets];
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

// The islands of the game's own map, where the game places them.
export const VANILLA_MAP = Object.freeze(VANILLA_ISLANDS.map((island) => ({ island, centre: island.sourceCenter })));

// The islands of the chart's imported Scrambled Seas world, where it put them. They are also chart items.
export function importedMapIslands(chart) {
  return (chart.scramble?.islands ?? []).map((item) => ({ island: islandById(item.id), centre: item, item })).filter(({ island }) => island);
}

function round(value) {
  return Math.round(value * 100000) / 100000;
}

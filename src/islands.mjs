import { ISLAND_CATALOG as SOURCE_ISLANDS } from "./island-catalog.generated.mjs";
import { MOD_ISLANDS } from "./mod-islands.mjs";

// Rock of Despair is marked secret in the source map, but it is not a secret island.
const NOT_SECRET = new Set(["aestrin/rock_of_despair"]);
const GAME_ISLANDS = SOURCE_ISLANDS.map((island) => NOT_SECRET.has(island.id) ? { ...island, secret: false } : island);

// The island library's groups, in menu order. Islands set apart from the archipelagos are listed
// together as small islands, as New Beginnings lists them.
export const ISLAND_GROUPS = Object.freeze(["Aestrin", "Al’Ankh", "Emerald Archipelago", "Fire Fish Lagoon", "Small Islands", "Mod Islands"]);
const SMALL_ISLANDS = new Set(["aestrin/rock_of_despair", "alankh/eleann_island", "alankh/mirage_mountain",
  "alankh/oasis", "alankh/saffron", "bay/happy_bay", "chronos/chronos"]);

// The islands with one of the game's ports. A mod island says so itself.
const PORT_ISLANDS = new Set([
  "aestrin/aestra_abbey", "aestrin/eastwind", "aestrin/fey_valley", "aestrin/firefly_grotto", "aestrin/fort_aestrin",
  "aestrin/mount_malefic", "aestrin/siren_song", "aestrin/sunspire",
  "alankh/albacore_town", "alankh/alchemists_island", "alankh/alankh_academy", "alankh/alnilem", "alankh/gold_rock_city",
  "alankh/mirage_mountain", "alankh/neverdin", "alankh/oasis", "alankh/old_ankh_town", "alankh/saffron",
  "emerald/crab_beach", "emerald/dead_cove", "emerald/dragon_cliffs", "emerald/new_port", "emerald/sage_hills",
  "emerald/sanctuary", "emerald/serpent_isle", "emerald/turtle_island",
  "firefish/fire_fish_town", "firefish/kicia_bay", "firefish/onna", "firefish/senna",
  "bay/happy_bay", "chronos/chronos"
]);

export function islandGroup(island) {
  return island.provider ? "Mod Islands" : SMALL_ISLANDS.has(island.id) ? "Small Islands" : island.region;
}

export function islandHasPort(island) {
  return island.port ?? PORT_ISLANDS.has(island.id);
}

// By group, then ports before islands and rocks without one, then alphabetically.
// An island's pieces follow it in their listed order.
const GAME_BY_ID = new Map(GAME_ISLANDS.map((island) => [island.id, island]));
const libraryParent = (island) => GAME_BY_ID.get(island.partOf) ?? island;
const groupOrder = (island) => ISLAND_GROUPS.indexOf(islandGroup(island));
const portOrder = (island) => islandHasPort(libraryParent(island)) ? 0 : 1;
export const ISLAND_CATALOG = Object.freeze([...GAME_ISLANDS, ...MOD_ISLANDS]
  .map((island, index) => ({ island, index }))
  .sort((a, b) => groupOrder(a.island) - groupOrder(b.island) || portOrder(a.island) - portOrder(b.island)
    || libraryParent(a.island).name.localeCompare(libraryParent(b.island).name) || a.index - b.index)
  .map(({ island }) => island));

const ISLANDS_BY_ID = new Map(ISLAND_CATALOG.map((island) => [island.id, island]));
const ISLANDS_BY_NAME = new Map(ISLAND_CATALOG.map((island) => [normalizeIslandName(island.name), island]));

// The islands as the game places them. An island offered both whole and as pieces is drawn from its pieces.
const SPLIT_ISLANDS = new Set(GAME_ISLANDS.map((island) => island.partOf).filter(Boolean));
export const VANILLA_ISLANDS = Object.freeze(GAME_ISLANDS.filter((island) => !SPLIT_ISLANDS.has(island.id)));

export function normalizeIslandName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function islandById(id) {
  return ISLANDS_BY_ID.get(String(id ?? "")) ?? null;
}

export function islandByName(name) {
  return ISLANDS_BY_NAME.get(normalizeIslandName(name)) ?? null;
}

export function assignedIsland(feature) {
  return islandById(feature?.islandId) ?? islandByName(feature?.name);
}

export function visibleIsland(feature) {
  return feature?.showIsland === false ? null : assignedIsland(feature);
}

// A search area shows the island it is looking for: the one chosen for it, or the one it is named after.
export function searchIsland(search) {
  return search ? visibleIsland({ islandId: search.islandId, showIsland: search.showIsland, name: search.label }) : null;
}

export function islandWorldBounds(island, feature) {
  return {
    minLat: Number(feature.lat) + island.bounds.minLat,
    maxLat: Number(feature.lat) + island.bounds.maxLat,
    minLon: Number(feature.lon) + island.bounds.minLon,
    maxLon: Number(feature.lon) + island.bounds.maxLon
  };
}

export function islandContains(island, feature, point) {
  const x = Number(point.lon) - Number(feature.lon);
  const y = Number(point.lat) - Number(feature.lat);
  let inside = false;
  for (const shape of island.shapes) {
    let shapeInside = false;
    for (const ring of shape.rings) {
      if (pointInRing(ring, x, y)) shapeInside = !shapeInside;
    }
    if (shapeInside) inside = true;
  }
  return inside;
}

function pointInRing(ring, x, y) {
  let inside = false;
  for (let current = 0, previous = ring.length - 2; current < ring.length; previous = current, current += 2) {
    const x1 = ring[current];
    const y1 = ring[current + 1];
    const x2 = ring[previous];
    const y2 = ring[previous + 1];
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

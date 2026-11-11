import { ISLAND_CATALOG } from "./island-catalog.generated.mjs";

const ISLANDS_BY_ID = new Map(ISLAND_CATALOG.map((island) => [island.id, island]));
const ISLANDS_BY_NAME = new Map(ISLAND_CATALOG.map((island) => [normalizeIslandName(island.name), island]));

// The islands as the game places them. An island offered both whole and as pieces is drawn from its pieces.
const SPLIT_ISLANDS = new Set(ISLAND_CATALOG.map((island) => island.partOf).filter(Boolean));
export const VANILLA_ISLANDS = Object.freeze(ISLAND_CATALOG.filter((island) => !SPLIT_ISLANDS.has(island.id)));

export { ISLAND_CATALOG };

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

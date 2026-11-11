import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/generate-island-catalog.mjs <empty-sea-map.html> <output.mjs>");
}

const html = readFileSync(resolve(inputPath), "utf8");
const catalogLine = html.split(/\r?\n/).find((line) => line.startsWith("const CAT=["));
if (!catalogLine) throw new Error("The source HTML does not contain its island catalog.");
const source = JSON.parse(catalogLine.slice("const CAT=".length, -1));

const LAND = 0;
const round = (value) => Math.round(value * 1e5) / 1e5;

function ringBounds(rings) {
  const bounds = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity };
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 2) {
      bounds.minLon = Math.min(bounds.minLon, ring[index]);
      bounds.maxLon = Math.max(bounds.maxLon, ring[index]);
      bounds.minLat = Math.min(bounds.minLat, ring[index + 1]);
      bounds.maxLat = Math.max(bounds.maxLat, ring[index + 1]);
    }
  }
  return bounds;
}

function entry(id, name, region, secret, sourceCenter, shapes, extra = {}) {
  const bounds = ringBounds(shapes.flatMap((shape) => shape.rings));
  return { id, name, region, secret, sourceCenter, ...extra, bounds, shapes };
}

// Builds an entry around its own centre from rings given in world coordinates.
function entryFromWorldRings(id, name, region, ringsByKind, extra) {
  const world = ringBounds([...ringsByKind.values()].flat());
  const centre = { lon: round((world.minLon + world.maxLon) / 2), lat: round((world.minLat + world.maxLat) / 2) };
  const shapes = [...ringsByKind].sort(([a], [b]) => a - b).map(([kind, rings]) => ({
    kind,
    rings: rings.map((ring) => ring.map((value, index) => round(value - (index % 2 ? centre.lat : centre.lon))))
  }));
  return entry(id, name, region, false, centre, shapes, extra);
}

function ringDistance(a, b) {
  let nearest = Infinity;
  for (let i = 0; i < a.length; i += 2) {
    for (let j = 0; j < b.length; j += 2) nearest = Math.min(nearest, Math.hypot(a[i] - b[j], a[i + 1] - b[j + 1]));
  }
  return nearest;
}

const catalog = source.map((item) => entry(
  item.id,
  item.n,
  // Chronos belongs with the Aestrin library group in Chartroom.
  item.r === "Chronos" ? "Aestrin" : item.r,
  Boolean(item.s),
  { lon: item.c[0], lat: item.c[1] },
  item.p.map(([kind, rings]) => ({ kind, rings }))
));

// The source keeps Fire Fish Lagoon's towns and rocks in files shared by the whole lagoon, and the
// page attaches each file to one island: every rock and On'na's town to Sen'na, Kicia Bay's town to
// Fire Fish Town. Each town and rock goes back to the land it stands nearest, and the unnamed
// islands become pieces that can be placed one at a time. "Fire Fish Islands" stays as it was.
const LAGOON = "Fire Fish Lagoon";
const LAGOON_ISLANDS = "firefish/fire_fish_islands";
const PIECES = [
  ["west_islet", "Lagoon West Islet"],
  ["north_sandbar", "Lagoon North Sandbar"],
  ["south_spike_east", "Lagoon South Spike East"],
  ["south_spike_west", "Lagoon South Spike West"],
  ["south_island", "Lagoon South Island"],
  ["southeast_island", "Lagoon Southeast Island"],
  ["central_island", "Lagoon Central Island"],
  ["east_island", "Lagoon East Island"],
  ["east_islet", "Lagoon East Islet"]
];

const owners = [];
const loose = [];
for (const island of catalog.filter((item) => item.region === LAGOON)) {
  for (const shape of island.shapes) {
    for (const [index, relative] of shape.rings.entries()) {
      const ring = relative.map((value, at) => value + (at % 2 ? island.sourceCenter.lat : island.sourceCenter.lon));
      if (shape.kind !== LAND) loose.push({ kind: shape.kind, ring });
      else if (island.id === LAGOON_ISLANDS) owners.push({ id: `${island.id}/${PIECES[index][0]}`, name: PIECES[index][1], partOf: island.id, land: ring, rings: new Map([[LAND, [ring]]]) });
      else owners.push({ id: island.id, name: island.name, previous: island.sourceCenter, land: ring, rings: new Map([[LAND, [ring]]]) });
    }
  }
}
if (owners.filter((owner) => owner.partOf).length !== PIECES.length) throw new Error("Fire Fish Islands no longer has the expected islands.");
for (const { kind, ring } of loose) {
  const owner = owners.reduce((best, candidate) => ringDistance(ring, candidate.land) < ringDistance(ring, best.land) ? candidate : best);
  owner.rings.set(kind, [...(owner.rings.get(kind) ?? []), ring]);
}

const regrouped = new Map(owners.map((owner) => {
  if (owner.partOf) return [owner.id, entryFromWorldRings(owner.id, owner.name, LAGOON, owner.rings, { partOf: owner.partOf })];
  const rebuilt = entryFromWorldRings(owner.id, owner.name, LAGOON, owner.rings);
  // How far the centre moved from the source map's, for placements saved by that map.
  const sourceMapOffset = { lon: round(rebuilt.sourceCenter.lon - owner.previous.lon), lat: round(rebuilt.sourceCenter.lat - owner.previous.lat) };
  return [owner.id, { ...rebuilt, sourceMapOffset }];
}));
const output = catalog.flatMap((island) => island.id === LAGOON_ISLANDS
  ? [island, ...[...regrouped.values()].filter((piece) => piece.partOf === island.id)]
  : [regrouped.get(island.id) ?? island]);

const header = `// Generated island-outline data. Do not edit by hand.
// Geometry derived from MoffKalast/Sailwind-Map commit 800be273a813d19d93d70c68fa5172310c1603a7.
// See THIRD-PARTY-NOTICES.md for the MIT notice and source details.
`;
writeFileSync(resolve(outputPath), `${header}\nexport const ISLAND_CATALOG = Object.freeze(${JSON.stringify(output)});\n`, "utf8");
console.log(`Wrote ${output.length} islands to ${resolve(outputPath)}`);

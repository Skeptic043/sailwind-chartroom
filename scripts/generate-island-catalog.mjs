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

const catalog = source.map((entry) => {
  const shapes = entry.p.map(([kind, rings]) => ({ kind, rings }));
  const points = shapes.flatMap((shape) => shape.rings.flatMap((ring) => {
    const pairs = [];
    for (let index = 0; index < ring.length; index += 2) pairs.push([ring[index], ring[index + 1]]);
    return pairs;
  }));
  const longitudes = points.map(([lon]) => lon);
  const latitudes = points.map(([, lat]) => lat);
  return {
    id: entry.id,
    name: entry.n,
    // Chronos belongs with the Aestrin library group in Chartroom.
    region: entry.r === "Chronos" ? "Aestrin" : entry.r,
    secret: Boolean(entry.s),
    sourceCenter: { lon: entry.c[0], lat: entry.c[1] },
    bounds: {
      minLon: Math.min(...longitudes),
      maxLon: Math.max(...longitudes),
      minLat: Math.min(...latitudes),
      maxLat: Math.max(...latitudes)
    },
    shapes
  };
});

const header = `// Generated island-outline data. Do not edit by hand.
// Geometry derived from MoffKalast/Sailwind-Map commit 800be273a813d19d93d70c68fa5172310c1603a7.
// See THIRD-PARTY-NOTICES.md for the MIT notice and source details.
`;
writeFileSync(resolve(outputPath), `${header}\nexport const ISLAND_CATALOG = Object.freeze(${JSON.stringify(catalog)});\n`, "utf8");
console.log(`Wrote ${catalog.length} islands to ${resolve(outputPath)}`);

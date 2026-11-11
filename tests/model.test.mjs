import test from "node:test";
import assert from "node:assert/strict";
import {
  bearingDegrees,
  archiveActiveRoute,
  chartItemFocusPoint,
  clusteredLabelIds,
  compassPoint,
  createChart,
  createMeasure,
  createRoutePoint,
  commonSearchOverlap,
  createSearch,
  createWind,
  exportFile,
  destinationPoint,
  insideSearch,
  searchExtent,
  distanceNm,
  formatDuration,
  featuresToCsv,
  followAnchors,
  importChartData,
  importLegacyMap,
  itemForRef,
  removeChartItems,
  searchesAnsweredBy,
  validateShortcuts,
  defaultShortcuts,
  savedRouteForPoint,
  locationRangeForType,
  parseBearing,
  parseCoordinate,
  parseCoordinateViewer,
  sanitizeWorkspace,
  searchAreasOverlap,
  searchEvidenceOpacity,
  searchChartLabel,
  searchIconAnchors,
  searchNameLabelIds,
  searchOverlapGroups,
  summarizeRoute,
  tradeWindAt,
  translateChartItems
} from "../src/model.mjs";
import { ISLAND_CATALOG, ISLAND_GROUPS, VANILLA_ISLANDS, assignedIsland, islandGroup, islandById, islandByName, normalizeIslandName, searchIsland, visibleIsland } from "../src/islands.mjs";
import { BOAT_CATALOG, assignedBoat, boatById, boatMarkerSize, visibleBoat } from "../src/boats.mjs";

test("parses decimal and degree-minute-second coordinates", () => {
  assert.equal(parseCoordinate("35.5 N", "lat"), 35.5);
  assert.equal(parseCoordinate("3° 30' W", "lon"), -3.5);
  assert.equal(parseCoordinate("-12,25", "lat"), -12.25);
  assert.throws(() => parseCoordinate("91 N", "lat"), /between/);
  assert.throws(() => parseCoordinate("12 E", "lat"), /not valid/);
});

test("uses Sailwind flat-chart distance and north-clockwise bearing", () => {
  const a = { lat: 0, lon: 0 };
  assert.equal(distanceNm(a, { lat: 1, lon: 0 }), 140);
  assert.equal(bearingDegrees(a, { lat: 1, lon: 0 }), 0);
  assert.equal(bearingDegrees(a, { lat: 0, lon: 1 }), 90);
  assert.equal(compassPoint(225), "SW");
  assert.equal(compassPoint(11.25), "NbE", "the compass names all 32 points");
  assert.equal(compassPoint(354), "NbW");
  assert.equal(parseBearing("swbs"), 213.75);
});

test("summarizes route legs and total distance", () => {
  const summary = summarizeRoute([
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 }
  ]);
  assert.equal(summary.legs.length, 2);
  assert.equal(summary.totalNm, 280);
  assert.deepEqual(summary.legs.map((leg) => leg.compass), ["E", "N"]);
});

test("parses Coordinate Viewer day, time and wind records", () => {
  const points = parseCoordinateViewer("Day: 12\n35.25 -3.5 6.5 90\n35,5 -3,0");
  assert.equal(points.length, 2);
  assert.equal(points[0].day, "12");
  assert.equal(points[0].time, "06:30");
  assert.equal(points[0].wind, "E");
  assert.equal(points[1].lat, 35.5);
});

test("imports the useful parts of legacy Sailwind Map exports", () => {
  const chart = importLegacyMap({
    points: [{ pos: [2, 3], description: "Rock" }],
    goals: [{ pos: [4, 5], description: "Harbor" }],
    path: [{ pos: [0, 0] }, { pos: [1, 1] }],
    lines: [{ p0: [0, 0], p1: [2, 2], colour: "redline" }]
  });
  assert.equal(chart.features.length, 2);
  assert.equal(chart.route.length, 2);
  assert.equal(chart.segments.length, 1);
  assert.equal(chart.features[1].name, "Harbor");
});

test("assigns fresh identities when importing an exported workspace", () => {
  const chart = createChart({ name: "Seed 7" });
  const imported = importChartData({ activeChartId: chart.id, charts: [chart] });
  assert.equal(imported.length, 1);
  assert.notEqual(imported[0].id, chart.id);
  assert.match(imported[0].name, /imported/);
});

test("sanitizes malformed workspace data into a usable chart", () => {
  const chart = createChart({ name: "Seed 42" });
  const workspace = sanitizeWorkspace({
    activeChartId: "missing",
    layout: { leftWidth: 20, rightWidth: 900, leftOpen: false },
    charts: [{ ...chart, winds: [{ id: "wind", lat: 2, lon: 3, bearing: 450, label: "North sea" }], features: [{ lat: 200, lon: 0 }] }]
  });
  assert.equal(workspace.charts.length, 1);
  assert.equal(workspace.activeChartId, chart.id);
  assert.deepEqual(workspace.charts[0].features, []);
  assert.deepEqual(workspace.charts[0].winds, [{ id: "wind", lat: 2, lon: 3, bearing: 90, label: "North sea" }]);
  assert.deepEqual(workspace.layout, { leftWidth: 190, rightWidth: 480, leftOpen: false, rightOpen: true });
});

test("quotes CSV fields safely", () => {
  const csv = featuresToCsv([{ name: "Rock, north", lat: 1, lon: 2, day: "", time: "", boatId: "vanilla/dhow", boatCorner: "ne", showBoat: false, notes: "He said \"shoal\"" }]);
  assert.match(csv, /"Rock, north"/);
  assert.match(csv, /"He said ""shoal"""/);
  assert.match(csv, /show_island,boat_id,notes/);
  assert.doesNotMatch(csv, /boat_corner|show_boat/);
});

test("changes location type by adding or removing an area radius", () => {
  assert.equal(locationRangeForType("location", 42), 0);
  assert.equal(locationRangeForType("area", 42), 42);
  assert.equal(locationRangeForType("area", ""), 10);
});

test("plots a position from course and distance on the flat chart", () => {
  const east = destinationPoint({ lat: 10, lon: 5 }, 90, 140);
  assert.ok(Math.abs(east.lat - 10) < 1e-9);
  assert.ok(Math.abs(east.lon - 6) < 1e-9);
  const back = destinationPoint({ lat: 0, lon: 0 }, 225, distanceNm({ lat: 0, lon: 0 }, { lat: -1, lon: -1 }));
  assert.ok(Math.abs(back.lat + 1) < 1e-9 && Math.abs(back.lon + 1) < 1e-9);
});

test("a chart keeps one measure line that moves and deletes as a whole", () => {
  const chart = createChart();
  const older = createMeasure({ lat: 0, lon: 0 }, { lat: 1, lon: 1 });
  const line = createMeasure({ lat: 2, lon: 3 }, { lat: 4, lon: 7 });
  chart.measures = [older, line, { id: "broken", lat: 1, lon: 1 }];
  const [restored] = sanitizeWorkspace({ activeChartId: chart.id, charts: [chart] }).charts;
  assert.deepEqual(restored.measures, [line]);
  assert.deepEqual(chartItemFocusPoint("measure", line), { lat: 3, lon: 5 });
  translateChartItems(restored, [{ kind: "measure", id: line.id }], { lat: 1, lon: -1 }, { strict: true });
  assert.deepEqual([restored.measures[0].lat, restored.measures[0].lon, restored.measures[0].end], [3, 2, { lat: 5, lon: 6 }]);
  assert.throws(() => translateChartItems(restored, [{ kind: "measure", id: line.id }], { lat: 86, lon: 0 }, { strict: true }), /outside/, "the far end counts too");
  removeChartItems(restored, [{ kind: "measure", id: line.id }]);
  assert.deepEqual(restored.measures, []);
});

test("a search area covers its compass point and distance margin", () => {
  const search = createSearch({ lat: 0, lon: 0, bearing: parseBearing("SSE"), distanceNm: 140, boatId: "vanilla/dhow", boatCorner: "ne", showBoat: false });
  const extent = searchExtent(search);
  assert.equal(extent.nearNm, 126);
  assert.ok(Math.abs(extent.farNm - 154) < 1e-9);
  assert.ok(insideSearch(search, extent.centre));
  assert.ok(insideSearch(search, destinationPoint(search, 157.5 + 11, 150)), "edge of the compass point");
  assert.ok(!insideSearch(search, destinationPoint(search, 157.5 + 12, 140)), "next compass point over");
  assert.ok(!insideSearch(search, destinationPoint(search, 157.5, 120)), "too close");
  const [restored] = sanitizeWorkspace({ charts: [{ ...createChart(), searches: [search, { ...search, distanceNm: 0 }] }] }).charts[0].searches;
  assert.deepEqual(restored, search, "saved searches survive reload; zero-distance ones are dropped");
  assert.equal(assignedBoat(restored).name, "Dhow");
  assert.equal(restored.boatCorner, "se");
  assert.equal(restored.showBoat, true);
});

test("removes stacked fill outside the common solution for matching search areas", () => {
  const first = createSearch({ lat: 0, lon: 0, bearing: 90, distanceNm: 140 });
  const overlapping = createSearch({ lat: 0.1, lon: 0, bearing: 90, distanceNm: 140 });
  const disjoint = createSearch({ lat: 10, lon: 10, bearing: 90, distanceNm: 140 });
  assert.equal(searchAreasOverlap(first, overlapping), true);
  assert.equal(searchAreasOverlap(first, disjoint), false);
  assert.equal(searchEvidenceOpacity(false), 0.12);
  assert.equal(searchEvidenceOpacity(true), 0, "matching searches keep their lines but do not stack fill outside the common solution");
});

test("focuses search-area list entries on the searched destination rather than their origin", () => {
  const search = createSearch({ lat: 10, lon: 5, bearing: 90, distanceNm: 140 });
  assert.deepEqual(chartItemFocusPoint("search", search), searchExtent(search).centre);
  const location = { lat: 3, lon: 4 };
  assert.equal(chartItemFocusPoint("feature", location), location);
});

test("hides a label only where it would cover another and prefers key landmarks", () => {
  const visible = clusteredLabelIds([
    { id: "west", name: "West", x: 0, y: 0, width: 40 },
    { id: "gold", name: "Gold Rock", x: 30, y: 0, width: 60 },
    { id: "east", name: "East", x: 60, y: 0, width: 40 },
    { id: "far", name: "Far", x: 250, y: 0, width: 30 }
  ]);
  assert.deepEqual([...visible].sort(), ["far", "gold"]);
  const selected = clusteredLabelIds([
    { id: "gold", name: "Gold Rock", x: 0, y: 0, width: 60 },
    { id: "selected", name: "Selected", x: 10, y: 0, width: 55, selected: true }
  ]);
  assert.deepEqual([...selected], ["selected"]);
  const stacked = clusteredLabelIds([
    { id: "senna", name: "Sen’na", x: 0, y: 0, width: 40 },
    { id: "onna", name: "On’na", x: 5, y: 36, width: 36 }
  ]);
  assert.equal(stacked.size, 2, "neighbouring settlements both keep their names when the text has room");
  const semanticPriority = [
    { id: "route", name: "Route day 2", x: 0, y: 0, width: 70, priority: 30 },
    { id: "location", name: "Old Ank Town", x: 10, y: 0, width: 80, priority: 0 }
  ];
  assert.deepEqual([...clusteredLabelIds(semanticPriority)], ["location"]);
});

test("Fire Fish Lagoon islands carry only their own town and rocks", () => {
  const lagoon = ISLAND_CATALOG.filter((island) => island.region === "Fire Fish Lagoon");
  for (const island of lagoon.filter((item) => item.id !== "firefish/fire_fish_islands")) {
    const span = Math.max(island.bounds.maxLon - island.bounds.minLon, island.bounds.maxLat - island.bounds.minLat);
    assert.ok(span < 0.25, `${island.name} stays near its own land`);
    assert.ok(Math.abs(island.bounds.minLon + island.bounds.maxLon) < 1e-4, `${island.name} is drawn around its centre`);
  }
  assert.equal(lagoon.filter((island) => island.partOf === "firefish/fire_fish_islands").length, 9);
  assert.ok(islandById("firefish/fire_fish_islands"), "charts that placed the whole lagoon keep their outline");
  assert.equal(VANILLA_ISLANDS.length, ISLAND_CATALOG.filter((island) => !island.provider).length - 1, "the vanilla map draws the lagoon from its pieces, once");
  // The source map saved Sen'na by the centre of every lagoon rock; the import moves it onto the island.
  const senna = importLegacyMap({ islands: { "firefish/senna": { x: 2.9504, y: 28.1807 } } }).features[0];
  assert.ok(Math.abs(senna.lon - 2.78) < 0.01 && Math.abs(senna.lat - 28.19) < 0.01);
});

test("vanilla map layers start off and trade winds follow the game's zones", () => {
  const layers = createChart().layers;
  assert.deepEqual([layers.vanillaMap, layers.secretIslands, layers.tradeWinds], [false, false, false]);
  assert.deepEqual([layers.measure, layers.islands], [true, true]);
  const chart = createChart();
  chart.layers = { grid: true, vanillaMap: true, tradeWinds: true, measure: false, islands: false };
  const restored = sanitizeWorkspace({ activeChartId: chart.id, charts: [chart] }).charts[0].layers;
  assert.deepEqual([restored.vanillaMap, restored.secretIslands, restored.tradeWinds], [true, false, true]);
  assert.deepEqual([restored.measure, restored.islands], [false, false]);
  assert.deepEqual(tradeWindAt(40, 0), { zone: "aestrin", east: 1, north: 0.5 });
  assert.deepEqual(tradeWindAt(31, -10), { zone: "alankh", east: 0.75, north: 0.75 });
  assert.deepEqual(tradeWindAt(31, 5), { zone: "emerald", east: -1, north: -0.5 });
  assert.equal(tradeWindAt(32.5, 5), null);
  assert.equal(tradeWindAt(28, 3), null);
});

test("shows a repeated search name once per connected overlap", () => {
  const first = createSearch({ lat: 0, lon: 0, bearing: 90, distanceNm: 140, label: "Happy Bay" });
  const second = createSearch({ lat: 0.05, lon: 0, bearing: 90, distanceNm: 140, label: "happy bay" });
  const separate = createSearch({ lat: 20, lon: 20, bearing: 90, distanceNm: 140, label: "Happy Bay" });
  const other = createSearch({ lat: 0, lon: 0, bearing: 90, distanceNm: 140, label: "Gold Rock" });
  const visible = searchNameLabelIds([first, second, separate, other]);
  assert.equal([first, second].filter((search) => visible.has(search.id)).length, 1);
  assert.equal(visible.has(separate.id), true);
  assert.equal(visible.has(other.id), true);
  assert.equal(searchChartLabel(first, true), "Happy Bay");
  assert.equal(searchChartLabel(first, false), "", "duplicate named searches do not fall back to direction text");
});

test("reinforces only the common overlap of same-named search areas", () => {
  const same = [
    createSearch({ lat: 0, lon: 0, bearing: 90, distanceNm: 140, label: "Chronos" }),
    createSearch({ lat: 0.02, lon: 0, bearing: 90, distanceNm: 140, label: "chronos" }),
    createSearch({ lat: -0.02, lon: 0, bearing: 90, distanceNm: 140, label: "Chronos" })
  ];
  const touchingDifferentName = createSearch({ lat: 0, lon: 0, bearing: 90, distanceNm: 140, label: "Siren Song" });
  const groups = searchOverlapGroups([...same, touchingDifferentName]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((search) => search.id), same.map((search) => search.id));
  // The island and name are drawn once, where all three meet, by the search that carries the name.
  const anchors = searchIconAnchors([...same, touchingDifferentName]);
  const carried = same.filter((search) => anchors.get(search.id));
  assert.equal(carried.length, 1);
  assert.ok(same.every((search) => insideSearch(search, anchors.get(carried[0].id))), "the shared icon sits inside every search");
  assert.equal(same.filter((search) => anchors.get(search.id) === null).length, 2);
  assert.equal(anchors.has(touchingDifferentName.id), false, "a search on its own keeps its island at its centre");
  // Two wide arcs meet in a curved band whose plain middle would fall in the hole between them.
  const arcs = [0, 0.01].map((lat) => createSearch({ lat, lon: 0, bearing: 0, distanceNm: 100, spreadDeg: 90, tolerancePct: 10, label: "Arc" }));
  assert.ok(arcs.every((search) => insideSearch(search, commonSearchOverlap(arcs))));
});

test("a search area shows a chosen island, or the one it is named after, and keeps the choice", () => {
  const chart = createChart();
  chart.searches.push({ ...createSearch({ lat: 0, lon: 0, bearing: 90, distanceNm: 50, label: "Dead Cove" }), islandId: "aestrin/aestra_abbey" });
  chart.searches.push({ ...createSearch({ lat: 0, lon: 0, bearing: 90, distanceNm: 50, label: "Dead Cove" }), showIsland: false });
  chart.searches.push(createSearch({ lat: 0, lon: 0, bearing: 90, distanceNm: 50, label: "Dead Cove" }));
  const [chosen, none, named] = sanitizeWorkspace({ activeChartId: chart.id, charts: [chart] }).charts[0].searches;
  assert.equal(searchIsland(chosen).name, "Aestra Abbey");
  assert.equal(searchIsland(none), null);
  assert.equal(searchIsland(named).id, "emerald/dead_cove");
  assert.equal("showIsland" in named, false, "a search without a choice is saved as before");
});

test("a search snapped to a mark follows it and keeps its place when the mark is gone", () => {
  const chart = createChart();
  chart.features.push({ id: "pin", lat: 37, lon: 10.25, name: "Pin" });
  chart.searches.push(createSearch({ lat: 37, lon: 10.25, bearing: 45, distanceNm: 94, anchor: { kind: "feature", id: "pin" } }));
  chart.features[0].lat = 38;
  followAnchors(chart);
  assert.deepEqual([chart.searches[0].lat, chart.searches[0].lon], [38, 10.25]);
  const saved = sanitizeWorkspace({ charts: [JSON.parse(JSON.stringify(chart))] }).charts[0];
  assert.deepEqual(saved.searches[0].anchor, { kind: "feature", id: "pin" });
  chart.features = [];
  followAnchors(chart);
  assert.equal(chart.searches[0].anchor, undefined);
  assert.equal(chart.searches[0].lat, 38);
});

test("reads bearings as degrees or compass points", () => {
  assert.equal(parseBearing("045"), 45);
  assert.equal(parseBearing("270°"), 270);
  assert.equal(parseBearing("ne"), 45);
  assert.equal(parseBearing("360"), 0);
  assert.throws(() => parseBearing("400"), /0–360/);
});

test("wind markers have no distracting default label", () => {
  assert.equal(createWind({ lat: 1, lon: 2, bearing: 90 }).label, "");
  const chart = createChart();
  chart.winds.push({ id: "old-wind", lat: 1, lon: 2, bearing: 90, label: "Trade wind" });
  const restored = sanitizeWorkspace({ activeChartId: chart.id, charts: [chart] }).charts[0].winds[0];
  assert.equal(restored.label, "");
});

test("the island library lists islands by group, small islands and mod islands last", () => {
  const groups = ISLAND_CATALOG.map(islandGroup);
  assert.deepEqual([...new Set(groups)], ISLAND_GROUPS, "each group appears once, in menu order");
  const smallIslands = ISLAND_CATALOG.filter((island) => islandGroup(island) === "Small Islands").map((island) => island.name);
  assert.deepEqual(smallIslands, ["Chronos", "Happy Bay", "Mirage Mountain", "Oasis", "Saffron", "Eleann Island", "Rock of Despair"], "ports first, then islands without one");
  assert.equal(islandGroup(islandByName("Oracle")), "Aestrin");
  assert.equal(islandGroup(islandByName("Bone Isle")), "Aestrin");
  assert.equal(islandGroup(islandByName("Isle of Clear Mind")), "Al’Ankh");
  assert.equal(islandByName("Rock of Despair").secret, false);
  const aestrin = ISLAND_CATALOG.filter((island) => islandGroup(island) === "Aestrin").map((island) => island.name);
  assert.deepEqual(aestrin.slice(-2), ["Bone Isle", "Oracle"], "islands without a port follow the ports");
  const bottleneck = islandByName("Bottleneck Isle");
  assert.equal(islandGroup(bottleneck), "Mod Islands");
  assert.equal(VANILLA_ISLANDS.includes(bottleneck), false, "the vanilla map does not draw mod islands");
  assert.equal(islandById("firefish/fire_fish_islands/west_islet"), ISLAND_CATALOG[ISLAND_CATALOG.indexOf(islandById("firefish/fire_fish_islands")) + 1], "lagoon pieces follow the lagoon");
});

test("the boat library lists stock boats by region, then each mod together, small to large", () => {
  const names = BOAT_CATALOG.map((boat) => boat.name);
  assert.deepEqual(names.slice(0, 8), ["Dhow", "Sanbuq", "Baghlah (Bigbuq)", "Kakam", "Junk", "Jong", "Cog", "Brig"]);
  const providers = BOAT_CATALOG.slice(8).map((boat) => boat.provider);
  assert.deepEqual(providers.filter((provider, index) => provider !== providers[index - 1]), [...new Set(providers)], "a mod's boats stay together");
  const rank = { Small: 0, Medium: 1, Large: 2 };
  for (const provider of new Set(providers)) {
    const sizes = BOAT_CATALOG.filter((boat) => boat.provider === provider).map((boat) => rank[boat.size]);
    assert.deepEqual(sizes, [...sizes].sort(), `${provider} runs small to large`);
  }
});

test("formats passage times", () => {
  assert.equal(formatDuration(0.5), "30m");
  assert.equal(formatDuration(2.25), "2h 15m");
  assert.equal(formatDuration(27), "1d 3h");
  assert.equal(formatDuration(0), "—");
});

test("bundles the licensed island catalog and matches location names exactly", () => {
  assert.equal(ISLAND_CATALOG.length, 50);
  assert.equal(new Set(ISLAND_CATALOG.map((island) => island.id)).size, 50);
  assert.equal(islandByName("Chronos").region, "Aestrin");
  assert.equal(islandByName("  dead COVE ").id, "emerald/dead_cove");
  assert.equal(normalizeIslandName("Al’Nilem"), normalizeIslandName("Al'Nilem"));
  assert.equal(islandByName("Dead Cove harbor"), null, "partial names do not create surprising silhouettes");
  const feature = { name: "Dead Cove", showIsland: true };
  assert.equal(visibleIsland(feature).id, "emerald/dead_cove");
  feature.showIsland = false;
  assert.equal(visibleIsland(feature), null);
  feature.islandId = "aestrin/aestra_abbey";
  assert.equal(assignedIsland(feature).name, "Aestra Abbey", "an explicit choice wins over the name");
});

test("preserves island assignments and visibility through workspace sanitation", () => {
  const chart = createChart();
  chart.features.push({ id: "island", lat: 1, lon: 2, name: "My cove", notes: "", day: "", time: "", rangeNm: 0, islandId: "emerald/dead_cove", showIsland: false });
  const restored = sanitizeWorkspace({ activeChartId: chart.id, charts: [chart] }).charts[0].features[0];
  assert.equal(restored.islandId, "emerald/dead_cove");
  assert.equal(restored.showIsland, false);
});

test("preserves deliberately blank location and rough-area names", () => {
  const chart = createChart();
  chart.features.push({ id: "blank-location", lat: 1, lon: 2, name: "", rangeNm: 0 });
  chart.features.push({ id: "blank-area", lat: 2, lon: 3, name: "", rangeNm: 20 });
  const restored = sanitizeWorkspace({ activeChartId: chart.id, charts: [chart] }).charts[0].features;
  assert.deepEqual(restored.map((feature) => feature.name), ["", ""]);
});

test("bundles distinct stock and mod boat markers without Leopard's companion cutter", () => {
  assert.equal(BOAT_CATALOG.length, 20);
  assert.equal(new Set(BOAT_CATALOG.map((boat) => boat.id)).size, BOAT_CATALOG.length);
  assert.equal(BOAT_CATALOG.filter((boat) => boat.provider === "Vanilla").length, 8);
  assert.equal(boatById("dinghies/cutter").name, "Cutter");
  assert.equal(BOAT_CATALOG.some((boat) => boat.id === "hms-leopard/cutter"), false);
  assert.equal(new Set(BOAT_CATALOG.map((boat) => JSON.stringify(boat.profile))).size, BOAT_CATALOG.length, "each catalog boat has its own profile");
});

test("scales markers by physical length without making the smallest boats illegible", () => {
  const cutter = boatMarkerSize(boatById("dinghies/cutter"));
  const dhow = boatMarkerSize(boatById("vanilla/dhow"));
  const happyBay = boatMarkerSize(boatById("happy-bay/boat"));
  const clipper = boatMarkerSize(boatById("shattered-seas/clipper"));
  const leopard = boatMarkerSize(boatById("hms-leopard/leopard"));
  assert.ok(cutter.width < dhow.width && dhow.width < happyBay.width);
  assert.ok(happyBay.width < clipper.width && clipper.width < leopard.width);
  assert.ok(cutter.width >= 32, "the Cutter remains readable on the chart");
  assert.ok(leopard.width <= 58, "the Leopard does not overwhelm nearby chart marks");
  assert.ok(cutter.height < leopard.height);
});

test("uses recognizable sail and structure features instead of ambiguous open brackets", () => {
  const cog = boatById("vanilla/cog").profile;
  assert.deepEqual(cog.rigs.map((entry) => entry.type), ["square", "staysail"]);
  assert.equal(cog.foredeck, undefined);
  assert.equal(cog.cabin, undefined);
  assert.ok(cog.structures?.length, "the Cog's raised stern is a closed silhouette");

  const happyBay = boatById("happy-bay/boat").profile;
  assert.deepEqual(happyBay.rigs.map((entry) => entry.type), ["junk", "junk", "staysail"]);
  assert.equal(happyBay.roof, undefined);
  assert.equal(happyBay.cabin, undefined);
  assert.ok(happyBay.structures?.length, "the Happy Bay deckhouse is a closed silhouette");
});

test("migrates assigned boats to the one visible lower-right presentation", () => {
  const chart = createChart();
  chart.features.push({ id: "port", lat: 3, lon: 4, name: "Port", boatId: "old-chronian/aelasyl", boatCorner: "nw", showBoat: false });
  chart.features.push({ id: "fallback", lat: 4, lon: 5, name: "Fallback", boatId: "vanilla/dhow", boatCorner: "middle" });
  const restored = sanitizeWorkspace({ activeChartId: chart.id, charts: [chart] }).charts[0].features;
  assert.equal(assignedBoat(restored[0]).name, "Aelasyl");
  assert.equal(restored[0].boatCorner, "se");
  assert.equal(restored[0].showBoat, true);
  assert.equal(visibleBoat(restored[0]).name, "Aelasyl");
  assert.equal(restored[1].boatCorner, "se");
});

test("imports island placements from the empty-sea legacy format", () => {
  const chart = importLegacyMap({ islands: { "emerald/dead_cove": { x: 4.5, y: 31.25 }, missing: { x: 0, y: 0 } } });
  assert.equal(chart.features.length, 1);
  assert.deepEqual(chart.features[0], {
    id: chart.features[0].id,
    lat: 31.25,
    lon: 4.5,
    name: "Dead Cove",
    notes: "",
    day: "",
    time: "",
    rangeNm: 0,
    islandId: "emerald/dead_cove",
    showIsland: true
  });
  assert.equal(islandById(chart.features[0].islandId).name, "Dead Cove");
});

test("translates a mixed selection by one exact shared delta", () => {
  const chart = createChart();
  chart.features.push({ id: "a", lat: 10, lon: 20, name: "A" }, { id: "b", lat: 12, lon: 24, name: "B" });
  chart.route.push({ id: "r", lat: 8, lon: 18, name: "" });
  chart.winds.push(createWind({ lat: 6, lon: 16, bearing: 45 }));
  translateChartItems(chart, [{ kind: "feature", id: "a" }, { kind: "feature", id: "b" }, { kind: "route", id: "r" }, { kind: "wind", id: chart.winds[0].id }], { lat: 1, lon: -2 }, { strict: true });
  assert.deepEqual(chart.features.map(({ lat, lon }) => [lat, lon]), [[11, 18], [13, 22]]);
  assert.deepEqual([chart.route[0].lat, chart.route[0].lon], [9, 16]);
  assert.deepEqual([chart.winds[0].lat, chart.winds[0].lon], [7, 14]);
  assert.throws(() => translateChartItems(chart, [{ kind: "feature", id: "a" }], { lat: 100, lon: 0 }, { strict: true }), /outside/);
});

test("archives the active route and preserves waypoint notes", () => {
  const chart = createChart();
  chart.route.push(
    createRoutePoint({ lat: 1, lon: 2, name: "Departure", notes: "Wait for daylight" }),
    createRoutePoint({ lat: 3, lon: 4, name: "Turn", notes: "Avoid shoal" })
  );
  const archived = archiveActiveRoute(chart);
  assert.equal(chart.route.length, 0);
  assert.equal(chart.savedRoutes.length, 1);
  assert.equal(archived.points[1].notes, "Avoid shoal");
  const restored = sanitizeWorkspace({ activeChartId: chart.id, charts: [chart] }).charts[0];
  assert.equal(restored.savedRoutes[0].points[0].notes, "Wait for daylight");
});

test("moves anchored searches once with their owner and detaches them when moved alone", () => {
  const chart = createChart();
  chart.features.push({ id: "port", lat: 2, lon: 3, name: "Port" });
  chart.searches.push(createSearch({ lat: 2, lon: 3, bearing: 90, distanceNm: 100, anchor: { kind: "feature", id: "port" } }));
  const search = chart.searches[0];
  translateChartItems(chart, [{ kind: "feature", id: "port" }, { kind: "search", id: search.id }], { lat: 1, lon: 1 });
  assert.deepEqual([search.lat, search.lon], [3, 4]);
  assert.deepEqual(search.anchor, { kind: "feature", id: "port" });
  translateChartItems(chart, [{ kind: "search", id: search.id }], { lat: 1, lon: 0 });
  assert.deepEqual([search.lat, search.lon], [4, 4]);
  assert.equal(search.anchor, undefined);
  assert.equal(itemForRef(chart, { kind: "search", id: search.id }), search);
});

function chartWithSavedRoute() {
  const chart = createChart();
  chart.route.push(createRoutePoint({ lat: 0, lon: 0 }), createRoutePoint({ lat: 1, lon: 1 }), createRoutePoint({ lat: 2, lon: 0 }));
  const route = archiveActiveRoute(chart);
  return { chart, route };
}

test("saved routes and their waypoints stay selectable after saving", () => {
  const { chart, route } = chartWithSavedRoute();
  const [first] = route.points;
  assert.equal(itemForRef(chart, { kind: "saved-route", id: route.id }), route);
  assert.equal(itemForRef(chart, { kind: "saved-point", id: first.id }), first);
  assert.equal(savedRouteForPoint(chart, first.id), route);
  assert.deepEqual(chartItemFocusPoint("saved-route", route), { lat: 1, lon: 0.5 });
  assert.equal(route.hidden, false);
});

test("moving a saved route moves every waypoint, while a waypoint can move alone", () => {
  const { chart, route } = chartWithSavedRoute();
  translateChartItems(chart, [{ kind: "saved-route", id: route.id }], { lat: 1, lon: 2 });
  assert.deepEqual(route.points.map(({ lat, lon }) => [lat, lon]), [[1, 2], [2, 3], [3, 2]]);
  translateChartItems(chart, [{ kind: "saved-point", id: route.points[1].id }], { lat: -1, lon: 0 });
  assert.deepEqual(route.points.map(({ lat }) => lat), [1, 1, 3]);
});

test("deleting saved waypoints removes an emptied route", () => {
  const { chart, route } = chartWithSavedRoute();
  removeChartItems(chart, [{ kind: "saved-point", id: route.points[0].id }]);
  assert.equal(route.points.length, 2);
  removeChartItems(chart, route.points.map((point) => ({ kind: "saved-point", id: point.id })));
  assert.deepEqual(chart.savedRoutes, []);
  const second = chartWithSavedRoute();
  removeChartItems(second.chart, [{ kind: "saved-route", id: second.route.id }]);
  assert.deepEqual(second.chart.savedRoutes, []);
});

test("a search drawn from a waypoint stays locked to it after the route is saved", () => {
  const chart = createChart();
  const waypoint = createRoutePoint({ lat: 5, lon: 5 });
  chart.route.push(waypoint);
  chart.searches.push(createSearch({ lat: 5, lon: 5, bearing: 90, distanceNm: 50, anchor: { kind: "route", id: waypoint.id } }));
  archiveActiveRoute(chart);
  assert.deepEqual(chart.searches[0].anchor, { kind: "saved-point", id: waypoint.id });
  translateChartItems(chart, [{ kind: "saved-point", id: waypoint.id }], { lat: 1, lon: 0 });
  assert.equal(chart.searches[0].lat, 6);
  const restored = sanitizeWorkspace({ charts: [chart] }).charts[0];
  assert.deepEqual(restored.searches[0].anchor, { kind: "saved-point", id: waypoint.id });
});

test("keeps a saved route hidden through workspace sanitation", () => {
  const { chart, route } = chartWithSavedRoute();
  route.hidden = true;
  assert.equal(sanitizeWorkspace({ charts: [chart] }).charts[0].savedRoutes[0].hidden, true);
});

const fixture = async (name) => JSON.parse(await (await import("node:fs/promises")).readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

test("imports a single-chart export written by Chartroom 0.4.15", async () => {
  const [chart] = importChartData(await fixture("chartroom-0.4.15-chart.json"));
  assert.equal(chart.name, "Fixture Sea (imported)");
  assert.equal(chart.seed, "4815");
  assert.deepEqual(chart.features.map((feature) => feature.name), ["Dead Cove", ""]);
  assert.equal(chart.features[1].rangeNm, 25);
  assert.equal(chart.features[1].boatId, "vanilla/dhow");
  assert.equal(chart.savedRoutes[0].points[1].notes, "Avoid shoal");
  assert.equal(chart.savedRoutes[0].hidden, false);
  assert.equal(chart.route[0].name, "Next leg");
  assert.equal(chart.searches[0].label, "Gold Rock");
  assert.equal(chart.winds[0].label, "Trades");
  assert.equal(chart.track[0].wind, "NE 4");
});

test("imports a whole-workspace backup written by Chartroom 0.4.15", async () => {
  const charts = importChartData(await fixture("chartroom-0.4.15-backup.json"));
  assert.equal(charts.length, 1);
  assert.equal(charts[0].features.length, 2);
});

test("opens a 0.4.15 workspace file unchanged apart from new defaults", async () => {
  const saved = await fixture("chartroom-0.4.15-backup.json");
  const workspace = sanitizeWorkspace(saved);
  assert.equal(workspace.activeChartId, saved.activeChartId);
  assert.equal(workspace.layout.leftWidth, 300);
  assert.deepEqual(workspace.charts[0].features, saved.charts[0].features);
});

test("labelled exports round-trip every chart item", async () => {
  const [original] = importChartData(await fixture("chartroom-0.4.15-chart.json"));
  const file = JSON.parse(JSON.stringify(exportFile([original])));
  assert.equal(file.format, "sailwind-chartroom");
  assert.equal(file.version, 1);
  const [copy] = importChartData(file);
  const { id, name, ...rest } = copy;
  const { id: originalId, name: originalName, ...originalRest } = original;
  assert.notEqual(id, originalId);
  assert.deepEqual(rest, originalRest);
});

test("refuses files from a newer Chartroom instead of dropping what it cannot read", () => {
  assert.throws(() => importChartData({ format: "sailwind-chartroom", version: 2, charts: [createChart()] }), /newer version of Chartroom/);
  assert.throws(() => importChartData({ format: "sailwind-chartroom", version: 1, charts: [] }), /no charts/);
});

test("CSV text that a spreadsheet would run as a formula is neutralized", () => {
  const csv = featuresToCsv([{ name: "=HYPERLINK(\"x\")", lat: -12.5, lon: -3, day: "", time: "", notes: "@cmd" }]);
  const [, row] = csv.split("\r\n");
  assert.ok(row.startsWith(`"'=HYPERLINK(""x"")",-12.5,-3,`));
  assert.ok(row.endsWith(",'@cmd"));
});

test("tool shortcuts are single unique keys that leave Fit and Islands alone", async () => {
  assert.equal(validateShortcuts({ ...defaultShortcuts(), location: "K" }).location, "k");
  assert.throws(() => validateShortcuts({ ...defaultShortcuts(), location: "r" }), /can't share R/);
  assert.throws(() => validateShortcuts({ ...defaultShortcuts(), wind: "f" }), /fit the chart/);
  assert.throws(() => validateShortcuts({ ...defaultShortcuts(), wind: "" }), /Add wind/);
  const restored = sanitizeWorkspace({ charts: [createChart()], settings: { shortcuts: { location: "r" }, checkForUpdates: false, skippedUpdate: "0.6", interfaceSize: 137, theme: "neon", appearance: "dusk" } });
  assert.deepEqual(restored.settings, { shortcuts: defaultShortcuts(), checkForUpdates: false, skippedUpdate: "0.6", interfaceSize: 0, theme: "chartroom", appearance: "system" });
  assert.equal(sanitizeWorkspace({ charts: [createChart()], settings: { theme: "sailwind", appearance: "dark" } }).settings.theme, "sailwind");
  assert.equal(sanitizeWorkspace({ charts: [createChart()], settings: { interfaceSize: 150 } }).settings.interfaceSize, 150);
});

test("resolving a named search answers every search with that name, ignoring case", () => {
  const named = (label) => createSearch({ lat: 0, lon: 0, bearing: 90, distanceNm: 50, label });
  const searches = [named("Chronos"), named(" chronos "), named("Other"), named(""), named("")];
  assert.deepEqual(searchesAnsweredBy(searches, searches[0]), searches.slice(0, 2));
  assert.deepEqual(searchesAnsweredBy(searches, searches[3]), [searches[3]]);
});

test("release notes become plain heading, bullet and text lines", async () => {
  const { releaseNoteLines } = await import("../src/format.mjs");
  assert.deepEqual(releaseNoteLines("## Added\r\n- **Tides** from [the wiki](https://example.com/x)\n\nPlain `code`"), [
    { kind: "heading", text: "Added" },
    { kind: "bullet", text: "Tides from the wiki (https://example.com/x)" },
    { kind: "text", text: "Plain code" }
  ]);
});

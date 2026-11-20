// Chart notes, location icons, Voyage Recorder 0.2.0 lines, equipment readings, chart folders and voyage files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ICON_SIZES, iconScale, createChart, createFeature, createNote, createSearch, createWorkspace, importChartData, itemShown, newRecorderNotes, newVisits, readVoyageRecorder, removeChartItems, sanitizeChart, sanitizeWorkspace, SCHEMA_VERSION } from "../src/model.mjs";
import { instrumentsAt, localHours, readingKnowledge, sanitizeEquipment, setInstruments } from "../src/equipment.mjs";
import { chartGroups, createFolder, deleteFolder, moveChartToFolder, shiftChart, shiftFolder } from "../src/folders.mjs";
import { buildVoyageFile, defaultShare, exportablePoints, hashGameId, parseVoyageFile, positionAtElapsed, sameWorld } from "../src/voyages.mjs";
import { applyMarks, discoveredMarks } from "../src/discoveries.mjs";
import { islandById, visibleIsland } from "../src/islands.mjs";

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const log = (...records) => records.map((record) => JSON.stringify(record)).join("\n");

function relocatedArrivals() {
  const session = { type: "session", game: "g1", world: { kind: "scrambled" } };
  const landing = { type: "landfall", day: 3, hour: 9, source: "native", islandId: "38",
    lat: 34.31, lon: 13.02, islandLat: 34.32, islandLon: 13.03 };
  const offset = { offsetLat: 2.8751234, offsetLon: 7.7504321 };
  const port = { type: "port", day: 3, hour: 10, island: 38, port: "Turtle Island",
    lat: landing.islandLat, lon: landing.islandLon, ...offset };
  return { session, landing, port, offset, outline: { lat: 34.3081034, lon: 13.0110321 } };
}

test("a 0.8.11 chart opens unchanged, with the new parts empty", async () => {
  const [chart] = importChartData(await fixture("chartroom-0.8.11-chart.json"));
  assert.equal(chart.features[0].name, "Gold Rock City");
  assert.equal(chart.features[0].notes, "home port");
  assert.equal(chart.features[0].icon, undefined);
  assert.equal(chart.track.length, 2);
  assert.equal(chart.track[1].knots, 5.4);
  assert.equal(chart.drPositions.length, 1);
  assert.deepEqual([chart.notes, chart.visits, chart.comparisons, chart.recording], [[], [], [], null]);
  assert.equal(chart.equipment.enabled, false);
  assert.equal(SCHEMA_VERSION, 4);
});

test("a location keeps a known icon and drops anything else", () => {
  assert.equal(createFeature({ lat: 30, lon: 1, icon: "fog-whales" }).icon, "fog-whales");
  assert.equal(createFeature({ lat: 30, lon: 1, icon: "kraken" }).icon, undefined);
  const chart = sanitizeChart({ ...createChart(), features: [{ id: "f", lat: 30, lon: 1, name: "Whales", icon: "whales" }] });
  assert.equal(chart.features[0].icon, "whales");
  assert.equal(createFeature({ lat: 30, lon: 1, size: "large" }).size, "large");
  assert.equal(createFeature({ lat: 30, lon: 1, size: "normal" }).size, "normal", "an item can choose normal over a smaller default");
  assert.equal(createFeature({ lat: 30, lon: 1 }).size, undefined, "without its own size, an item follows the default");
  assert.equal(iconScale({}, "small"), ICON_SIZES.small);
  assert.equal(iconScale({ size: "large" }, "small"), ICON_SIZES.large);
  assert.equal(createFeature({ lat: 30, lon: 1, size: "huge" }).size, undefined);
  assert.equal(createNote({ lat: 30, lon: 1, size: "tiny" }).size, "tiny");
});

test("notes keep long text, and deleting a Voyage Recorder note keeps it from coming back", () => {
  const long = "a".repeat(25000);
  const note = createNote({ lat: 31, lon: -2, text: long });
  assert.equal(note.text.length, 20000);
  const chart = createChart();
  const recorded = [{ recorderId: "n1", lat: 31, lon: -2, text: "Whales" }, { recorderId: "n2", lat: 31.1, lon: -2, text: "Fog" }];
  chart.notes.push(...newRecorderNotes(chart, recorded));
  assert.deepEqual(chart.notes.map((entry) => entry.text), ["Whales", "Fog"]);
  // Following the same log again adds nothing.
  assert.deepEqual(newRecorderNotes(chart, recorded), []);
  // Local edits stay: the note is matched by its id, not its text.
  chart.notes[0].text = "Whales, three of them";
  assert.deepEqual(newRecorderNotes(chart, recorded), []);
  removeChartItems(chart, [{ kind: "note", id: chart.notes[1].id }]);
  assert.deepEqual(chart.dismissedNotes, ["n2"]);
  assert.deepEqual(newRecorderNotes(chart, recorded), []);
  const restored = sanitizeChart(JSON.parse(JSON.stringify(chart)));
  assert.equal(restored.notes[0].text, "Whales, three of them");
  assert.deepEqual(restored.dismissedNotes, ["n2"]);
});

test("Voyage Recorder 0.2.0 lines give notes, visits, the world, mods and keys", () => {
  const text = log(
    { type: "session", utc: 1794744000.5, day: 3, hour: 9, game: "g1", world: { kind: "scrambled", seed: -5, layout: "00ff", scrambledSeas: "6.0.2", junk: { a: 1 } }, plugins: [{ guid: "a.b", name: "A", version: "1.0" }], keys: { record: "J", location: "V", note: "N" } },
    { type: "position", utc: 1794744010, day: 3, hour: 9.5, lat: 30.3, lon: -2.4, windFrom: 180, windKnots: 10 },
    { type: "port", day: 3, hour: 10, port: "Gold Rock City", island: 1, lat: 30.2, lon: -2.45, portLat: 30.2, portLon: -2.45 },
    { type: "depart", day: 3, hour: 11, port: "Gold Rock City", island: 1 },
    { type: "note", id: "n1", day: 3, hour: 11.5, lat: 30.4, lon: -2.2, text: "Whales\noff the bow", boat: "dhow medium", course: 45, knots: 4 },
    { type: "keys", keys: { record: "K", location: "V", note: "N" } }
  );
  const voyage = readVoyageRecorder(text);
  assert.equal(voyage.points[0].utc, 1794744010);
  assert.equal(voyage.points[0].windKnots, 10);
  assert.deepEqual(voyage.visits.map((visit) => [visit.kind, visit.port, visit.t]), [["arrive", "Gold Rock City", 82], ["depart", "Gold Rock City", 83]]);
  assert.equal(voyage.notes[0].text, "Whales\noff the bow");
  assert.equal(voyage.notes[0].boat, "Sanbuq");
  assert.equal(voyage.notes[0].recorderId, "n1");
  assert.deepEqual(voyage.session.world, { kind: "scrambled", seed: -5, layout: "00ff", scrambledSeas: "6.0.2" });
  assert.deepEqual(voyage.session.plugins, [{ guid: "a.b", name: "A", version: "1.0" }]);
  assert.deepEqual(voyage.keys, { record: "K", location: "V" }, "keys Voyage Recorder no longer has are left out");
  const chart = createChart();
  chart.visits.push(...newVisits(chart, voyage.visits));
  assert.deepEqual(newVisits(chart, voyage.visits), [], "visits already on the chart aren't added twice");
});

test("return visits and reimports keep one landfall per island, including after reopening the chart", () => {
  const atoll = { type: "landfall", day: 3, hour: 9, source: "terra-incognita", islandId: "terra incognita Atoll (route) #12", name: "Atoll (route) #12", lat: 30.201, lon: -2.451, islandLat: 30.205, islandLon: -2.455 };
  const returned = { ...atoll, hour: 10, lat: 30.208, islandLat: 30.20501 };
  const otherAtoll = { ...atoll, islandId: "terra incognita Atoll (route) #13", name: "Atoll (route) #13", lat: 30.21, islandLat: 30.22 };
  const regenerated = { ...atoll, lat: 30.301, islandLat: 30.305 };
  const recorded = readVoyageRecorder(log(atoll, returned, otherAtoll, regenerated, { ...atoll, islandLat: null }));
  assert.equal(recorded.landfalls.length, 4);
  const chart = createChart();
  applyMarks(chart, discoveredMarks(chart, recorded));
  assert.deepEqual(chart.features.map(({ name, lat }) => [name, lat]), [["Atoll #12", atoll.lat], ["Atoll #13", otherAtoll.lat], ["Atoll #12", regenerated.lat]]);
  assert.ok(chart.features.every((feature) => !feature.islandId && !feature.showIsland));
  chart.features[0].name = "My landing";
  chart.features[0].lat += 0.01;
  const reopened = sanitizeChart(JSON.parse(JSON.stringify(chart)));
  assert.equal(discoveredMarks(reopened, recorded).features.length, 0);
  assert.equal(reopened.features[0].name, "My landing");
  // Live updates also apply to older undo snapshots, which may already have the location.
  applyMarks(reopened, discoveredMarks(createChart(), recorded));
  assert.equal(reopened.features.length, 3);
});

test("a SeaStacks landfall upgrades its old pin to the recorded variant and orientation", () => {
  const landing = { type: "landfall", day: 3, hour: 9, source: "terra-incognita",
    islandId: "terra incognita SeaStacks (scatter:archipelago0@(41000,-43000)) #1",
    name: "SeaStacks (scatter:archipelago0@(41000,-43000)) #1",
    lat: 31.4105, lon: 3.559, islandLat: 31.413, islandLon: 3.5569 };
  const visit = { ...landing, prefab: "stacks_13", yaw: 270 };
  const update = (chart, record) => applyMarks(chart, discoveredMarks(chart, readVoyageRecorder(log(record))));
  const fresh = createChart();
  fresh.features.push(createFeature({ lat: landing.lat, lon: landing.lon, name: landing.name, rangeNm: 5 }));
  update(fresh, visit);
  assert.deepEqual(fresh.features.map(({ name, rangeNm }) => [name, rangeNm]), [["Sea Stacks #1", 0]],
    "the display label is shortened while the recorded name still resolves the matching area");
  const old = createChart();
  update(old, landing);
  const [pin] = old.features;
  assert.equal(visibleIsland(pin), null, "a family name does not identify an outline");
  pin.notes = "A sheltered landing";

  const chart = sanitizeChart(JSON.parse(JSON.stringify(old)));
  update(chart, visit);
  assert.deepEqual(chart.features.map(({ id, islandId, lat, lon, notes }) => [id, islandId, lat, lon, notes]),
    [[pin.id, "terra-incognita/stacks_13", landing.islandLat, landing.islandLon, pin.notes]]);
  const reopened = sanitizeChart(JSON.parse(JSON.stringify(chart)));
  const island = visibleIsland(reopened.features[0]);
  const [east, north] = islandById("terra-incognita/stacks_13").shapes[0].rings[0];
  assert.deepEqual(island.shapes[0].rings[0].slice(0, 2), [-north, east], "a 270° yaw rotates the outline around the recorded root");
  update(reopened, visit);
  assert.equal(reopened.features.length, 1);
});

test("Terra Incognita locations display the family and number while keeping recorded identity and custom labels", () => {
  const name = "VolcanicBay (scatter:archipelago2@(43000,-33000)) #13";
  const landing = { type: "landfall", day: 3, hour: 9, source: "terra-incognita",
    islandId: `terra incognita ${name}`, name, prefab: "volcanic_3", yaw: 0,
    lat: 31.4, lon: 3.559, islandLat: 31.401, islandLon: 3.5569 };
  const chart = createChart();
  const recorded = readVoyageRecorder(log(landing));
  applyMarks(chart, discoveredMarks(chart, recorded));
  const [feature] = chart.features;
  assert.equal(feature.name, "Volcanic Bay #13");
  assert.equal(feature.discovery.islandId, landing.islandId);
  assert.equal(recorded.landfalls[0].name, name);

  feature.name = name;
  const reopened = sanitizeChart(JSON.parse(JSON.stringify(chart)));
  assert.equal(reopened.features[0].name, "Volcanic Bay #13", "an existing automatic label is shortened on load");
  assert.equal(reopened.features[0].id, feature.id);
  feature.name = "My volcanic anchorage (west) #13";
  assert.equal(sanitizeChart(chart).features[0].name, feature.name, "a custom label is preserved");
});

test("known native landfalls share a chart location with their island or port", () => {
  const island = islandById("alankh/gold_rock_city");
  const landfall = { type: "landfall", day: 3, hour: 9, source: "native", islandId: "1", lat: island.sourceCenter.lat + 0.01, lon: island.sourceCenter.lon, islandLat: island.sourceCenter.lat, islandLon: island.sourceCenter.lon };
  const port = { type: "port", day: 3, hour: 10, island: 1, port: island.name, lat: landfall.islandLat, lon: landfall.islandLon };
  const previousGame = { type: "session", game: "g1", world: { kind: "scrambled", layout: "ff00" } };
  const vanillaGame = { type: "session", game: "g2", world: { kind: "vanilla" } };
  const carry = {};
  const chart = createChart();
  chart.layers.vanillaMap = true;
  const recorded = readVoyageRecorder(log(previousGame, landfall, vanillaGame, landfall), carry, { latestGame: true });
  assert.equal(recorded.landfalls.length, 1);
  const landingMarks = discoveredMarks(chart, recorded);
  assert.deepEqual(landingMarks.features.map(({ islandId, lat, lon, showIsland }) => ({ islandId, lat, lon, showIsland })), [{ islandId: island.id, ...island.sourceCenter, showIsland: true }]);
  applyMarks(chart, landingMarks);
  const portLater = readVoyageRecorder(log(port), carry);
  assert.equal(portLater.visits.length, 1);
  assert.equal(discoveredMarks(chart, portLater).features.length, 0);

  const portFirst = createChart();
  applyMarks(portFirst, discoveredMarks(portFirst, portLater));
  assert.equal(discoveredMarks(portFirst, recorded).features.length, 0);
  const both = discoveredMarks(createChart(), readVoyageRecorder(log(vanillaGame, landfall, port)));
  assert.equal(both.features.length, 1);
  assert.deepEqual(both.features.map(({ islandId, lat, lon, showIsland }) => ({ islandId, lat, lon, showIsland })),
    [{ islandId: island.id, ...island.sourceCenter, showIsland: true }]);
  const relocated = readVoyageRecorder(log(previousGame, { ...landfall, lat: 45, lon: 20, islandLat: 45.01, islandLon: 20.01 }));
  assert.deepEqual(discoveredMarks(chart, relocated).features.map(({ lat, lon, showIsland }) => ({ lat, lon, showIsland })), [{ lat: 45, lon: 20, showIsland: false }]);
});

test("a landfall resolves its named areas like a manual location, including when replayed", () => {
  const chart = createChart();
  const centre = islandById("emerald/pondering_peak").sourceCenter;
  const search = createSearch({ lat: centre.lat, lon: centre.lon - 0.5, bearing: 90, distanceNm: 70, label: "pondering  peak" });
  const other = createSearch({ ...search, label: "New Port" });
  const distant = createSearch({ ...search, lat: centre.lat + 3 });
  const rough = createFeature({ ...centre, name: "Pondering Peak", rangeNm: 5 });
  chart.searches.push(search, other, distant);
  chart.features.push(rough);
  const recorded = readVoyageRecorder(log(
    { type: "session", game: "g1", world: { kind: "vanilla" } },
    { type: "landfall", day: 3, hour: 9, source: "native", islandId: "39", ...centre, islandLat: centre.lat, islandLon: centre.lon },
    { type: "mission", day: 3, hour: 9, origin: "New Port", originIsland: 12, originLat: search.lat, originLon: search.lon,
      destination: "Pondering Peak", destinationIsland: 39, heading: 90, miles: 70, points: 16 }
  ));
  const retained = discoveredMarks(chart, recorded, { clearReached: false });
  assert.deepEqual([retained.answered, retained.cleared], [[], []]);
  const marks = discoveredMarks(chart, recorded);
  assert.deepEqual([marks.answered, marks.cleared, marks.searches], [[search.id], [rough.id], []]);
  applyMarks(chart, marks);
  assert.deepEqual(chart.searches.map(({ id }) => id), [other.id, distant.id]);
  chart.searches.push(search);
  const replay = discoveredMarks(chart, recorded);
  assert.deepEqual([replay.answered, replay.features], [[search.id], []]);
});

test("a relocated native landfall applies its recorded outline offset and upgrades an old pin", () => {
  const island = islandById("emerald/turtle_island");
  const session = { type: "session", game: "g1", world: { kind: "scrambled" } };
  const landing = { type: "landfall", day: 3, hour: 9, source: "native", islandId: "38", lat: 34.31, lon: 13.02, islandLat: 34.32, islandLon: 13.03 };
  const withOffset = { ...landing, lat: 34.315, offsetLat: 2.8751234, offsetLon: 7.7504321 };
  const position = { lat: island.sourceCenter.lat + withOffset.offsetLat, lon: island.sourceCenter.lon + withOffset.offsetLon };
  const found = readVoyageRecorder(log(session, landing, withOffset));
  const fresh = discoveredMarks(createChart(), found);
  assert.deepEqual(fresh.features.map(({ lat, lon, showIsland }) => ({ lat, lon, showIsland })), [{ ...position, showIsland: true }]);

  const portFirst = createChart();
  const port = { type: "port", day: 3, hour: 8, island: 38, port: "Turtle Island", lat: withOffset.islandLat, lon: withOffset.islandLon,
    offsetLat: withOffset.offsetLat, offsetLon: withOffset.offsetLon };
  applyMarks(portFirst, discoveredMarks(portFirst, readVoyageRecorder(log(session, port))));
  const portLocation = portFirst.features[0].id;
  assert.equal(discoveredMarks(portFirst, readVoyageRecorder(log(session, withOffset))).features.length, 0,
    "a later shifted landfall reuses the port's outline position even when the game root is outside the outline");
  applyMarks(portFirst, fresh);
  assert.deepEqual(portFirst.features.map(({ id }) => id), [portLocation], "applying the landfall to an older undo snapshot also reuses the port outline");

  const old = {
    ...createFeature({ lat: landing.lat, lon: landing.lon, islandId: island.id, showIsland: false, name: "My landing", notes: "Walked ashore" }),
    landfall: { source: landing.source, islandId: landing.islandId, islandLat: landing.islandLat, islandLon: landing.islandLon }
  };
  const chart = sanitizeChart({ ...createChart(), features: [old] });
  const moved = sanitizeChart({ ...createChart(), features: [{ ...old, lat: old.lat + 0.01 }] });
  assert.equal(discoveredMarks(moved, found).outlines.length, 0, "a manually moved marker keeps its placement");
  applyMarks(chart, discoveredMarks(chart, found));
  assert.deepEqual(chart.features.map(({ id, name, notes, lat, lon, showIsland }) => ({ id, name, notes, lat, lon, showIsland })),
    [{ id: old.id, name: "My landing", notes: "Walked ashore", ...position, showIsland: true }]);
});

test("a later port record upgrades the same relocated landfall pin after reopening", () => {
  const { session, landing, port, outline } = relocatedArrivals();
  const chart = createChart();
  applyMarks(chart, discoveredMarks(chart, readVoyageRecorder(log(session, landing))));
  const { id } = chart.features[0];
  chart.features[0].name = "My landing";
  chart.features[0].notes = "First time ashore";
  const reopened = sanitizeChart(JSON.parse(JSON.stringify(chart)));
  const incoming = readVoyageRecorder(log(session, port));
  for (const edit of [{ lat: 34 }, { locked: true }]) {
    const edited = sanitizeChart({ ...chart, features: [{ ...chart.features[0], ...edit }] });
    applyMarks(edited, discoveredMarks(edited, incoming));
    assert.deepEqual(edited.features.map((feature) => [feature.id, feature.lat, feature.showIsland]),
      [[id, edit.lat ?? landing.lat, false]], "a moved or locked pin keeps its placement");
  }
  applyMarks(reopened, discoveredMarks(reopened, incoming));
  assert.deepEqual(reopened.features.map(({ id, name, notes, showIsland }) => ({ id, name, notes, showIsland })),
    [{ id, name: "My landing", notes: "First time ashore", showIsland: true }]);
  assert.ok(Math.abs(reopened.features[0].lat - outline.lat) < 1e-7 &&
    Math.abs(reopened.features[0].lon - outline.lon) < 1e-7, "the port supplies the shifted outline position");

  const imported = readVoyageRecorder(log(session, landing, port));
  assert.equal(imported.landfalls.length, 1);
  assert.deepEqual(imported.visits.map(({ kind, port }) => [kind, port]), [["arrive", "Turtle Island"]]);
  const batch = discoveredMarks(createChart(), imported);
  assert.deepEqual(batch.features.map(({ lat, lon, showIsland }) => ({ lat, lon, showIsland })),
    reopened.features.map(({ lat, lon, showIsland }) => ({ lat, lon, showIsland })));
  assert.equal(discoveredMarks(reopened, imported).features.length, 0, "replaying the same arrivals adds nothing");
});

test("a relocated port marker keeps its edit when the same island is reached ashore", () => {
  const { session, landing, port, offset } = relocatedArrivals();
  const chart = createChart();
  applyMarks(chart, discoveredMarks(chart, readVoyageRecorder(log(session, port))));
  const existing = chart.features[0];
  Object.assign(existing, { lat: existing.lat + 1, name: "My anchorage", notes: "Sheltered" });
  const reopened = sanitizeChart(JSON.parse(JSON.stringify(chart)));
  const landingMarks = discoveredMarks(reopened, readVoyageRecorder(log(session, { ...landing, ...offset })));
  applyMarks(reopened, landingMarks);
  assert.deepEqual(reopened.features.map(({ id, lat, lon, name, notes }) => [id, lat, lon, name, notes]),
    [[existing.id, existing.lat, existing.lon, existing.name, existing.notes]]);
});

test("nearby recorded islands with the same label have separate locations", () => {
  const { session, port } = relocatedArrivals();
  const arrivals = readVoyageRecorder(log(session, port, { ...port, island: 37, lat: port.lat + 0.0005 }));
  const chart = createChart();
  applyMarks(chart, discoveredMarks(chart, arrivals));
  assert.deepEqual(chart.features.map(({ islandId }) => islandId), ["emerald/turtle_island", "emerald/dead_cove"]);
});

test("a same-name port record without an island ID reuses a known discovery at the reported root", () => {
  const { session, port } = relocatedArrivals();
  const chart = createChart();
  applyMarks(chart, discoveredMarks(chart, readVoyageRecorder(log(session, port))));
  const [existing] = chart.features;
  const withoutIsland = { ...port, island: -1, port: "Turtle  Island" };
  applyMarks(chart, discoveredMarks(chart, readVoyageRecorder(log(session, withoutIsland))));
  assert.deepEqual(chart.features.map(({ id }) => id), [existing.id]);
  const elsewhere = { ...withoutIsland, lat: port.lat + 0.1 };
  applyMarks(chart, discoveredMarks(chart, readVoyageRecorder(log(session, elsewhere))));
  assert.equal(chart.features.length, 2, "an unrecognized port elsewhere has its own pin");
});

test("equipment readings show only what the instruments could find", () => {
  const chart = createChart();
  chart.equipment = sanitizeEquipment({ enabled: true, changes: [{ t: null, items: ["sun-compass"] }] });
  // At longitude 0, game time is local time.
  const at = (hour, items, lon = 0) => {
    chart.equipment.changes = [{ t: null, items }];
    return readingKnowledge(chart, { t: 24 + hour, lat: 30, lon });
  };
  assert.deepEqual(at(12.5, ["sun-compass"]), { lat: true, lon: false, course: false, speed: false });
  assert.deepEqual(at(12.5, ["sun-compass", "clock"]), { lat: true, lon: true, course: false, speed: false });
  assert.deepEqual(at(14, ["sun-compass", "chronometer"]).lat, false, "more than an hour from noon");
  assert.equal(at(23, ["quadrant"]).lat, true, "a quadrant at night");
  assert.equal(at(12, ["quadrant"]).lat, true, "a quadrant at noon");
  assert.equal(at(12, ["quadrant", "chronometer"]).lon, false, "longitude needs the sun compass");
  assert.equal(at(9, ["quadrant"]).lat, false, "a quadrant in the morning");
  assert.deepEqual(at(9, ["compass", "chip-log"]), { lat: false, lon: false, course: true, speed: true });
  // 30° east is two hours ahead: game time 10:00 is local noon there.
  assert.equal(localHours({ t: 34, lon: 30 }), 12);
  assert.equal(at(10, ["sun-compass"], 30).lat, true);
  chart.equipment.enabled = false;
  assert.deepEqual(readingKnowledge(chart, { t: 30, lat: 30, lon: 0 }), { lat: true, lon: true, course: true, speed: true });
});

test("equipment changes apply from the latest position onward and hide earlier fixes", () => {
  const equipment = sanitizeEquipment({ enabled: true });
  setInstruments(equipment, ["sun-compass"], null);
  setInstruments(equipment, ["sun-compass", "chronometer"], 100);
  setInstruments(equipment, ["sun-compass", "chronometer", "compass"], 100);
  assert.equal(equipment.changes.length, 2, "a change at the same time replaces the last");
  assert.deepEqual([...instrumentsAt(equipment, 50)], ["sun-compass"]);
  assert.deepEqual([...instrumentsAt(equipment, 150)], ["sun-compass", "chronometer", "compass"]);
  const chart = createChart();
  chart.equipment = equipment;
  const before = { lat: 30, lon: 0, t: 84 };
  const after = { lat: 30, lon: 0, t: 108 };
  assert.equal(itemShown(chart, "track", before), false, "a noon fix from before the chronometer stays hidden");
  assert.equal(itemShown(chart, "track", after), true);
  chart.equipment.enabled = false;
  assert.equal(itemShown(chart, "track", before), true, "turning equipment readings off shows it again");
});

test("charts sort into folders, and deleting a folder keeps its charts", () => {
  const workspace = createWorkspace();
  const [first] = workspace.charts;
  const second = { ...createChart({ name: "Second" }) };
  const third = { ...createChart({ name: "Third" }) };
  workspace.charts.push(second, third);
  const folder = createFolder(workspace, "Races", "folder-1");
  moveChartToFolder(workspace, second.id, folder.id);
  moveChartToFolder(workspace, third.id, folder.id);
  assert.deepEqual(chartGroups(workspace).map((group) => group.charts.map((chart) => chart.name)), [["Second", "Third"], [first.name]], "folders first, then charts in no folder");
  shiftChart(workspace, third.id, -1);
  assert.deepEqual(chartGroups(workspace)[0].charts.map((chart) => chart.name), ["Third", "Second"]);
  createFolder(workspace, "Old", "folder-2");
  shiftFolder(workspace, "folder-2", -1);
  assert.deepEqual(workspace.folders.map((entry) => entry.name), ["Old", "Races"]);
  const restored = sanitizeWorkspace(JSON.parse(JSON.stringify(workspace)));
  assert.equal(restored.charts.find((chart) => chart.name === "Second").folderId, "folder-1");
  deleteFolder(workspace, "folder-1");
  assert.equal(workspace.charts.length, 3);
  assert.ok(workspace.charts.every((chart) => !chart.folderId));
  // A chart naming a folder that's gone opens in no folder.
  const orphan = sanitizeWorkspace({ charts: [{ ...createChart(), folderId: "missing" }], folders: [] });
  assert.equal(orphan.charts[0].folderId, undefined);
});

test("a voyage file holds only what the player chose to share", async () => {
  const chart = createChart();
  chart.recording = { game: "secret-game-id", world: { kind: "vanilla" }, plugins: [{ guid: "x", name: "X", version: "1" }] };
  chart.track = readVoyageRecorder(log(
    { type: "session", day: 3, hour: 9, game: "secret-game-id" },
    { type: "position", day: 3, hour: 9, lat: 30, lon: 0, boat: "medi medium", hull: 5, windFrom: 90, windKnots: 8, utc: 100 },
    { type: "position", day: 3, hour: 10, lat: 30, lon: 0.1, event: "mark" },
    { type: "position", day: 3, hour: 11, lat: 30, lon: 0.2 }
  )).points;
  chart.visits = [{ kind: "depart", port: "Gold Rock City", island: 1, t: 81.5 }, { kind: "arrive", port: "Far", island: 2, t: 200 }];
  chart.notes = [createNote({ lat: 30, lon: 0.1, text: "private", t: 82 })];
  const gameHash = await hashGameId(chart.recording.game);
  assert.match(gameHash, /^[0-9a-f]{16}$/);
  const file = buildVoyageFile(chart, { from: 0, to: 2, gameHash, name: "Test run" });
  assert.equal(file.format, "sailwind-voyage");
  assert.equal(file.points.length, 2, "marks are left out by default");
  assert.equal(file.points[0].windFrom, 90);
  assert.equal(file.points[0].boat, "Brig");
  assert.equal(file.points[0].utc, 100);
  assert.deepEqual(file.visits.map((visit) => visit.port), ["Gold Rock City"], "only visits within the range");
  assert.equal(file.notes, undefined, "notes are left out by default");
  assert.deepEqual(file.plugins, chart.recording.plugins);
  assert.ok(!JSON.stringify(file).includes("secret-game-id"), "the game id itself never leaves");
  const lean = buildVoyageFile(chart, { from: 0, to: 2, share: { ...defaultShare(), boat: false, wind: false, hull: false, plugins: false, visits: false, notes: true, marks: true } });
  assert.equal(lean.points.length, 3);
  assert.equal(lean.points[0].boat, undefined);
  assert.equal(lean.points[0].windFrom, undefined);
  assert.equal(lean.points[0].hull, undefined);
  assert.equal(lean.plugins, undefined);
  assert.equal(lean.visits, undefined);
  assert.deepEqual(lean.notes.map((entry) => entry.text), ["private"]);
  const parsed = parseVoyageFile(JSON.parse(JSON.stringify(file)));
  assert.equal(parsed.points.length, 2);
  assert.throws(() => parseVoyageFile({ ...file, version: 2 }), /newer version/);
  assert.throws(() => parseVoyageFile({ format: "other" }), /isn't a route file/);
});

test("voyages compare by world and line up by elapsed time", () => {
  assert.equal(sameWorld({ kind: "vanilla" }, { kind: "vanilla" }), true);
  assert.equal(sameWorld({ kind: "vanilla" }, { kind: "scrambled", seed: 1 }), false);
  assert.equal(sameWorld({ kind: "scrambled", layout: "a" }, { kind: "scrambled", layout: "b" }), false);
  assert.equal(sameWorld({ kind: "unknown" }, { kind: "vanilla" }), null);
  const points = [{ t: 10, lat: 30, lon: 0 }, { t: 12, lat: 30, lon: 2 }];
  assert.deepEqual(positionAtElapsed(points, 10, 1).lon, 1);
  assert.equal(positionAtElapsed(points, 10, 3), null, "after the last reading");
  assert.equal(positionAtElapsed(points, 11, 0).lon, 1, "counted from a later start");
});

test("Chartroom Voyages forms, courses from routes, and race checks match the site", async () => {
  const { checkRaceLocally, courseFromRoute, heatmapSquares, issueFormUrl, siteUrl, worldKey } = await import("../src/site.mjs");
  const { islandById } = await import("../src/site-islands.mjs");
  assert.equal(issueFormUrl("enter-race", { course: "shipyard-tour" }), "https://github.com/Skeptic043/sailwind-chartroom-voyages/issues/new?template=enter-race.yml&course=shipyard-tour");
  assert.equal(siteUrl("voyages/vanilla/7.json"), "https://skeptic043.github.io/sailwind-chartroom-voyages/voyages/vanilla/7.json");
  assert.equal(worldKey({ kind: "vanilla" }), "vanilla");
  const scrambledWorld = { kind: "scrambled", seed: -5, islandSpread: 6500, minArchipelagoSeparation: 45000, minIslandSeparation: 1950, lonMin: -20, lonMax: 40, latMin: 20, latMax: 50, borderExpander: 1, scrambler: 60 };
  assert.match(worldKey(scrambledWorld), /^ss-[0-9a-f]{16}$/);
  assert.equal(worldKey({ kind: "scrambled", seed: -5 }), null, "a seed alone doesn't identify a map");

  const grc = islandById("alankh/gold_rock_city");
  const neverdin = islandById("alankh/neverdin");
  const sea = { lat: 31.5, lon: -3, name: "Turning mark" };
  const loop = courseFromRoute([{ lat: grc.lat, lon: grc.lon }, sea, { lat: neverdin.lat + 0.01, lon: neverdin.lon }, { lat: grc.lat, lon: grc.lon }], { kind: "vanilla" }, { name: "Neverdin and back", order: "fixed" });
  assert.equal(loop.id, "neverdin-and-back");
  assert.deepEqual(loop.start, { island: "alankh/gold_rock_city" });
  assert.deepEqual(loop.checkpoints, [{ name: "Turning mark", lat: 31.5, lon: -3, radiusNm: 3 }, { island: "alankh/neverdin" }]);
  assert.deepEqual(loop.finish, { island: "alankh/gold_rock_city" }, "a route back to its start finishes there");
  const oneWay = courseFromRoute([{ lat: grc.lat, lon: grc.lon }, { lat: neverdin.lat, lon: neverdin.lon }], { kind: "vanilla" }, { name: "Dash" });
  assert.deepEqual(oneWay.finish, { lastCheckpoint: true });
  const scrambled = courseFromRoute([{ lat: grc.lat, lon: grc.lon }, { lat: neverdin.lat, lon: neverdin.lon }], scrambledWorld, { name: "Moved" });
  assert.ok(scrambled.checkpoints.every((checkpoint) => !checkpoint.island), "islands move in Scrambled Seas, so only marks");
  assert.throws(() => courseFromRoute([grc, neverdin], null, { name: "X" }), /needs a recording from that world/);
  assert.throws(() => courseFromRoute([grc, grc], { kind: "vanilla" }, { name: "X" }), /at least two stops/);

  // A run exported from a chart is timed the way the board will time it, and mod rules apply.
  const chart = createChart();
  chart.recording = { game: "g", world: { kind: "vanilla" }, plugins: [{ guid: "com.example.blocked", name: "Blocked", version: "1" }] };
  chart.track = readVoyageRecorder(log(
    { type: "session", day: 3, hour: 9, game: "g" },
    { type: "position", day: 3, hour: 9, lat: grc.lat, lon: grc.lon, utc: 1000 },
    { type: "position", day: 3, hour: 10, lat: 31.5, lon: -4, utc: 1100 },
    { type: "position", day: 3, hour: 12, lat: neverdin.lat, lon: neverdin.lon, utc: 1300 }
  )).points;
  const file = buildVoyageFile(chart, { from: 0, to: 2 });
  const dash = { ...oneWay, start: oneWay.start };
  const result = checkRaceLocally(dash, file);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.gameHours, 2);
  assert.match(checkRaceLocally({ ...dash, rules: { mods: { mode: "block", plugins: ["com.example.blocked"] } } }, file).reason, /doesn't allow com\.example\.blocked/);
  assert.match(checkRaceLocally(dash, buildVoyageFile(chart, { from: 0, to: 1 })).reason, /doesn't reach Neverdin/);

  assert.deepEqual(heatmapSquares({ cellDegrees: 0.2, max: 4, cells: { "150,-10": 2 } }), [{ lat: 30, lon: -2, size: 0.2, share: 0.5 }]);
  // A run downloaded from a board opens for comparing like any voyage file.
  assert.equal(parseVoyageFile({ course: "dash", voyage: file }).points.length, 3);
});

test("exports skip earlier games and lone marks, keep session breaks, and links stay on the site", async () => {
  const { isSiteLink } = await import("../src/site.mjs");
  const chart = createChart();
  chart.recording = { game: "g2", world: { kind: "vanilla" } };
  chart.track = readVoyageRecorder(log(
    { type: "session", day: 1, hour: 9, game: "g1" },
    { type: "position", day: 1, hour: 9, lat: 30, lon: 0 },
    { type: "position", day: 1, hour: 10, lat: 30, lon: 0.1 },
    { type: "session", day: 3, hour: 9, game: "g2" },
    { type: "position", day: 3, hour: 9, lat: 31, lon: 0, event: "mark" },
    { type: "position", day: 3, hour: 10, lat: 31, lon: 0.1 },
    { type: "session", day: 3, hour: 12, game: "g2" },
    { type: "position", day: 3, hour: 12, lat: 31, lon: 0.3 }
  )).points;
  const points = exportablePoints(chart);
  assert.deepEqual(points.map((point) => point.day), ["3", "3", "3"], "only the latest game, whose world and mods the chart knows");
  assert.throws(() => buildVoyageFile(chart, { from: 0, to: 1 }), /at least two positions/, "a mark left out can leave too few");
  const file = buildVoyageFile(chart, { from: 0, to: 2 });
  assert.deepEqual(file.points.map((point) => point.newSession ?? false), [false, true], "a later load keeps its break");
  assert.equal(parseVoyageFile(file).points[1].newSession, true);
  chart.track = readVoyageRecorder(log(
    { type: "session", day: 3, hour: 9, game: "g2" },
    { type: "position", day: 3, hour: 9, lat: 31, lon: 0 },
    { type: "position", day: 3, hour: 10, lat: 31, lon: 0.1 },
    { type: "session", day: 3, hour: 12, game: "g2" },
    { type: "position", day: 3, hour: 12, lat: 31, lon: 0.3, event: "mark" },
    { type: "position", day: 3, hour: 13, lat: 31, lon: 0.4 }
  )).points;
  assert.deepEqual(buildVoyageFile(chart, { from: 0, to: 3 }).points.map((point) => point.newSession ?? false), [false, false, true], "a break on a left-out mark moves to the next position");

  const across = [{ t: 0, lat: 0, lon: 179 }, { t: 2, lat: 0, lon: -179 }];
  assert.equal(positionAtElapsed(across, 0, 1).lon, -180, "the marker crosses the east and west edge the short way");

  assert.equal(isSiteLink("https://github.com/Skeptic043/sailwind-chartroom-voyages/issues/new?template=share-voyage.yml"), true);
  assert.equal(isSiteLink("https://skeptic043.github.io/sailwind-chartroom-voyages/#world/vanilla"), true);
  assert.equal(isSiteLink("https://github.com/Skeptic043/sailwind-chartroom-voyages/actions"), false);
  assert.equal(isSiteLink("javascript:alert(1)"), false);
});

test("an undo from Voyage Recorder takes back its mark, in the same text or one read earlier", () => {
  const first = readVoyageRecorder(log(
    { type: "session", day: 3, hour: 9, game: "g" },
    { type: "position", day: 3, hour: 9, lat: 30, lon: 0 },
    { type: "position", id: "m1", day: 3, hour: 9.5, lat: 30, lon: 0.1, event: "race-start" },
    { type: "position", id: "m2", day: 3, hour: 9.6, lat: 30, lon: 0.12, event: "race-start" },
    { type: "undo", id: "m2" }
  ));
  assert.deepEqual(first.points.map((point) => point.markId ?? ""), ["", "m1"], "an undo in the same text drops its mark");
  assert.deepEqual(first.undone, []);
  const later = readVoyageRecorder(log({ type: "undo", id: "m1" }));
  assert.deepEqual(later.undone, ["m1"], "an undo for a mark read earlier is passed on for the chart to remove");
  const chart = sanitizeChart({ ...createChart(), track: first.points });
  assert.equal(chart.track[1].markId, "m1", "the mark keeps its id on the chart");
});

// Chart notes, location icons, Voyage Recorder 0.2.0 lines, equipment readings, chart folders and voyage files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ICON_SIZES, iconScale, createChart, createFeature, createNote, createWorkspace, importChartData, itemShown, newRecorderNotes, newVisits, readVoyageRecorder, removeChartItems, sanitizeChart, sanitizeWorkspace, SCHEMA_VERSION } from "../src/model.mjs";
import { instrumentsAt, localHours, readingKnowledge, sanitizeEquipment, setInstruments } from "../src/equipment.mjs";
import { chartGroups, createFolder, deleteFolder, moveChartToFolder, shiftChart, shiftFolder } from "../src/folders.mjs";
import { buildVoyageFile, defaultShare, exportablePoints, hashGameId, parseVoyageFile, positionAtElapsed, sameWorld } from "../src/voyages.mjs";

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const log = (...records) => records.map((record) => JSON.stringify(record)).join("\n");

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

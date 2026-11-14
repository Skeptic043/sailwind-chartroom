import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createChart, createDrPosition, importChartData, sanitizeWorkspace, windFromMathAngle } from "../src/model.mjs";
import { formatGameTime, parseClock, parseDayTime } from "../src/gametime.mjs";
import { sailedStats, simplifyTrack, trackSegments, trackToRoutePoints } from "../src/track.mjs";
import { deadReckon, drSigma, latestPosition } from "../src/dead-reckoning.mjs";

const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? "value"}: ${actual} is not within ${tolerance} of ${expected}`);
const point = (lat, lon, t, extra = {}) => ({ id: `p${lat}:${lon}:${t}`, lat, lon, t, ...extra });
const drPosition = (lat, lon, t, extra = {}) => createDrPosition({ lat, lon, t, from: { lat, lon: lon - 0.1, label: "Start" }, course: 90, speedKn: 6, hours: 2, percent: 10, ...extra });

test("game time reads days and clock times and keeps their order across midnight", () => {
  assert.equal(parseDayTime("12", "06:30"), 12 * 24 + 6.5);
  near(parseDayTime("Day 2", "23:59:30"), 2 * 24 + 23 + 59.5 / 60, 1e-12);
  assert.equal(parseDayTime("", "06:30"), null);
  assert.ok(Number.isNaN(parseClock("25:00")));
  assert.equal(formatGameTime(3 * 24 + 14.25), "day 3 14:15");
});

test("Coordinate Viewer's mathematical wind angle becomes the bearing the wind blows toward", () => {
  assert.equal(windFromMathAngle(0), 90);
  assert.equal(windFromMathAngle(90), 0);
  assert.equal(windFromMathAngle(180), 270);
  assert.equal(windFromMathAngle(-45), 135);
});

test("charts saved before version 3 get game times and corrected wind labels once", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/chartroom-0.7.1-chart.json", import.meta.url), "utf8"));
  const [chart] = importChartData(fixture);
  const [first, second] = chart.track;
  // 0.7.1 labelled an angle of 90 (a wind blowing north) as "E".
  assert.deepEqual([first.wind, first.windDeg, first.t], ["N", 0, 4 * 24 + 9.5]);
  assert.deepEqual([second.wind, second.windDeg, second.t], ["E", 90, null]);
  assert.deepEqual(chart.drPositions, []);
  // Saved again as version 3, the labels are not corrected a second time.
  const again = sanitizeWorkspace({ version: 3, charts: [chart] }).charts[0];
  assert.deepEqual([again.track[0].wind, again.track[0].windDeg], ["N", 0]);
});

test("the track breaks where the record jumps, but not across the chart's edge", () => {
  const sailing = [point(30, -5, 100), point(30.01, -4.99, 100.25), point(30.02, -4.98, 100.5)];
  const reloaded = point(30.5, -4, 99);
  const teleported = point(35, 10, 99.25);
  const nextDay = point(35.01, 10.01, 130);
  assert.deepEqual(trackSegments([...sailing, reloaded, teleported, nextDay]).map((segment) => segment.length), [3, 1, 1, 1]);
  const roundTheWorld = [point(10, 179.98, 5), point(10, -179.99, 5.25), point(10, -179.96, 5.5)];
  assert.equal(trackSegments(roundTheWorld).length, 1);
});

test("dead reckoning runs the course, wraps across the chart's edge, and grows less certain with the distance sailed", () => {
  const end = deadReckon({ lat: 30, lon: -5 }, 90, 6, 2);
  near(end.lat, 30, 1e-12);
  near(end.lon, -5 + 12 / 140, 1e-12);
  assert.equal(end.nm, 12);
  near(deadReckon({ lat: 0, lon: 179.99 }, 90, 7, 1).lon, -179.96, 1e-9);
  assert.equal(drSigma(1, 10, 12), 1 + 1.2);
});

test("selected positions give distance and speed, skipping breaks, and simplify into a route", () => {
  const points = [point(30, -5, 23.5), point(30, -4.95, 24.5), point(30, -4.9, 25.5), point(31, 0, 20), point(31, 0.01, 20.5)];
  const stats = sailedStats(points);
  near(stats.distanceNm, 0.05 * 140 * 2 + 0.01 * 140, 1e-9);
  near(stats.movingHours, 2.5, 1e-12);
  near(stats.averageKn, stats.distanceNm / 2.5, 1e-9);
  const zigzag = [point(0, 0, 1), point(0.001, 0.1, 4), point(0, 0.2, 7), point(0.5, 0.25, 12), point(1, 0.3, 17)];
  assert.deepEqual(simplifyTrack(zigzag, 1).map((item) => item.lat), [0, 0, 1]);
  assert.deepEqual(trackToRoutePoints(zigzag, 1).map((item) => [item.lat, item.lon]), [[0, 0], [0, 0.2], [1, 0.3]]);
});

test("the latest position is the newest by game time, recorded or reckoned", () => {
  const chart = createChart();
  chart.track = [point(30, -5, 10)];
  chart.drPositions = [drPosition(31, -5, 12)];
  assert.equal(latestPosition(chart).ref.kind, "dr");
  chart.track.push(point(30.1, -5, 13));
  assert.equal(latestPosition(chart).ref.kind, "track");
  // Without times, the DR position wins unless Coordinate Viewer is being followed live.
  chart.track = [point(30, -5, null)];
  chart.drPositions = [drPosition(31, -5, null)];
  assert.equal(latestPosition(chart).ref.kind, "dr");
  assert.equal(latestPosition(chart, { followingLive: true }).ref.kind, "track");
  // A DR position plotted later from a clicked point has no time, and still carries on from the last.
  chart.drPositions = [drPosition(31, -5, 30), drPosition(32, -5, null)];
  assert.equal(latestPosition(chart).lat, 32);
});

test("DR positions survive saving and loading", () => {
  const chart = createChart();
  chart.drPositions.push(drPosition(30, -5, 50, { sigmaNm: 2, label: "Noon" }));
  const [restored] = sanitizeWorkspace({ version: 3, charts: [JSON.parse(JSON.stringify(chart))] }).charts[0].drPositions;
  assert.deepEqual(restored, chart.drPositions[0]);
});

test("a chart saved by the 0.8.0 test build keeps its DR positions and drops the removed tools' data", () => {
  // A test-build chart has no drPositions list of its own.
  const { drPositions, ...fresh } = createChart();
  const chart = {
    ...fresh,
    fixes: [
      { id: "f1", kind: "dr", lat: 30.1, lon: -5, t: 12, sigmaNm: 1.2, inputs: { course: 90, speedKn: 6, hours: 2, percent: 10, fromLat: 30.1, fromLon: -5.0857, from: "Start" }, passageId: "passage-1" },
      { id: "f2", kind: "sight", lat: 30, lon: -5 }
    ],
    lops: [{ id: "l1", kind: "latitude", lat: 30 }],
    sky: "rs-kingcam",
    passage: { routeId: "r1", id: "passage-1", index: 1 },
    voyages: [{ id: "voyage-1" }],
    track: [{ id: "p1", lat: 30, lon: -5, t: 10, voyageId: "voyage-1", passageId: "passage-1" }],
    savedRoutes: [{ id: "r1", name: "Out", points: [{ id: "a", lat: 0, lon: 0 }], passages: [{ id: "passage-1" }] }]
  };
  const restored = sanitizeWorkspace({ version: 3, charts: [chart] }).charts[0];
  assert.deepEqual(restored.drPositions.map((position) => [position.id, position.course, position.from]), [["f1", 90, { lat: 30.1, lon: -5.0857, label: "Start" }]]);
  for (const key of ["fixes", "lops", "sky", "passage", "voyages"]) assert.equal(key in restored, false, key);
  assert.deepEqual(Object.keys(restored.track[0]).filter((key) => key.endsWith("Id")), []);
  assert.equal("passages" in restored.savedRoutes[0], false);
});

test("the Dead reckoning shortcut never takes a key the player already uses", () => {
  const old = { select: "v", location: "d", route: "r", measure: "m", area: "a", search: "s", wind: "w" };
  const { shortcuts } = sanitizeWorkspace({ charts: [createChart()], settings: { shortcuts: old } }).settings;
  assert.equal(shortcuts.location, "d");
  assert.notEqual(shortcuts.dr, "d");
  assert.equal(sanitizeWorkspace({ charts: [createChart()], settings: { shortcuts: { ...old, location: "l" } } }).settings.shortcuts.dr, "d");
});

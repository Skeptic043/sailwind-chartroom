// Phone companion sync: a device's changes reach the desktop, the desktop's reach every device, and only
// the same item changed on both sides asks the player.
import test from "node:test";
import assert from "node:assert/strict";
import { createChart, createFeature, createNote, createSearch, createWorkspace, followAnchors, newRecorderNotes, sanitizeChart } from "../src/model.mjs";
import { CHART_FIELDS, ITEM_LISTS, LOCAL_CHART_KEYS, SET_LISTS, applyOps, createShadow, diffWorkspace, receiveOps, resolveConflict, stableJson } from "../src/sync.mjs";

// A desktop and a device that start from the same charts, each with its own shadow.
function pair(setup = () => {}) {
  const workspace = createWorkspace();
  setup(workspace.charts[0], workspace);
  const desktop = { workspace, shadow: createShadow(workspace) };
  const copy = structuredClone(workspace);
  return { desktop, device: { workspace: copy, shadow: createShadow(copy) } };
}

// The device sends its changes; the desktop applies what it can and sends out everything it changed.
function exchange({ desktop, device }) {
  const sent = diffWorkspace(device.shadow, device.workspace);
  const { conflicts } = applyOps(desktop.workspace, sent, { check: true });
  const broadcast = diffWorkspace(desktop.shadow, desktop.workspace);
  receive(device, broadcast);
  return { sent, conflicts, broadcast };
}

// Returns the device's own changes that hadn't been sent yet.
function receive(device, ops) {
  return receiveOps(device.shadow, device.workspace, ops);
}

// What both sides must agree on: everything but each device's own view and the save times.
function synced(workspace) {
  return stableJson({
    folders: workspace.folders,
    recorderKeys: workspace.settings.recorderKeys,
    charts: workspace.charts.map((chart) => Object.fromEntries(Object.entries(chart).filter(([key]) => !LOCAL_CHART_KEYS.includes(key) || key === "id")))
  });
}

function assertInStep({ desktop, device }) {
  assert.equal(synced(device.workspace), synced(desktop.workspace));
  assert.deepEqual(diffWorkspace(device.shadow, device.workspace), [], "the device has nothing left to send");
  assert.deepEqual(diffWorkspace(desktop.shadow, desktop.workspace), [], "the desktop has nothing left to send");
}

const trackPoints = (count, start = 0) => sanitizeChart({ gameMiles: true, track: Array.from({ length: count }, (_, index) => ({
  id: `track-${start + index}`, lat: 30 + (start + index) / 1000, lon: 1, day: "1", time: "08:00"
})) }).track;

test("every part of a chart is either synced or deliberately kept on each device", () => {
  const chart = { ...createChart(), folderId: "folder", scramble: {} };
  const known = new Set([...ITEM_LISTS, ...Object.keys(SET_LISTS), ...CHART_FIELDS, ...LOCAL_CHART_KEYS]);
  assert.deepEqual(Object.keys(chart).filter((key) => !known.has(key)), []);
});

test("a location added on the phone reaches the desktop in the same place in its list", () => {
  const sides = pair((chart) => chart.features.push(createFeature({ lat: 30, lon: 1, name: "First" }), createFeature({ lat: 31, lon: 1, name: "Last" })));
  sides.device.workspace.charts[0].features.splice(1, 0, createFeature({ lat: 30.5, lon: 1, name: "Middle" }));
  const { conflicts } = exchange(sides);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(sides.desktop.workspace.charts[0].features.map((feature) => feature.name), ["First", "Middle", "Last"]);
  assertInStep(sides);
});

test("the desktop and the phone editing different items never ask", () => {
  const sides = pair((chart) => chart.features.push(createFeature({ lat: 30, lon: 1, name: "A" }), createFeature({ lat: 31, lon: 1, name: "B" })));
  sides.desktop.workspace.charts[0].features[0].name = "A from the desktop";
  sides.device.workspace.charts[0].features[1].name = "B from the phone";
  const { conflicts } = exchange(sides);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(sides.device.workspace.charts[0].features.map((feature) => feature.name), ["A from the desktop", "B from the phone"]);
  assertInStep(sides);
});

test("live positions arriving while the phone edits a note don't make a conflict, and reach the phone", () => {
  const sides = pair((chart) => {
    chart.track.push(...trackPoints(3));
    chart.notes.push(createNote({ lat: 30, lon: 1, text: "Fog" }));
  });
  const desktopChart = sides.desktop.workspace.charts[0];
  desktopChart.track.push(...trackPoints(2, 3));
  desktopChart.updatedAt = new Date(Date.now() + 5000).toISOString();
  sides.device.workspace.charts[0].notes[0].text = "Thick fog";
  sides.device.workspace.charts[0].updatedAt = new Date(Date.now() + 9000).toISOString();
  const { conflicts, sent, broadcast } = exchange(sides);
  assert.deepEqual(conflicts, []);
  assert.ok([...sent, ...broadcast].every((op) => op.op !== "field"), "save times are not sent either way");
  assert.equal(sides.device.workspace.charts[0].track.length, 5);
  assert.equal(desktopChart.notes[0].text, "Thick fog");
  assertInStep(sides);
});

test("changes made in place are still noticed", () => {
  const sides = pair((chart) => {
    chart.track.push(...trackPoints(2));
    const anchor = createFeature({ lat: 30, lon: 1, name: "Port" });
    chart.features.push(anchor);
    chart.searches.push(createSearch({ lat: 30, lon: 1, bearing: 90, distanceNm: 40, anchor: { kind: "feature", id: anchor.id } }));
  });
  const chart = sides.desktop.workspace.charts[0];
  chart.track[1].newSession = true;
  chart.features[0].lat = 32;
  followAnchors(chart);
  const ops = diffWorkspace(sides.desktop.shadow, sides.desktop.workspace);
  assert.deepEqual(ops.map((op) => op.list).sort(), ["features", "searches", "track"]);
  receive(sides.device, ops);
  assert.equal(sides.device.workspace.charts[0].searches[0].lat, 32, "the search keeps its anchor on the phone");
  assert.equal(sides.device.workspace.charts[0].searches[0].anchor.id, chart.features[0].id);
  assertInStep(sides);
});

test("positions filled in mid-track land where the desktop put them", () => {
  const sides = pair((chart) => chart.track.push(...trackPoints(2, 0), ...trackPoints(2, 10)));
  const chart = sides.desktop.workspace.charts[0];
  chart.track.splice(2, 0, ...trackPoints(3, 2));
  receive(sides.device, diffWorkspace(sides.desktop.shadow, sides.desktop.workspace));
  assert.deepEqual(sides.device.workspace.charts[0].track.map((point) => point.id), chart.track.map((point) => point.id));
  assertInStep(sides);
});

test("the same location changed on both sides asks on the phone, and each answer settles it", () => {
  for (const choice of ["mine", "theirs", "both"]) {
    const sides = pair((chart) => chart.features.push(createFeature({ lat: 30, lon: 1, name: "Rock" })));
    sides.desktop.workspace.charts[0].features[0].name = "Desktop rock";
    sides.device.workspace.charts[0].features[0].name = "Phone rock";
    const { conflicts } = exchange(sides);
    assert.equal(conflicts.length, 1, choice);
    assert.equal(conflicts[0].current.name, "Desktop rock");
    const { send, local } = resolveConflict(conflicts[0], choice);
    receive(sides.device, local);
    applyOps(sides.desktop.workspace, send, { check: true });
    receive(sides.device, diffWorkspace(sides.desktop.shadow, sides.desktop.workspace));
    const names = sides.desktop.workspace.charts[0].features.map((feature) => feature.name);
    assert.deepEqual(names, { mine: ["Phone rock"], theirs: ["Desktop rock"], both: ["Desktop rock", "Phone rock"] }[choice], choice);
    assertInStep(sides);
  }
});

test("an edit to something deleted on the other side asks whether to keep it", () => {
  for (const choice of ["mine", "theirs"]) {
    const sides = pair((chart) => chart.notes.push(createNote({ lat: 30, lon: 1, text: "Whales" })));
    sides.desktop.workspace.charts[0].notes = [];
    sides.device.workspace.charts[0].notes[0].text = "Many whales";
    const { conflicts } = exchange(sides);
    assert.equal(conflicts[0].current, null);
    const { send, local } = resolveConflict(conflicts[0], choice);
    receive(sides.device, local);
    applyOps(sides.desktop.workspace, send, { check: true });
    receive(sides.device, diffWorkspace(sides.desktop.shadow, sides.desktop.workspace));
    assert.deepEqual(sides.desktop.workspace.charts[0].notes.map((note) => note.text), choice === "mine" ? ["Many whales"] : [], choice);
    assertInStep(sides);
  }
});

test("deleting something the desktop has changed asks first", () => {
  const sides = pair((chart) => chart.features.push(createFeature({ lat: 30, lon: 1, name: "Reef" })));
  sides.desktop.workspace.charts[0].features[0].name = "Reef, careful";
  sides.device.workspace.charts[0].features = [];
  const { conflicts } = exchange(sides);
  assert.equal(conflicts[0].current.name, "Reef, careful");
  const { send } = resolveConflict(conflicts[0], "mine");
  applyOps(sides.desktop.workspace, send, { check: true });
  receive(sides.device, diffWorkspace(sides.desktop.shadow, sides.desktop.workspace));
  assert.deepEqual(sides.desktop.workspace.charts[0].features, []);
  assertInStep(sides);
});

test("visits and dismissed recorder notes merge, so a note deleted on the phone stays deleted", () => {
  const recorded = [{ recorderId: "n1", lat: 31, lon: -2, text: "Whales" }];
  const sides = pair((chart) => chart.notes.push(...newRecorderNotes(chart, recorded)));
  const phone = sides.device.workspace.charts[0];
  phone.dismissedNotes.push(phone.notes[0].recorderId);
  phone.notes = [];
  const desktop = sides.desktop.workspace.charts[0];
  desktop.visits.push({ kind: "arrive", port: "Gold Rock City", island: 1, t: 12.5 });
  exchange(sides);
  assert.deepEqual(newRecorderNotes(desktop, recorded), [], "following again doesn't bring it back");
  assert.equal(phone.visits.length, 1);
  assertInStep(sides);
});

test("changes from elsewhere reach every undo copy, each with its own copy", () => {
  const sides = pair((chart) => chart.features.push(createFeature({ lat: 30, lon: 1, name: "Old" })));
  const chart = sides.desktop.workspace.charts[0];
  const snapshot = structuredClone(chart);
  const added = createFeature({ lat: 31, lon: 1, name: "New" });
  const ops = [
    { op: "put", chartId: chart.id, list: "features", item: added, base: null, after: chart.features[0].id },
    { op: "remove", chartId: chart.id, list: "features", id: chart.features[0].id, base: chart.features[0] }
  ];
  applyOps(sides.desktop.workspace, ops, { check: true, targets: (target) => [target, snapshot] });
  assert.deepEqual(snapshot.features.map((feature) => feature.name), ["New"], "undo neither removes the new one nor restores the old");
  chart.features[0].name = "Renamed";
  assert.equal(snapshot.features[0].name, "New");
});

test("a phone's own edit coming back from the desktop leaves its undo copy alone", () => {
  const sides = pair((chart) => chart.features.push(createFeature({ lat: 30, lon: 1, name: "Rock" })));
  const phone = sides.device.workspace.charts[0];
  const snapshot = structuredClone(phone);
  phone.features[0].name = "Rock, phone";
  exchange(sides);
  receiveOps(sides.device.shadow, sides.device.workspace, diffWorkspace(sides.desktop.shadow, sides.desktop.workspace), { targets: (chart) => [chart, snapshot] });
  assert.equal(snapshot.features[0].name, "Rock", "undo can still take the edit back");
});

test("charts added, deleted, reordered and filed sync, while each side keeps its open chart and view", () => {
  const sides = pair((chart, workspace) => {
    workspace.charts.push(createChart({ name: "Second" }));
    workspace.folders = [{ id: "folder-1", name: "Old worlds" }];
  });
  const phone = sides.device.workspace;
  phone.charts.push(createChart({ name: "Third" }));
  phone.charts.reverse();
  phone.charts.find((chart) => chart.name === "Second").folderId = "folder-1";
  phone.activeChartId = phone.charts[0].id;
  phone.charts[0].view.zoom = 40;
  const desktop = sides.desktop.workspace;
  const opened = desktop.activeChartId;
  exchange(sides);
  assert.deepEqual(desktop.charts.map((chart) => chart.name), ["Third", "Second", "My Scrambled Sea"]);
  assert.equal(desktop.charts[1].folderId, "folder-1");
  assert.equal(desktop.activeChartId, opened);
  desktop.charts = desktop.charts.filter((chart) => chart.name !== "Second");
  desktop.folders = [];
  receive(sides.device, diffWorkspace(sides.desktop.shadow, desktop));
  assert.deepEqual(phone.charts.map((chart) => chart.name), ["Third", "My Scrambled Sea"]);
  assert.equal(phone.charts[0].view.zoom, 40, "the phone keeps its view");
  assertInStep(sides);
});

test("removing an imported world's island syncs the whole world field", () => {
  const sides = pair((chart) => { chart.scramble = sanitizeChart({ gameMiles: true, scramble: { islands: [{ id: "aestrin/aestra_abbey", lat: 30, lon: 1 }, { id: "aestrin/eastwind", lat: 31, lon: 2 }] } }).scramble; });
  const before = sides.desktop.workspace.charts[0].scramble;
  sides.device.workspace.charts[0].scramble.islands.pop();
  const { conflicts, sent } = exchange(sides);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(sent.map((op) => op.key), ["scramble"]);
  assert.notDeepEqual(sides.desktop.workspace.charts[0].scramble, before);
  assertInStep(sides);
});

test("a phone that was offline sends what it changed when it reconnects", () => {
  const sides = pair((chart) => chart.features.push(createFeature({ lat: 30, lon: 1, name: "A" }), createFeature({ lat: 31, lon: 1, name: "B" })));
  sides.device.workspace.charts[0].features[1].name = "B offline";
  sides.device.workspace.charts[0].notes.push(createNote({ lat: 31, lon: 2, text: "Written offline" }));
  sides.desktop.workspace.charts[0].features[0].name = "A meanwhile";
  diffWorkspace(sides.desktop.shadow, sides.desktop.workspace);
  // Reconnecting: the phone works out its changes, then starts again from the desktop's charts.
  const pending = diffWorkspace(sides.device.shadow, sides.device.workspace);
  sides.device.workspace = structuredClone(sides.desktop.workspace);
  sides.device.shadow = createShadow(sides.device.workspace);
  const { conflicts } = applyOps(sides.desktop.workspace, pending, { check: true });
  assert.deepEqual(conflicts, []);
  receive(sides.device, diffWorkspace(sides.desktop.shadow, sides.desktop.workspace));
  const chart = sides.device.workspace.charts[0];
  assert.deepEqual(chart.features.map((feature) => feature.name), ["A meanwhile", "B offline"]);
  assert.deepEqual(chart.notes.map((note) => note.text), ["Written offline"]);
  assertInStep(sides);
});

test("Voyage Recorder's keys reach the phone's key overlay", () => {
  const sides = pair();
  sides.desktop.workspace.settings.recorderKeys = { record: "F9", location: "F10" };
  receive(sides.device, diffWorkspace(sides.desktop.shadow, sides.desktop.workspace));
  assert.deepEqual(sides.device.workspace.settings.recorderKeys, sides.desktop.workspace.settings.recorderKeys);
  assertInStep(sides);
});

test("a long voyage's track only sends what changed", () => {
  const sides = pair((chart) => chart.track.push(...trackPoints(50000)));
  sides.desktop.workspace.charts[0].track.push(...trackPoints(1, 50000));
  const ops = diffWorkspace(sides.desktop.shadow, sides.desktop.workspace);
  assert.deepEqual(ops.map((op) => [op.op, op.item.id]), [["put", "track-50000"]]);
});

test("taking the desktop's changes never hides a change the phone hadn't sent yet", () => {
  const sides = pair((chart, workspace) => {
    chart.features.push(createFeature({ lat: 30, lon: 1, name: "Rock" }));
    chart.notes.push(createNote({ lat: 31, lon: 1, text: "Fog" }));
    workspace.charts.push(createChart({ name: "Second" }));
  });
  const phone = sides.device.workspace;
  phone.charts.reverse();
  phone.charts[1].features[0].name = "Rock, phone";
  phone.charts[1].dismissedNotes.push("n9");
  sides.desktop.workspace.charts[0].notes[0].text = "Fog, desktop";
  const pending = receive(sides.device, diffWorkspace(sides.desktop.shadow, sides.desktop.workspace));
  assert.deepEqual(pending.map((op) => op.op).sort(), ["add", "order", "put"]);
  assert.deepEqual(applyOps(sides.desktop.workspace, pending, { check: true }).conflicts, []);
  receive(sides.device, diffWorkspace(sides.desktop.shadow, sides.desktop.workspace));
  assert.equal(sides.desktop.workspace.charts[1].features[0].name, "Rock, phone");
  assert.deepEqual(sides.desktop.workspace.charts[1].dismissedNotes, ["n9"]);
  assertInStep(sides);
});

test("a chart moved into a folder the desktop just deleted stays in view", () => {
  const sides = pair((chart, workspace) => { workspace.folders = [{ id: "folder-1", name: "Old worlds" }]; });
  sides.device.workspace.charts[0].folderId = "folder-1";
  sides.desktop.workspace.folders = [];
  const pending = receive(sides.device, diffWorkspace(sides.desktop.shadow, sides.desktop.workspace));
  applyOps(sides.desktop.workspace, pending, { check: true });
  assert.equal(sides.desktop.workspace.charts[0].folderId, undefined);
  exchange(sides);
  assertInStep(sides);
});

test("an operation that makes no sense is skipped and the rest still apply", () => {
  const sides = pair();
  const chart = sides.desktop.workspace.charts[0];
  const feature = createFeature({ lat: 30, lon: 1, name: "Kept" });
  const ops = [null, { op: "order", chartIds: "x" }, { op: "put", chartId: chart.id, list: "__proto__", item: feature, base: null },
    { op: "put", chartId: chart.id, list: "features", item: feature, base: null, after: null }];
  assert.deepEqual(applyOps(sides.desktop.workspace, ops, { check: true }).conflicts, []);
  assert.deepEqual(chart.features.map((entry) => entry.name), ["Kept"]);
});

test("a chart moved to the top level on the PC while the phone filed it settles on the PC's choice", () => {
  const sides = pair((chart, workspace) => { workspace.folders = [{ id: "folder-1", name: "Old" }]; chart.folderId = "folder-1"; });
  delete sides.desktop.workspace.charts[0].folderId;
  sides.device.workspace.folders.push({ id: "folder-2", name: "New" });
  diffWorkspace(sides.device.shadow, sides.device.workspace);
  sides.device.workspace.charts[0].folderId = "folder-2";
  const sent = diffWorkspace(sides.device.shadow, sides.device.workspace);
  const { conflicts } = applyOps(sides.desktop.workspace, sent, { check: true });
  assert.equal(conflicts[0].current, null);
  const { send, local } = resolveConflict(conflicts[0], "theirs");
  assert.deepEqual(send, []);
  receive(sides.device, local);
  assert.equal(sides.device.workspace.charts[0].folderId, undefined);
});

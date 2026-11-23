// Keeps charts in step between the desktop and the phones and tablets connected to it over the player's network.
// The desktop page is the hub: a device sends it the changes the player made, the desktop applies each one
// unless that same item has changed there since the device last saw it, and every change the desktop makes,
// its own or a device's, goes out to all devices. Nothing here touches the page, so the desktop, a device and
// a later offline app share it.
//
// A shadow is what was last sent or received, one JSON string per item. diffWorkspace compares a workspace with
// it and returns the changes as operations; comparing strings means an item changed in place is still noticed.
import { makeId, sanitizeChart, sanitizeRecorderKeys, visitKey } from "./model.mjs";
import { sanitizeFolders, settleChartFolders } from "./folders.mjs";

// Lists whose items have ids. Each item syncs on its own, so edits to different items never conflict.
export const ITEM_LISTS = Object.freeze(["features", "savedRoutes", "track", "measures", "winds", "searches", "segments", "drPositions", "notes", "comparisons"]);
// Lists without ids that only grow, so they merge by adding what's missing.
export const SET_LISTS = Object.freeze({ visits: visitKey, dismissedNotes: (id) => id });
// Values that sync whole. The active route is one because its order is its meaning.
export const CHART_FIELDS = Object.freeze(["name", "seed", "folderId", "circumnavigation", "speedKn", "measureSpeedKn", "clockPercent", "drPercent", "route", "recording", "equipment", "compareStartId", "scramble"]);
// Never sent: each device keeps its own view and layers, and whoever saves sets the times. gameMiles is
// always true once a chart has loaded.
export const LOCAL_CHART_KEYS = Object.freeze(["id", "createdAt", "updatedAt", "view", "layers", "gameMiles"]);

// Equal values give equal text whatever order their keys were written in, so bases compare fairly.
// A missing value and null are the same.
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const same = (a, b) => stableJson(a) === stableJson(b);
const text = (value) => JSON.stringify(value ?? null);
const parse = (value) => value === undefined ? null : JSON.parse(value);

function chartShadow(chart) {
  return {
    items: Object.fromEntries(ITEM_LISTS.map((list) => [list, new Map(chart[list].map((item) => [item.id, text(item)]))])),
    sets: Object.fromEntries(Object.entries(SET_LISTS).map(([list, key]) => [list, new Set(chart[list].map(key))])),
    fields: Object.fromEntries(CHART_FIELDS.map((key) => [key, text(chart[key])]))
  };
}

export function createShadow(workspace) {
  return {
    charts: new Map(workspace.charts.map((chart) => [chart.id, chartShadow(chart)])),
    order: text(workspace.charts.map((chart) => chart.id)),
    folders: text(workspace.folders),
    recorderKeys: text(workspace.settings.recorderKeys)
  };
}

// The changes since the shadow, as operations, and the shadow brought up to date with them.
export function diffWorkspace(shadow, workspace) {
  const ops = [];
  const present = new Set();
  for (const chart of workspace.charts) {
    present.add(chart.id);
    const known = shadow.charts.get(chart.id);
    if (known) diffChart(known, chart, ops);
    else {
      ops.push({ op: "chart-add", chart: JSON.parse(text(chart)) });
      shadow.charts.set(chart.id, chartShadow(chart));
    }
  }
  for (const chartId of [...shadow.charts.keys()]) {
    if (present.has(chartId)) continue;
    ops.push({ op: "chart-remove", chartId });
    shadow.charts.delete(chartId);
  }
  const order = text(workspace.charts.map((chart) => chart.id));
  if (order !== shadow.order) ops.push({ op: "order", chartIds: JSON.parse(order) });
  const folders = text(workspace.folders);
  if (folders !== shadow.folders) ops.push({ op: "folders", folders: JSON.parse(folders), base: parse(shadow.folders) });
  const recorderKeys = text(workspace.settings.recorderKeys);
  if (recorderKeys !== shadow.recorderKeys) ops.push({ op: "recorder-keys", value: JSON.parse(recorderKeys) });
  Object.assign(shadow, { order, folders, recorderKeys });
  return ops;
}

function diffChart(known, chart, ops) {
  const chartId = chart.id;
  for (const list of ITEM_LISTS) {
    const before = known.items[list];
    const after = new Map();
    chart[list].forEach((item, index) => {
      const now = text(item);
      after.set(item.id, now);
      const was = before.get(item.id);
      if (was === undefined) ops.push({ op: "put", chartId, list, item: JSON.parse(now), base: null, after: chart[list][index - 1]?.id ?? null });
      else if (was !== now) ops.push({ op: "put", chartId, list, item: JSON.parse(now), base: JSON.parse(was) });
    });
    for (const [id, was] of before) if (!after.has(id)) ops.push({ op: "remove", chartId, list, id, base: JSON.parse(was) });
    known.items[list] = after;
  }
  for (const [list, key] of Object.entries(SET_LISTS)) {
    const added = chart[list].filter((value) => !known.sets[list].has(key(value)));
    if (!added.length) continue;
    ops.push({ op: "add", chartId, list, values: JSON.parse(text(added)) });
    for (const value of added) known.sets[list].add(key(value));
  }
  for (const key of CHART_FIELDS) {
    const now = text(chart[key]);
    if (now === known.fields[key]) continue;
    ops.push({ op: "field", chartId, key, value: JSON.parse(now), base: parse(known.fields[key]) });
    known.fields[key] = now;
  }
}

// An item or value as a loaded chart would hold it. The chart's locations and routes go along so a search
// keeps the item it is anchored to.
function sanitizedPart(chart, key, value) {
  const { features, route, savedRoutes, layers, clockPercent } = chart;
  return sanitizeChart({ features, route, savedRoutes, layers, clockPercent, gameMiles: true, [key]: value })[key];
}

/**
 * Applies operations to the workspace. With check, as on the desktop, an operation whose item has changed
 * since the sender saw it is not applied but returned as a conflict with the item as it is now (null when
 * it was deleted). Without check, as on a device taking the desktop's changes, every operation applies.
 * targets(chart) lists the copies to change, such as a chart and its undo snapshots, so undo neither
 * reverts nor brings back a change from elsewhere; each copy gets its own copy of the item.
 */
export function applyOps(workspace, ops, { check = false, targets = (chart) => [chart] } = {}) {
  const conflicts = [];
  for (const op of ops) {
    // Operations arrive from other devices, so one that makes no sense is skipped rather than stopping the rest.
    if (!op || typeof op !== "object") continue;
    if (op.op === "chart-add") {
      const chart = sanitizeChart(op.chart);
      if (chart && !workspace.charts.some((entry) => entry.id === chart.id)) workspace.charts.push(chart);
    } else if (op.op === "chart-remove") {
      workspace.charts = workspace.charts.filter((chart) => chart.id !== op.chartId);
      if (!workspace.charts.some((chart) => chart.id === workspace.activeChartId)) workspace.activeChartId = workspace.charts[0]?.id ?? "";
    } else if (op.op === "order" && Array.isArray(op.chartIds)) {
      const rank = new Map(op.chartIds.map((id, index) => [id, index]));
      workspace.charts.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
    } else if (op.op === "folders") {
      if (check && !same(workspace.folders, op.base) && !same(workspace.folders, op.folders)) conflicts.push({ op, current: workspace.folders });
      else workspace.folders = sanitizeFolders(op.folders);
    } else if (op.op === "recorder-keys") {
      workspace.settings.recorderKeys = sanitizeRecorderKeys(op.value);
    } else {
      const chart = workspace.charts.find((entry) => entry.id === op.chartId);
      // A change to a chart that has been deleted has nowhere to go.
      if (chart) applyChartOp(chart, op, check, targets, conflicts);
    }
  }
  // A chart filed in a folder deleted elsewhere goes back to the top level, which the broadcast then carries.
  settleChartFolders(workspace);
  return { conflicts };
}

// A change the chart already has, such as a device's own edit coming back from the desktop, is left alone,
// so it never reaches the undo copies and undo still takes it back.
function applyChartOp(chart, op, check, targets, conflicts) {
  if (op.op === "add" && Object.hasOwn(SET_LISTS, op.list)) {
    const key = SET_LISTS[op.list];
    const present = new Set(chart[op.list].map(key));
    const values = sanitizedPart(chart, op.list, op.values).filter((value) => !present.has(key(value)));
    for (const target of targets(chart)) {
      const known = new Set(target[op.list].map(key));
      for (const value of values) if (!known.has(key(value)) && known.add(key(value))) target[op.list].push(structuredClone(value));
    }
  } else if (op.op === "field" && CHART_FIELDS.includes(op.key)) {
    if (check && !same(chart[op.key], op.base) && !same(chart[op.key], op.value)) return conflicts.push({ op, current: chart[op.key] ?? null });
    const value = sanitizedPart(chart, op.key, op.value);
    if (same(chart[op.key], value)) return;
    for (const target of targets(chart)) {
      if (value === undefined) delete target[op.key];
      else target[op.key] = structuredClone(value);
    }
  } else if ((op.op === "put" || op.op === "remove") && ITEM_LISTS.includes(op.list)) {
    const id = op.op === "put" ? op.item?.id : op.id;
    const current = chart[op.list].find((item) => item.id === id) ?? null;
    const wanted = op.op === "put" ? op.item : null;
    if (check && !same(current, op.base) && !same(current, wanted)) return conflicts.push({ op, current });
    if (op.op === "remove") {
      if (!current) return;
      for (const target of targets(chart)) {
        const index = target[op.list].findIndex((item) => item.id === id);
        if (index >= 0) target[op.list].splice(index, 1);
      }
      return;
    }
    const item = sanitizedPart(chart, op.list, [op.item])[0];
    if (!item || same(current, item)) return;
    for (const target of targets(chart)) {
      const list = target[op.list];
      const copy = structuredClone(item);
      const index = list.findIndex((entry) => entry.id === id);
      if (index >= 0) list[index] = copy;
      else if (op.after === null) list.unshift(copy);
      else {
        // A new item goes where the sender has it: after the item before it there, or last without one.
        const before = list.findIndex((entry) => entry.id === op.after);
        list.splice(before < 0 ? list.length : before + 1, 0, copy);
      }
    }
  }
}

/**
 * How a device takes the desktop's changes. Its own changes not yet sent are worked out first, so taking the
 * desktop's can't hide them, and are returned for the device to send. The desktop's changes then apply
 * without check, and the shadow takes exactly what they touched, so the next diff doesn't send them back.
 */
export function receiveOps(shadow, workspace, ops, options) {
  const pending = diffWorkspace(shadow, workspace);
  applyOps(workspace, ops, options);
  advanceShadow(shadow, workspace, ops);
  return pending;
}

function advanceShadow(shadow, workspace, ops) {
  const charts = new Map(workspace.charts.map((chart) => [chart.id, chart]));
  for (const op of ops) {
    if (op.op === "chart-add") {
      const chart = charts.get(op.chart?.id);
      if (chart && !shadow.charts.has(chart.id)) shadow.charts.set(chart.id, chartShadow(chart));
    } else if (op.op === "chart-remove") shadow.charts.delete(op.chartId);
    else {
      const chart = charts.get(op.chartId);
      const known = shadow.charts.get(op.chartId);
      if (!chart || !known) continue;
      if (op.op === "put" || op.op === "remove") {
        const id = op.op === "put" ? op.item?.id : op.id;
        const item = chart[op.list]?.find((entry) => entry.id === id);
        if (item) known.items[op.list].set(id, text(item));
        else known.items[op.list]?.delete(id);
      } else if (op.op === "add") {
        for (const value of op.values) known.sets[op.list].add(SET_LISTS[op.list](value));
      } else if (op.op === "field" && CHART_FIELDS.includes(op.key)) known.fields[op.key] = text(chart[op.key]);
    }
  }
  const kinds = new Set(ops.map((op) => op.op));
  if (kinds.has("order") || kinds.has("chart-add") || kinds.has("chart-remove")) shadow.order = text(workspace.charts.map((chart) => chart.id));
  if (kinds.has("folders")) shadow.folders = text(workspace.folders);
  if (kinds.has("recorder-keys")) shadow.recorderKeys = text(workspace.settings.recorderKeys);
}

/**
 * The player's answer to a conflict: "mine" puts the device's version over the desktop's, "theirs" keeps
 * the desktop's, and "both" keeps the desktop's and adds the device's as a copy; "both" is only offered for
 * an item both sides changed, since a value or the folder list can't be kept twice. Returns what the device
 * sends and what it takes itself (with receiveOps) to show the desktop's version.
 */
export function resolveConflict({ op, current }, choice) {
  const restore = op.op === "field" ? { op: "field", chartId: op.chartId, key: op.key, value: current, base: null }
    : op.op === "folders" ? { op: "folders", folders: current, base: null }
      : current !== null ? { op: "put", chartId: op.chartId, list: op.list, item: current, base: null }
        : op.op === "put" ? { op: "remove", chartId: op.chartId, list: op.list, id: op.item.id } : null;
  if (choice === "mine") return { send: [{ ...op, base: current }], local: [] };
  if (choice === "both" && op.op === "put" && current !== null) {
    // A saved route's waypoints can be selected on their own, so the copy's need ids of their own too.
    const copy = { ...op.item, id: makeId(op.list) };
    if (op.list === "savedRoutes") copy.points = copy.points.map((point) => ({ ...point, id: makeId("route") }));
    return { send: [{ op: "put", chartId: op.chartId, list: op.list, item: copy, base: null, after: op.item.id }], local: [restore] };
  }
  return { send: [], local: restore ? [restore] : [] };
}

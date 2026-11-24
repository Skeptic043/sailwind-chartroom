// Exporting a voyage, and Chartroom Voyages: sharing a voyage, entering a race, publishing a route as a
// course, and browsing what others have shared. Submissions happen in the player's own browser on GitHub;
// Chartroom exports the file, checks a race entry the way the site will, and opens the right form.
import { formatDuration, savedRouteForPoint } from "./model.mjs";
import { SHARE_OPTIONS, VOYAGE_EXTENSION, buildVoyageFile, chosenPoints, defaultShare, exportablePoints, hashGameId } from "./voyages.mjs";
import { checkRaceLocally, courseFromRoute, findRaceRunRange, heatmapSquares, isWorldGeneratorLink, issueFormUrl, requiredShareOptions, siteData, siteUrl, worldFromXml, worldKey } from "./site.mjs";
import { addComparison } from "./compare.mjs";
import { islandById } from "./site-islands.mjs";
import { NM_PER_DEGREE } from "./site-race.mjs";
import { sailedStats, trackSegments, unwrapStretch } from "./track.mjs";
import { formatGameTime } from "./gametime.mjs";
import { formatNm } from "./format.mjs";
import { context, elements, keysBelongTo, showToast } from "./dom.mjs";
import { activeChart, host, persist, selection } from "./state.mjs";
import { worldToScreen } from "./viewport.mjs";

// What the export dialog is doing: "export" saves the file, "share" also opens the share form, and "race"
// checks the file against a course first.
let mode = "export";
// The range the export dialog highlights while it's open.
let exportRange = null;
// Courses on the site for the chart's world, while entering a race.
let courses = [];
// The full course object currently selected in Enter a race, plus a per-session cache.
let activeCourse = null;
const courseCache = new Map();
let courseLoadToken = 0;
// The heatmap Browse shared worlds/voyages shows on the chart: { key, squares } until it's turned off.
let heatmap = null;
// Worlds the site lists, while browsing.
let browseWorlds = [];
// Pending voyage exports awaiting "export-result" from a desktop host with exportWithLink.
const pendingExports = new Map();
let nextExportId = 1;
let exporting = false;

let redraw = () => {};
let renderAll = () => {};

export function initShare({ draw, renderAll: render }) {
  redraw = draw;
  renderAll = render;
  host.on("export-result", ({ id, saved, opened }) => {
    if (!id || !pendingExports.has(id)) return;
    const pending = pendingExports.get(id);
    pendingExports.delete(id);
    if (!saved) return;
    if (pending.expectsOpen && opened === false) {
      showToast("Route saved, but your browser couldn't be opened. Open Chartroom Voyages and drag the saved file into the form.", true);
      return;
    }
    showToast(pending.toast);
  });
  elements["export-voyage"].addEventListener("click", () => openExport("export"));
  elements["share-voyage"].addEventListener("click", () => openExport("share"));
  elements["enter-race"].addEventListener("click", () => openExport("race"));
  elements["publish-course"].addEventListener("click", openCourse);
  elements["publish-route-course"].addEventListener("click", openCourse);
  elements["browse-voyages"].addEventListener("click", openBrowse);
  elements["export-share"].replaceChildren(...SHARE_OPTIONS.map((option) => {
    const label = document.createElement("label");
    const box = Object.assign(document.createElement("input"), { type: "checkbox", value: option.id, checked: option.default });
    label.append(box, document.createTextNode(option.label));
    return label;
  }));
  for (const id of ["export-from", "export-to"]) elements[id].addEventListener("input", () => {
    const from = Number(elements["export-from"].value);
    const to = Number(elements["export-to"].value);
    // The two ends never cross: moving one past the other pushes it along.
    if (from > to) elements[id === "export-from" ? "export-to" : "export-from"].value = String(id === "export-from" ? from : to);
    updateExportRange();
  });
  elements["export-course"].addEventListener("change", () => {
    loadSelectedCourse();
  });
  elements["export-auto-find"].addEventListener("click", autoFindRaceRun);
  elements["export-world-choice"].addEventListener("change", updateWorldChoice);
  elements["export-world-source"].addEventListener("input", () => {
    elements["export-check"].hidden = true;
  });
  // Moving an end shows that position on the chart, so you can see exactly where the voyage starts and ends.
  for (const id of ["export-from", "export-to"]) elements[id].addEventListener("input", () => follow(id));
  for (const step of elements["export-voyage-form"].querySelectorAll("[data-step]")) {
    step.addEventListener("click", () => {
      const slider = elements[step.dataset.step];
      slider.value = String(Math.min(Number(slider.max), Math.max(0, Number(slider.value) + Number(step.dataset.by))));
      slider.dispatchEvent(new Event("input"));
    });
  }
  elements["export-race-markers"].addEventListener("click", useRaceMarkers);
  // The panel isn't modal, so Escape closes it here.
  document.addEventListener("keydown", (event) => {
    const panel = elements["export-voyage-dialog"];
    if (event.key === "Escape" && panel.open && keysBelongTo(panel)) panel.close();
  });
  elements["export-share"].addEventListener("change", updateExportRange);
  elements["export-voyage-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    finishExport();
  });
  elements["export-voyage-dialog"].addEventListener("close", () => {
    exportRange = null;
    activeCourse = null;
    redraw();
  });
  elements["course-mods"].addEventListener("change", () => {
    elements["course-plugins-row"].hidden = elements["course-mods"].value === "any";
  });
  elements["course-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    finishCourse();
  });
  elements["browse-world"].addEventListener("change", () => showWorld(elements["browse-world"].value));
  elements["browse-heatmap"].addEventListener("change", toggleHeatmap);
  elements["browse-open-site"].addEventListener("click", () => {
    const key = elements["browse-world"].value;
    host.openLink(siteUrl(key ? `#world/${encodeURIComponent(key)}` : ""));
  });
}

// --- Export, share and race ------------------------------------------------------------------------

const MODES = {
  export: { title: "Save route to file", intro: "Choose the part of your Voyage Recorder track to save. It's highlighted on the chart. Your save slot and file paths are never included.", button: "Save" },
  share: { title: "Publish world/route", intro: "Choose the part of your track to publish on Chartroom Voyages. Its world is published with it if the site doesn't have it yet. Chartroom saves the file and opens the form in your browser. Drag the file into the form, then submit it. Published routes are public and show your GitHub username.", button: "Save and open the form" },
  race: { title: "Enter a race", intro: "Choose the race and the part of your track you sailed it on. Chartroom checks the run live against the course on your chart, saves the file and opens the entry form in your browser. Drag the file into the form, then submit it.", button: "Save and open" }
};

async function openExport(nextMode) {
  const chart = activeChart();
  const points = exportablePoints(chart);
  if (points.length < 2) {
    showToast(`${MODES[nextMode].title} needs a Voyage Recorder track with at least two timed positions on this chart.`, true);
    return;
  }
  const key = worldKey(chart.recording?.world);
  if (nextMode === "race") {
    let worlds = [];
    try {
      const all = await siteData("data/courses.json");
      courses = key ? all.filter((course) => course.world === key) : all;
      if (!key && new Set(courses.map((course) => course.world)).size > 1) {
        worlds = await siteData("data/worlds.json").catch(() => []);
      }
    } catch (error) {
      showToast(error.message, true);
      return;
    }
    if (!courses.length) {
      showToast("There are no races for this chart's world yet. Publish a route as a race to start one.", true);
      return;
    }
    const worldNames = new Map(worlds.map((world) => [world.key, world.name]));
    const multiWorld = !key && new Set(courses.map((course) => course.world)).size > 1 && worldNames.size > 0;
    elements["export-course"].replaceChildren(...courses.map((course) => {
      const worldLabel = multiWorld ? worldNames.get(course.world) : "";
      const label = worldLabel
        ? `${course.name} — ${worldLabel} (${course.runs} run${course.runs === 1 ? "" : "s"})`
        : `${course.name} (${course.runs} run${course.runs === 1 ? "" : "s"})`;
      return new Option(label, course.id);
    }));
  }
  mode = nextMode;
  const text = MODES[mode];
  elements["export-title"].textContent = text.title;
  elements["export-intro"].textContent = text.intro;
  elements["export-submit"].textContent = text.button;
  elements["export-course-row"].hidden = mode !== "race";
  elements["export-auto-find"].hidden = mode !== "race";
  activeCourse = null;
  syncRequiredShare();
  for (const id of ["export-from", "export-to"]) elements[id].max = String(points.length - 1);
  // The latest stretch of the track is chosen to start with, as most often that's the trip just sailed.
  const latest = trackSegments(points).at(-1);
  elements["export-from"].value = String(points.indexOf(latest[0]));
  elements["export-to"].value = String(points.length - 1);
  setupWorldChoice(chart, key);
  elements["export-check"].hidden = true;
  elements["export-name"].value = "";
  elements["export-note"].value = "";
  elements["export-race-markers"].hidden = !raceMarkers(points);
  updateExportRange();
  elements["export-voyage-dialog"].show();
  follow("export-from");
  if (mode === "race") loadSelectedCourse();
}

function syncRequiredShare() {
  const required = mode === "race" ? requiredShareOptions(activeCourse) : new Set();
  for (const box of elements["export-share"].querySelectorAll("input")) {
    const locked = required.has(box.value);
    box.disabled = locked;
    if (locked) box.checked = true;
  }
}

async function fetchCourse(id) {
  if (!id) return null;
  if (!courseCache.has(id)) {
    const { course } = await siteData(`data/boards/${encodeURIComponent(id)}.json`);
    courseCache.set(id, course);
  }
  return courseCache.get(id);
}

async function loadSelectedCourse() {
  if (mode !== "race") return;
  const id = elements["export-course"].value;
  const token = ++courseLoadToken;
  activeCourse = null;
  syncRequiredShare();
  elements["export-check"].hidden = true;
  redraw();
  try {
    const course = await fetchCourse(id);
    if (token !== courseLoadToken || mode !== "race") return;
    activeCourse = course;
    syncRequiredShare();
    updateExportRange();
  } catch (error) {
    if (token !== courseLoadToken || mode !== "race") return;
    showExportProblem(error.message);
  }
}

function autoFindRaceRun() {
  if (mode !== "race" || !activeCourse) return;
  const chart = activeChart();
  const points = exportablePoints(chart);
  const found = findRaceRunRange(activeCourse, points, chart.visits ?? [], chart.recording?.plugins ?? null);
  if (!found) {
    showExportProblem("No completed run for this race was found in your recorded track.");
    return;
  }
  elements["export-from"].value = String(found.from);
  elements["export-to"].value = String(found.to);
  updateExportRange();
  follow("export-from");
}

function setupWorldChoice(chart, key) {
  const row = elements["export-world-row"];
  const choice = elements["export-world-choice"];
  const source = elements["export-world-source"];
  source.value = "";
  if (key) {
    row.hidden = true;
    elements["export-world-source-row"].hidden = true;
    const world = chart.recording?.world;
    elements["export-world"].textContent = world?.kind === "vanilla"
      ? "World: vanilla Sailwind."
      : `World: Scrambled Seas, seed ${world.seed}.`;
    return;
  }
  row.hidden = false;
  elements["export-world-source-label"].textContent = mode === "share" ? "Scrambled Seas XML or World Generator link" : "Scrambled Seas XML";
  source.placeholder = mode === "share" ? "Paste Scrambled Seas XML or a World Generator link" : "Paste Scrambled Seas XML";
  choice.replaceChildren(
    new Option(mode === "share" ? "Choose a world…" : "Not set (older recording)", ""),
    new Option("Vanilla Sailwind (declared by you)", "vanilla"),
    new Option(mode === "share" ? "Scrambled Seas (XML or link)" : "Scrambled Seas (paste XML)", "scrambled")
  );
  choice.value = "";
  updateWorldChoice();
}

function updateWorldChoice() {
  const chart = activeChart();
  if (worldKey(chart.recording?.world)) return;
  const choice = elements["export-world-choice"].value;
  elements["export-world-source-row"].hidden = choice !== "scrambled";
  elements["export-check"].hidden = true;
  if (choice === "vanilla") {
    elements["export-world"].textContent = "World: vanilla Sailwind (declared by you — not recorded in the log).";
  } else if (choice === "scrambled") {
    elements["export-world"].textContent = "World: Scrambled Seas (declared by you — not recorded in the log).";
  } else if (mode === "race") {
    elements["export-world"].textContent = "World not recorded, so the run counts as sailed in the race's world.";
  } else if (mode === "share") {
    elements["export-world"].textContent = "This recording didn't record its world. Choose the world you sailed it in to publish it (it will be noted as declared by you).";
  } else {
    elements["export-world"].textContent = "This recording didn't record its world. Leave unset for local comparison, or choose a world if you plan to publish this route later.";
  }
}

// Resolves a user-declared world when the chart's recording didn't record one.
function resolveDeclaredWorld(chart) {
  if (worldKey(chart.recording?.world)) return { world: null, worldDeclared: false, formFields: null };
  const choice = elements["export-world-choice"].value;
  if (!choice) {
    if (mode === "share") throw new Error("Choose which world this route was sailed in before publishing it.");
    return { world: null, worldDeclared: false, formFields: null };
  }
  if (choice === "vanilla") return { world: { kind: "vanilla" }, worldDeclared: true, formFields: null };
  const source = elements["export-world-source"].value.trim();
  if (!source) {
    throw new Error(mode === "share"
      ? "Paste the world's Scrambled Seas XML or a World Generator share link."
      : "Paste the world's Scrambled Seas XML.");
  }
  if (source.startsWith("<") || source.includes("<ScrambledSeasSaveContainer")) {
    return { world: worldFromXml(source), worldDeclared: true, formFields: null };
  }
  if (isWorldGeneratorLink(source)) {
    if (mode === "share") {
      return {
        world: null,
        worldDeclared: false,
        formFields: { world: "Scrambled Seas (paste link or XML below)", scrambled_world: source }
      };
    }
    throw new Error("Save route to file and Enter a race need the Scrambled Seas XML. For a World Generator share link, use Voyage > Publish world/route.");
  }
  throw new Error(mode === "share"
    ? "Paste a Scrambled Seas XML file or a World Generator share link."
    : "Paste a Scrambled Seas XML file.");
}

// The latest race start recorded with Voyage Recorder's marker menu, and the first finish after it.
function raceMarkers(points) {
  const start = points.findLastIndex((point) => point.event === "race-start");
  const finish = start < 0 ? -1 : points.findIndex((point, index) => index > start && point.event === "race-finish");
  return finish < 0 ? null : { start, finish };
}

function useRaceMarkers() {
  const markers = raceMarkers(exportablePoints(activeChart()));
  if (!markers) return;
  elements["export-from"].value = String(markers.start);
  elements["export-to"].value = String(markers.finish);
  updateExportRange();
  follow("export-from");
}

// Centres the chart on the position an end is at, keeping the zoom.
function follow(id) {
  const point = exportablePoints(activeChart())[Number(elements[id].value)];
  if (!point) return;
  const view = activeChart().view;
  view.lat = point.lat;
  view.lon = point.lon;
  exportRange = { ...exportRange, focus: point };
  redraw();
}

function chosenShare() {
  return { ...defaultShare(), ...Object.fromEntries([...elements["export-share"].querySelectorAll("input")].map((box) => [box.value, box.checked])) };
}

// The summary counts what the file will hold, so leaving out marks shows in it.
function updateExportRange() {
  const from = Number(elements["export-from"].value);
  const to = Number(elements["export-to"].value);
  exportRange = { points: chosenPoints(activeChart(), from, to, chosenShare()) };
  const chosen = exportRange.points;
  const stats = sailedStats(chosen);
  const all = exportablePoints(activeChart());
  const describe = (point) => point ? [formatGameTime(point.t), point.boat, eventName(point.event)].filter(Boolean).join(" · ") : "";
  elements["export-from-text"].textContent = describe(all[from]);
  elements["export-to-text"].textContent = describe(all[to]);
  elements["export-summary"].replaceChildren(...[
    `${chosen.length} positions`,
    `${formatNm(stats.distanceNm)} nm`,
    `${formatDuration((chosen.at(-1)?.t ?? 0) - (chosen[0]?.t ?? 0))} at sea`
  ].map((text) => Object.assign(document.createElement("span"), { className: "stat-chip", textContent: text })));
  // In race mode, live-check the current selection against the loaded course.
  if (mode === "race" && activeCourse) updateLiveRaceCheck();
  else elements["export-check"].hidden = true;
  redraw();
}

function updateLiveRaceCheck() {
  if (mode !== "race" || !activeCourse) return;
  const chart = activeChart();
  const points = exportRange?.points ?? [];
  if (points.length < 2) {
    showExportProblem("Choose at least two positions.");
    return;
  }
  const share = chosenShare();
  const start = points[0].t;
  const end = points.at(-1).t;
  const previewFile = {
    points,
    visits: share.visits ? (chart.visits ?? []).filter((visit) => visit.t >= start && visit.t <= end) : [],
    plugins: share.plugins && chart.recording?.plugins ? chart.recording.plugins : null
  };
  let fileWorldKey = worldKey(chart.recording?.world);
  if (!fileWorldKey) {
    const choice = elements["export-world-choice"].value;
    if (choice === "vanilla") fileWorldKey = "vanilla";
  }
  if (fileWorldKey && fileWorldKey !== activeCourse.world) {
    showExportProblem("This run was sailed in a different world from the race's.");
    return;
  }
  const result = checkRaceLocally(activeCourse, previewFile);
  const check = elements["export-check"];
  check.hidden = false;
  check.classList.toggle("problem", !result.ok);
  if (!result.ok) {
    check.textContent = result.reason;
    return;
  }
  const notes = (result.notes ?? []).map((note) => RUN_NOTES[note]).filter(Boolean);
  check.textContent = `Valid run: ${formatDuration(result.gameHours)} game time, starting from ${result.startedFrom}.${notes.length ? ` Board note: ${notes.join(", ")}.` : ""}`;
}

async function buildFile(declared = { world: null, worldDeclared: false }) {
  const chart = activeChart();
  const share = chosenShare();
  return buildVoyageFile(chart, {
    from: Number(elements["export-from"].value),
    to: Number(elements["export-to"].value),
    share,
    name: elements["export-name"].value,
    note: elements["export-note"].value,
    gameHash: await hashGameId(chart.recording?.game),
    version: host.version,
    world: declared.world,
    worldDeclared: declared.worldDeclared
  });
}

function showExportProblem(message) {
  const check = elements["export-check"];
  check.hidden = false;
  check.classList.add("problem");
  check.textContent = message;
}

async function finishExport() {
  if (exporting) return;
  exporting = true;
  elements["export-submit"].disabled = true;
  try {
    const chart = activeChart();
    let declared;
    try {
      declared = resolveDeclaredWorld(chart);
    } catch (error) {
      showExportProblem(error.message);
      return;
    }
    const file = await buildFile(declared);
    let form = null;
    let toastText = "Route saved to file.";
    if (mode === "race") {
      const id = elements["export-course"].value;
      const course = activeCourse?.id === id ? activeCourse : await fetchCourse(id);
      const fileWorldKey = worldKey(file.world);
      if (fileWorldKey && fileWorldKey !== course.world) {
        showExportProblem("This run wouldn't be accepted: This run was sailed in a different world from the race's.");
        return;
      }
      const result = checkRaceLocally(course, file);
      const check = elements["export-check"];
      check.hidden = false;
      check.classList.toggle("problem", !result.ok);
      if (!result.ok) {
        check.textContent = `This run wouldn't be accepted: ${result.reason}`;
        return;
      }
      const worldNotes = !fileWorldKey ? ["world-not-recorded"] : file.worldDeclared === true ? ["world-declared"] : [];
      const notes = [...worldNotes, ...(result.notes ?? [])].map((note) => RUN_NOTES[note]).filter(Boolean);
      const summary = `${formatDuration(result.gameHours)} of game time, starting from ${result.startedFrom}.${notes.length ? ` The board will note: ${notes.join(", ")}.` : ""}`;
      check.textContent = summary;
      toastText = `Route saved (${formatDuration(result.gameHours)} from ${result.startedFrom}${notes.length ? `; ${notes.join(", ")}` : ""}). Drag the file into the form that opened in your browser, then submit it.`;
      form = issueFormUrl("enter-race", { course: id });
    } else if (mode === "share") {
      form = issueFormUrl("share-voyage", declared.formFields ?? {});
      toastText = "Route saved. Drag the file into the form that opened in your browser, then submit it.";
    }
    const base = (file.name || chart.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "voyage";
    const fileName = `${base}${VOYAGE_EXTENSION}`;
    const contents = JSON.stringify(file);
    elements["export-voyage-dialog"].close();
    if (host.exportWithLink) {
      const requestId = `voyage-${nextExportId++}`;
      pendingExports.set(requestId, { toast: toastText, expectsOpen: Boolean(form) });
      host.exportFile(fileName, contents, "application/json", { id: requestId, openUrl: form, reveal: Boolean(form) });
    } else {
      host.exportFile(fileName, contents, "application/json");
      if (form) host.openLink(form);
      showToast(toastText);
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    exporting = false;
    elements["export-submit"].disabled = false;
  }
}

// --- Publish as race ---------------------------------------------------------------------------------

// The world a course from this chart is for: its recording's, or vanilla for a chart with no recording at all,
// unless the chart has a Scrambled Seas seed, whose settings only a recording carries. An older recording
// that doesn't name its world can't say which it was.
function courseWorld(chart) {
  if (chart.recording) return chart.recording.world ?? null;
  return String(chart.seed ?? "").trim() ? null : { kind: "vanilla" };
}

// The route to publish: the saved route a selected waypoint belongs to, or the route being planned.
function routeToPublish(chart) {
  const saved = selection?.kind === "saved-point" ? savedRouteForPoint(chart, selection.id) : null;
  return saved ? { name: saved.name, points: saved.points } : { name: "", points: chart.route };
}

function courseOptions() {
  const list = (text, separator) => text.split(separator).map((entry) => entry.trim()).filter(Boolean);
  const hull = elements["course-max-hull"].value.trim();
  const mods = elements["course-mods"].value;
  return {
    name: elements["course-name"].value,
    description: elements["course-description"].value,
    order: elements["course-order"].value,
    rules: {
      sortBy: elements["course-sort"].value,
      mods: { mode: mods, plugins: mods === "any" ? [] : list(elements["course-plugins"].value, /\r?\n/) },
      boats: list(elements["course-boats"].value, ","),
      oneBoat: elements["course-one-boat"].checked,
      maxHull: hull === "" ? null : Number(hull),
      honour: elements["course-honour"].value
    }
  };
}

function openCourse() {
  const chart = activeChart();
  const route = routeToPublish(chart);
  if (route.points.length < 2) {
    showToast("First plan a route through the race's stops, or select a waypoint from a saved route.", true);
    return;
  }
  // A dry run with placeholder rules shows how the waypoints were read, and catches an unknown world early.
  let preview;
  try {
    preview = courseFromRoute(route.points, courseWorld(chart), { name: route.name || "Course" });
  } catch (error) {
    showToast(error.message, true);
    return;
  }
  const describeStop = (target) => target.island
    ? `${islandById(target.island)?.name ?? target.island} (island)`
    : `${target.name} (mark, ${target.radiusNm} nm)`;
  elements["course-summary"].textContent = [
    `Start: ${describeStop(preview.start)}`,
    `Checkpoints: ${preview.checkpoints.map(describeStop).join(", ")}`,
    `Finish: ${preview.finish.lastCheckpoint ? "the last checkpoint reached" : describeStop(preview.finish)}`
  ].join("\n");
  elements["course-form"].reset();
  elements["course-name"].value = route.name;
  elements["course-order"].value = preview.checkpoints.length > 1 ? "fixed" : "any";
  elements["course-plugins-row"].hidden = elements["course-mods"].value === "any";
  elements["course-dialog"].showModal();
}

async function finishCourse() {
  const chart = activeChart();
  try {
    const course = courseFromRoute(routeToPublish(chart).points, courseWorld(chart), courseOptions());
    // The site turns away a second course with the same id; say so here when the site can be reached.
    const existing = await siteData("data/courses.json").catch(() => []);
    if (existing.some((other) => other.id === course.id)) throw new Error(`A race called "${course.id}" already exists. Choose another name.`);
    const { author, ...submission } = course;
    const world = courseWorld(chart);
    if (world?.kind === "scrambled") submission.worldSettings = world;
    host.openLink(issueFormUrl("create-course", { course: JSON.stringify(submission, null, 2) }));
    elements["course-dialog"].close();
    showToast("Submit the form that opened in your browser to publish the race.");
  } catch (error) {
    showToast(error.message, true);
  }
}

// --- Browse shared worlds/voyages -------------------------------------------------------------------

async function openBrowse() {
  elements["browse-status"].textContent = "Loading…";
  elements["browse-world-row"].hidden = true;
  elements["browse-heatmap-row"].hidden = true;
  elements["browse-world-summary"].textContent = "";
  elements["browse-list"].replaceChildren();
  elements["browse-dialog"].showModal();
  try {
    browseWorlds = await siteData("data/worlds.json");
  } catch (error) {
    elements["browse-status"].textContent = error.message;
    return;
  }
  if (!browseWorlds.length) {
    elements["browse-status"].textContent = "Nothing has been shared yet.";
    return;
  }
  elements["browse-status"].textContent = "Open a published route as a comparison on this chart.";
  elements["browse-world"].replaceChildren(...browseWorlds.map((world) => new Option(`${world.name} (${world.voyages} route${world.voyages === 1 ? "" : "s"})`, world.key)));
  const own = worldKey(activeChart().recording?.world);
  elements["browse-world"].value = browseWorlds.some((world) => world.key === own) ? own : browseWorlds[0].key;
  elements["browse-world-row"].hidden = false;
  await showWorld(elements["browse-world"].value);
}

async function showWorld(key) {
  elements["browse-list"].replaceChildren();
  elements["browse-heatmap-row"].hidden = true;
  let world;
  try {
    world = await siteData(`data/worlds/${encodeURIComponent(key)}.json`);
  } catch (error) {
    elements["browse-world-summary"].textContent = error.message;
    return;
  }
  if (elements["browse-world"].value !== key) return;
  const own = worldKey(activeChart().recording?.world);
  elements["browse-world-summary"].textContent = own && own !== key
    ? "This chart's recording is from another world, so these routes won't line up with its islands."
    : world.description || "";
  elements["browse-heatmap"].checked = heatmap?.key === key;
  elements["browse-heatmap-row"].hidden = !world.heatmap?.voyages;
  elements["browse-list"].replaceChildren(...(world.voyageList.length ? world.voyageList.map((voyage) => browseRow(voyage, world)) : [Object.assign(document.createElement("p"), { className: "fineprint", textContent: "No voyages shared here yet." })]));
}

function browseRow(voyage, world) {
  const row = Object.assign(document.createElement("div"), { className: "browse-row" });
  const text = document.createElement("span");
  text.append(document.createTextNode(voyage.name || "Untitled"),
    Object.assign(document.createElement("small"), { textContent: `${voyage.submitter} · ${formatNm(voyage.distanceNm)} nm · ${formatDuration(voyage.hours)}${voyage.boats.length ? ` · ${voyage.boats.join(", ")}` : ""}` }));
  const compare = Object.assign(document.createElement("button"), { type: "button", textContent: "Compare" });
  compare.addEventListener("click", async () => {
    compare.disabled = true;
    try {
      addComparison(await siteData(voyage.file), `${voyage.submitter}'s route`);
      persist();
      renderAll();
      compare.textContent = "Added";
      showToast(`Comparing ${voyage.name || "the route"} from ${world.name}.`);
    } catch (error) {
      compare.disabled = false;
      showToast(error.message, true);
    }
  });
  row.append(text, compare);
  return row;
}

async function toggleHeatmap() {
  const key = elements["browse-world"].value;
  if (!elements["browse-heatmap"].checked) {
    heatmap = null;
    redraw();
    return;
  }
  try {
    const world = await siteData(`data/worlds/${encodeURIComponent(key)}.json`);
    heatmap = { key, squares: heatmapSquares(world.heatmap) };
  } catch (error) {
    elements["browse-heatmap"].checked = false;
    showToast(error.message, true);
  }
  redraw();
}

// --- Drawing ----------------------------------------------------------------------------------------

// The shared heatmap, beneath the chart's own marks. Not saved: it lasts until turned off or Chartroom closes.
export function drawHeatmap(palette) {
  if (!heatmap?.squares.length) return;
  context.save();
  context.fillStyle = palette.accent;
  for (const square of heatmap.squares) {
    const a = worldToScreen({ lat: square.lat + square.size, lon: square.lon });
    const b = worldToScreen({ lat: square.lat, lon: square.lon + square.size });
    context.globalAlpha = 0.12 + 0.43 * square.share;
    context.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }
  context.restore();
}

// What the board notes for a run from an older recording, as Chartroom Voyages words it.
const RUN_NOTES = Object.freeze({
  "world-not-recorded": "world not recorded",
  "world-declared": "world declared by player",
  "mods-not-recorded": "mods not recorded",
  "no-real-time": "no real time recorded"
});

const EVENT_NAMES = { "race-start": "Race start", "race-checkpoint": "Race checkpoint", "race-finish": "Race finish", mark: "Recorded location", start: "Recording started", stop: "Recording stopped" };

function eventName(event) {
  return EVENT_NAMES[event] ?? "";
}

// The stretch the export panel will save, with a ring on each end and a larger one on the end being moved.
// In Enter a race mode, also draws the selected race's flags, mark circles and fixed-order path.
export function drawExportRange(palette) {
  if (mode === "race" && activeCourse) drawCourseOverlay(palette, activeCourse);
  if (!exportRange?.points.length) return;
  drawRangeLine(palette);
  const ends = [exportRange.points[0], exportRange.points.at(-1)];
  context.save();
  for (const point of ends) {
    const screen = worldToScreen(point);
    const focused = point === exportRange.focus;
    context.beginPath();
    context.arc(screen.x, screen.y, focused ? 9 : 6, 0, Math.PI * 2);
    context.lineWidth = focused ? 3 : 2;
    context.strokeStyle = palette.select;
    context.fillStyle = palette.paperA;
    context.fill();
    context.stroke();
  }
  context.restore();
}

function courseOverlayStops(course) {
  const resolve = (target) => {
    if (target?.island) {
      const island = islandById(target.island);
      return island ? { lat: island.lat, lon: island.lon, label: island.name, radiusNm: null } : null;
    }
    if (Number.isFinite(target?.lat) && Number.isFinite(target?.lon)) {
      return { lat: target.lat, lon: target.lon, label: `${target.name} (${target.radiusNm} nm)`, radiusNm: target.radiusNm };
    }
    return null;
  };
  const stops = [];
  const add = (target, kind) => {
    const resolved = resolve(target);
    if (resolved) stops.push({ ...resolved, kind });
  };
  if (!course.start?.any) add(course.start, "start");
  (course.checkpoints ?? []).forEach((target, index) => {
    const last = course.finish?.lastCheckpoint && course.order === "fixed" && index === course.checkpoints.length - 1;
    add(target, last ? "finish" : "checkpoint");
  });
  if (!course.finish?.lastCheckpoint) add(course.finish, "finish");
  return stops;
}

function drawCourseOverlay(palette, course) {
  const stops = courseOverlayStops(course);
  if (!stops.length) return;
  const colours = { start: "#2f8f4e", checkpoint: "#c88719", finish: "#c23b2b" };
  context.save();
  if (course.order === "fixed" && stops.length >= 2) {
    context.strokeStyle = palette.ink;
    context.globalAlpha = 0.45;
    context.lineWidth = 1.6;
    context.setLineDash([6, 5]);
    context.beginPath();
    stops.forEach((stop, index) => {
      const screen = worldToScreen(stop);
      if (index) context.lineTo(screen.x, screen.y); else context.moveTo(screen.x, screen.y);
    });
    context.stroke();
    context.setLineDash([]);
  }
  for (const stop of stops) {
    const screen = worldToScreen(stop);
    const fill = colours[stop.kind] ?? palette.accent;
    if (Number.isFinite(stop.radiusNm)) {
      const edge = worldToScreen({ lat: stop.lat + stop.radiusNm / NM_PER_DEGREE, lon: stop.lon });
      const radiusPx = Math.max(4, Math.hypot(edge.x - screen.x, edge.y - screen.y));
      context.beginPath();
      context.arc(screen.x, screen.y, radiusPx, 0, Math.PI * 2);
      context.fillStyle = fill;
      context.globalAlpha = 0.14;
      context.fill();
      context.strokeStyle = fill;
      context.globalAlpha = 0.75;
      context.lineWidth = 1.4;
      context.setLineDash([4, 3]);
      context.stroke();
      context.setLineDash([]);
    }
    context.globalAlpha = 1;
    context.strokeStyle = palette.ink;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(screen.x, screen.y);
    context.lineTo(screen.x, screen.y - 16);
    context.stroke();
    context.fillStyle = fill;
    context.beginPath();
    if (stop.kind === "checkpoint") {
      context.moveTo(screen.x, screen.y - 16);
      context.lineTo(screen.x + 11, screen.y - 12);
      context.lineTo(screen.x, screen.y - 8);
      context.closePath();
    } else {
      context.rect(screen.x, screen.y - 16, 11, 8);
    }
    context.fill();
    context.stroke();
    context.fillStyle = palette.ink;
    context.beginPath();
    context.arc(screen.x, screen.y, 2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawRangeLine(palette) {
  context.save();
  context.strokeStyle = palette.select;
  context.lineWidth = 4;
  context.lineJoin = "round";
  context.globalAlpha = 0.75;
  context.beginPath();
  unwrapStretch(exportRange.points).forEach((point, index) => {
    const screen = worldToScreen(point);
    if (index) context.lineTo(screen.x, screen.y); else context.moveTo(screen.x, screen.y);
  });
  context.stroke();
  context.restore();
}

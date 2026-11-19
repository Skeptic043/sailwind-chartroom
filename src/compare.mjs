// Comparing other players' voyages with this chart's track. Comparison voyages are drawn in their own
// colours beside your track. Show location by time elapsed puts a marker on every
// voyage at the same time since its start, so you can see who was where after the same hours at sea.
import { createComparison, formatCoordinate, formatDuration, MAX_COMPARISONS, milesPerGameHour } from "./model.mjs";
import { exportablePoints, parseVoyageFile, positionAtElapsed, sameWorld } from "./voyages.mjs";
import { sailedStats, trackSegments, unwrapStretch } from "./track.mjs";
import { formatGameTime } from "./gametime.mjs";
import { formatBearing, formatNm } from "./format.mjs";
import { context, elements, showToast } from "./dom.mjs";
import { activeChart, changeOutsideHistory, persist, selection } from "./state.mjs";
import { worldToScreen } from "./viewport.mjs";
import { drawTrackWind, fitPoints } from "./render.mjs";

// Elapsed game hours shown by the scrubber, and the playback's animation frame.
let elapsed = 0;
let playing = 0;
// Playback runs at a multiple of Sailwind's own clock: at 1× a game hour takes 125 real seconds, as in the game
// at normal speed (Sun.timescale 0.008 game hours a second), so following along feels like sailing it again.
// With the chart's game clock slowed, a game hour takes as much longer as it does in the game.
const REAL_SECONDS_PER_GAME_HOUR = 125;
const PLAYBACK_SPEEDS = Object.freeze([1, 2, 5, 10, 25, 50, 100, 250, 500]);
const POINT_HIT_PX = 8;
// Wind vanes along a comparison sit at least this far apart, as on your own track.
const WIND_SPACING_PX = 70;

// All comparisons together: about 140 days of readings a minute.
const MAX_COMPARED_POINTS = 200000;

let redraw = () => {};

export function initCompare({ draw, renderAll }) {
  redraw = draw;
  elements["compare-voyage"].addEventListener("click", () => elements["voyage-file"].click());
  elements["voyage-file"].addEventListener("change", async (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    await importComparisons(files);
    renderAll();
  });
  elements["compare-align"].addEventListener("change", () => {
    stopPlayback();
    renderCompare();
    redraw();
  });
  elements["compare-scrub"].addEventListener("input", (event) => {
    elapsed = Number(event.target.value);
    renderElapsed();
    redraw();
  });
  elements["compare-play"].addEventListener("click", () => (playing ? stopPlayback() : startPlayback()));
  elements["compare-speed"].addEventListener("input", renderSpeed);
  renderSpeed();
  elements["track-compare-start"].addEventListener("click", () => {
    if (selection?.kind !== "track") return;
    const id = selection.id;
    changeOutsideHistory(activeChart(), (target) => { target.compareStartId = id; });
    persist();
    renderCompare();
    redraw();
  });
}

// --- Compare ----------------------------------------------------------------------------------------

async function importComparisons(files) {
  let added = 0;
  for (const file of files) {
    try {
      addComparison(JSON.parse(await file.text()), file.name.replace(/\.voyage\.json$|\.json$/i, ""));
      added++;
    } catch (error) {
      showToast(`${file.name}: ${error.message}`, true);
    }
  }
  if (!added) return;
  persist();
  showToast(`Comparing ${added} route${added === 1 ? "" : "s"}.`);
}

// Adds a voyage file's contents to the active chart's comparisons, named after fallbackName when the voyage
// has no name of its own. Throws with a message for the player. The caller persists.
export function addComparison(value, fallbackName) {
  const chart = activeChart();
  if (chart.comparisons.length >= MAX_COMPARISONS) throw new Error(`A chart compares up to ${MAX_COMPARISONS} routes. Remove one first.`);
  const voyage = parseVoyageFile(value);
  const total = chart.comparisons.reduce((sum, comparison) => sum + comparison.points.length, voyage.points.length);
  if (total > MAX_COMPARED_POINTS) throw new Error("That's more recorded positions than a chart can compare at once. Remove a comparison first.");
  const comparison = createComparison({ ...voyage, name: voyage.name || fallbackName }, chart.comparisons.length);
  changeOutsideHistory(chart, (target) => { target.comparisons = [...target.comparisons, comparison]; });
}

function updateComparison(id, change) {
  changeOutsideHistory(activeChart(), (target) => {
    target.comparisons = target.comparisons.map((comparison) => comparison.id === id ? { ...comparison, ...change } : comparison);
  });
  persist();
  renderCompare();
  redraw();
}

function removeComparison(id) {
  changeOutsideHistory(activeChart(), (target) => {
    target.comparisons = target.comparisons.filter((comparison) => comparison.id !== id);
  });
  persist();
  renderCompare();
  redraw();
}

// Your own voyage for comparing: the chart's Voyage Recorder track, counted from the position picked with
// "Count elapsed time from here", or from the start of its latest stretch.
function ownVoyage(chart) {
  const points = exportablePoints(chart);
  if (!points.length) return null;
  const picked = points.find((point) => point.id === chart.compareStartId);
  const start = picked ?? trackSegments(points).at(-1)[0];
  return { points, start: start.t, startPoint: start };
}

function longestElapsed(chart) {
  const own = ownVoyage(chart);
  const spans = chart.comparisons.filter((comparison) => comparison.shown).map((comparison) => comparison.points.at(-1).t - comparison.start);
  if (own) spans.push(own.points.at(-1).t - own.start);
  return Math.max(0, ...spans);
}

export function renderCompare() {
  const chart = activeChart();
  const count = chart.comparisons.length;
  elements["compare-section"].hidden = count === 0;
  elements["compare-count"].textContent = String(count);
  if (!count) {
    stopPlayback();
    return;
  }
  const chartWorld = chart.recording?.world;
  elements["compare-list"].replaceChildren(...chart.comparisons.map((comparison) => compareRow(comparison, chartWorld)));
  const aligned = elements["compare-align"].checked;
  elements["compare-scrub-row"].hidden = !aligned;
  const max = longestElapsed(chart);
  elements["compare-scrub"].max = String(max);
  elements["compare-total"].textContent = formatDuration(max) || "0m";
  if (elapsed > max) elapsed = max;
  renderElapsed();
}

// One comparison in the panel: its name and controls, its numbers, the details it can draw, and where its
// elapsed time counts from.
function compareRow(comparison, chartWorld) {
  const row = document.createElement("div");
  row.className = "compare-row";
  const heading = Object.assign(document.createElement("div"), { className: "compare-heading" });
  const swatch = Object.assign(document.createElement("span"), { className: "swatch" });
  swatch.style.background = comparison.color;
  const shown = Object.assign(document.createElement("input"), { type: "checkbox", checked: comparison.shown, title: "Show on the chart" });
  shown.setAttribute("aria-label", "Show on the chart");
  shown.addEventListener("change", () => updateComparison(comparison.id, { shown: shown.checked }));
  const remove = Object.assign(document.createElement("button"), { type: "button", textContent: "Remove" });
  remove.addEventListener("click", () => removeComparison(comparison.id));
  // Brings the whole voyage into view.
  const jump = Object.assign(document.createElement("button"), { type: "button", textContent: "Go to", title: "Show this route on the chart" });
  jump.addEventListener("click", () => {
    if (!comparison.shown) updateComparison(comparison.id, { shown: true });
    fitPoints(comparison.points);
  });
  heading.append(shown, swatch, Object.assign(document.createElement("strong"), { textContent: comparison.name || "Route", title: comparison.name || "Route" }), jump, remove);
  row.append(heading);

  const stats = sailedStats(comparison.points);
  const boats = [...new Set(comparison.points.map((point) => point.boat).filter(Boolean))];
  const winds = comparison.points.map((point) => point.windKnots).filter(Number.isFinite);
  const hulls = comparison.points.map((point) => point.hull).filter(Number.isFinite);
  const chips = [
    `${formatNm(stats.distanceNm)} nm`,
    formatDuration(comparison.points.at(-1).t - comparison.points[0].t),
    `${formatGameTime(comparison.points[0].t)} start`,
    ...boats,
    winds.length ? `Wind ${(winds.reduce((sum, value) => sum + value, 0) / winds.length).toFixed(1)} kn average` : "",
    hulls.length ? `Hull damage up to ${hulls.reduce((most, value) => Math.max(most, value), 0)}%` : "",
    comparison.visits.length ? `${new Set(comparison.visits.map((visit) => visit.port)).size} ports` : ""
  ].filter(Boolean);
  row.append(Object.assign(document.createElement("div"), { className: "stat-chips" }));
  row.lastChild.append(...chips.map((text) => Object.assign(document.createElement("span"), { className: "stat-chip", textContent: text, title: text })));
  // Comparing across worlds still works; the warning says the islands won't line up.
  if (sameWorld(chartWorld, comparison.world) === false) row.append(Object.assign(document.createElement("small"), { className: "warning", textContent: "From a different world than this chart" }));

  // Only what the voyage file has can be drawn.
  const available = [
    ["wind", "Wind", comparison.points.some((point) => Number.isFinite(point.windFrom))],
    ["ports", "Port visits", comparison.visits.length > 0],
    ["notes", "Notes", comparison.notes.length > 0]
  ].filter(([, , has]) => has);
  if (available.length) {
    const toggles = Object.assign(document.createElement("div"), { className: "compare-toggles" });
    for (const [key, label] of available) {
      const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: comparison.details[key] });
      box.addEventListener("change", () => updateComparison(comparison.id, { details: { ...comparison.details, [key]: box.checked } }));
      const toggle = document.createElement("label");
      toggle.append(box, document.createTextNode(label));
      toggles.append(toggle);
    }
    row.append(toggles);
  }

  // With Show location by time elapsed, each voyage's clock starts at its first position, or when it left a port, so
  // two voyages from the same port can be lined up even if one waited there longer.
  if (elements["compare-align"].checked) {
    const start = document.createElement("select");
    start.append(new Option("Its first position", String(comparison.points[0].t)),
      ...comparison.visits.filter((visit) => visit.kind === "depart").map((visit) => new Option(`Leaving ${visit.port}, ${formatGameTime(visit.t)}`, String(visit.t))));
    start.value = String(comparison.start);
    start.addEventListener("change", () => updateComparison(comparison.id, { start: Number(start.value) }));
    const label = Object.assign(document.createElement("label"), { className: "compare-start", textContent: "Time counts from" });
    label.append(start);
    row.append(label);
  }
  return row;
}

// The scrubber runs from the start to the end of the longest voyage, and its handle sits exactly at the time.
function renderElapsed() {
  elements["compare-scrub"].value = String(elapsed);
  elements["compare-elapsed"].textContent = elapsed > 0 ? formatDuration(elapsed) : "0m";
}

function playbackSpeed() {
  return PLAYBACK_SPEEDS[elements["compare-speed"].valueAsNumber] ?? 100;
}

function renderSpeed() {
  elements["compare-speed-label"].textContent = `${playbackSpeed()}×`;
}

// Moves by the real time since the last frame, so the speed holds however fast the chart draws.
function startPlayback() {
  const max = Number(elements["compare-scrub"].max);
  if (!(max > 0)) return;
  if (elapsed >= max) elapsed = 0;
  elements["compare-play"].textContent = "❚❚";
  elements["compare-play"].title = "Pause";
  elements["compare-play"].setAttribute("aria-label", "Pause");
  let last = performance.now();
  const frame = (now) => {
    elapsed = Math.min(max, elapsed + (now - last) / 1000 / (REAL_SECONDS_PER_GAME_HOUR * milesPerGameHour(activeChart(), 1)) * playbackSpeed());
    last = now;
    renderElapsed();
    redraw();
    if (elapsed >= max) stopPlayback();
    else playing = requestAnimationFrame(frame);
  };
  playing = requestAnimationFrame(frame);
}

function stopPlayback() {
  if (playing) cancelAnimationFrame(playing);
  playing = 0;
  elements["compare-play"].textContent = "▶";
  elements["compare-play"].title = "Play";
  elements["compare-play"].setAttribute("aria-label", "Play");
}

// --- Drawing ----------------------------------------------------------------------------------------

export function drawComparisons(palette) {
  const chart = activeChart();
  context.save();
  context.lineWidth = 2;
  context.lineJoin = "round";
  for (const comparison of chart.comparisons) {
    if (!comparison.shown) continue;
    context.strokeStyle = comparison.color;
    for (const segment of trackSegments(comparison.points)) {
      const line = unwrapStretch(segment);
      context.beginPath();
      line.forEach((point, index) => {
        const screen = worldToScreen(point);
        if (index) context.lineTo(screen.x, screen.y); else context.moveTo(screen.x, screen.y);
      });
      context.stroke();
    }
  }
  for (const comparison of chart.comparisons) if (comparison.shown) drawDetails(comparison, palette);
  if (chart.comparisons.length && elements["compare-align"].checked) {
    const own = ownVoyage(chart);
    if (own) marker(positionAtElapsed(own.points, own.start, elapsed), palette.track, palette);
    for (const comparison of chart.comparisons) {
      if (comparison.shown) marker(positionAtElapsed(comparison.points, comparison.start, elapsed), comparison.color, palette);
    }
  }
  context.restore();
}

// A comparison's own details, in its colour: wind vanes spaced along its track, a ring at each port it
// reached with the port's name, and a small page for each of its notes.
function drawDetails(comparison, palette) {
  const { wind, ports, notes } = comparison.details;
  if (wind) {
    let last = null;
    for (const point of comparison.points) {
      if (!Number.isFinite(point.windFrom)) continue;
      const screen = worldToScreen(point);
      if (last && Math.hypot(screen.x - last.x, screen.y - last.y) < WIND_SPACING_PX) continue;
      drawTrackWind(screen, (point.windFrom + 180) % 360, palette, comparison.color);
      last = screen;
    }
  }
  context.save();
  context.font = "600 11px system-ui, sans-serif";
  context.textAlign = "center";
  if (ports) {
    for (const visit of comparison.visits) {
      if (visit.kind !== "arrive") continue;
      const at = positionAt(comparison.points, visit.t);
      if (!at) continue;
      const screen = worldToScreen(at);
      context.beginPath();
      context.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
      context.lineWidth = 2;
      context.strokeStyle = comparison.color;
      context.stroke();
      context.lineWidth = 3;
      context.strokeStyle = palette.paperB;
      context.strokeText(visit.port, screen.x, screen.y - 10);
      context.fillStyle = comparison.color;
      context.fillText(visit.port, screen.x, screen.y - 10);
    }
  }
  if (notes) {
    for (const note of comparison.notes) {
      const screen = worldToScreen(note);
      context.fillStyle = palette.paperA;
      context.strokeStyle = comparison.color;
      context.lineWidth = 1.6;
      context.fillRect(screen.x - 5, screen.y - 6, 10, 12);
      context.strokeRect(screen.x - 5, screen.y - 6, 10, 12);
    }
  }
  context.restore();
}

// Where a voyage was at game time t, between the readings either side.
function positionAt(points, t) {
  return positionAtElapsed(points, points[0].t, t - points[0].t);
}

function marker(position, colour, palette) {
  if (!position) return;
  const screen = worldToScreen(position);
  context.beginPath();
  context.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
  context.fillStyle = colour;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = palette.paperB;
  context.stroke();
}

// Pressing near a comparison voyage's position shows what was recorded there. Returns whether one was found.
export function showComparisonPointAt(screen) {
  const chart = activeChart();
  let best = null;
  for (const comparison of chart.comparisons) {
    if (!comparison.shown) continue;
    for (const point of comparison.points) {
      const at = worldToScreen(point);
      const distance = Math.hypot(at.x - screen.x, at.y - screen.y);
      if (distance <= POINT_HIT_PX && (!best || distance < best.distance)) best = { comparison, point, distance };
    }
  }
  for (const comparison of chart.comparisons) {
    if (!comparison.shown || !comparison.details.notes) continue;
    for (const note of comparison.notes) {
      const at = worldToScreen(note);
      if (Math.abs(at.x - screen.x) <= 7 && Math.abs(at.y - screen.y) <= 8) {
        elements["compare-point"].textContent = [`${comparison.name || "Route"} · note`, `${formatGameTime(note.t)} · ${formatDuration(note.t - comparison.start)} since its start`, note.text].join("\n");
        elements["compare-point"].hidden = false;
        return true;
      }
    }
  }
  if (!best) {
    elements["compare-point"].hidden = true;
    return false;
  }
  const { comparison, point } = best;
  const wind = Number.isFinite(point.windFrom) ? `Wind from ${formatBearing(point.windFrom)}${Number.isFinite(point.windKnots) ? ` at ${point.windKnots.toFixed(1)} kn` : ""}` : "";
  const motion = Number.isFinite(point.knots) ? `${Number.isFinite(point.course) ? `${formatBearing(point.course)} at ` : ""}${point.knots.toFixed(1)} kn` : "";
  elements["compare-point"].textContent = [
    comparison.name || "Route",
    `${formatGameTime(point.t)} · ${formatDuration(point.t - comparison.start)} since its start`,
    `${formatCoordinate(point.lat, "lat", 3)} · ${formatCoordinate(point.lon, "lon", 3)}`,
    [motion, point.boat].filter(Boolean).join(" · "),
    wind,
    Number.isFinite(point.hull) ? `Hull damage ${point.hull}%` : ""
  ].filter(Boolean).join("\n");
  elements["compare-point"].hidden = false;
  return true;
}


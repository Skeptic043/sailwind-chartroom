// The Dead reckoning tool's panel. It starts from your latest position, or from a point clicked on the
// chart, and plots where your course, speed and hours sailed put you.
import { createDrPosition, formatCoordinate, parseBearing, revealLayer, shownItems } from "./model.mjs";
import { deadReckon, drSigma, latestPosition, positionLabel } from "./dead-reckoning.mjs";
import { hasTime } from "./track.mjs";
import { formatGameTime, parseDayTime } from "./gametime.mjs";
import { elements, showToast } from "./dom.mjs";
import { activeChart, commit, live, replaceSelectionState } from "./state.mjs";

export const DR_HINT = "Click the chart to choose a starting position. Otherwise, dead reckoning starts from your latest position.";

let active = false;
// A starting point clicked on the chart, or chosen from a DR position's inspector; null for the latest.
// It belongs to the chart it was chosen on and lasts while the tool stays active.
let picked = null;

export function initDeadReckoning() {
  elements["dr-from-latest"].addEventListener("click", () => {
    picked = null;
    renderDeadReckoning();
  });
  elements["dr-plot-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      plotDeadReckoning();
    } catch (error) {
      showToast(error.message, true);
    }
  });
}

// Shows the panel while the Dead reckoning tool is active.
export function showDeadReckoning(isActive) {
  active = isActive;
  if (!active) picked = null;
  elements["dr-panel"].hidden = !active;
  renderDeadReckoning();
}

// Starting from a DR position, from its inspector.
export function reckonFrom(position) {
  pick({ lat: position.lat, lon: position.lon, t: position.t, sigmaNm: position.sigmaNm, label: positionText(position) });
}

function pick(start) {
  picked = { ...start, chartId: activeChart().id };
}

// A click on the chart while the tool is active sets where the next position starts.
export function pickStart(target) {
  const chart = activeChart();
  const at = (item) => item.lat === target.lat && item.lon === target.lon;
  const position = shownItems(chart, "dr").find(at);
  const recorded = shownItems(chart, "track").find(at);
  if (position) reckonFrom(position);
  else if (recorded) pick({ lat: recorded.lat, lon: recorded.lon, t: hasTime(recorded) ? recorded.t : null, sigmaNm: 0, label: "Recorded position" });
  else pick({ lat: target.lat, lon: target.lon, t: null, sigmaNm: 0, label: `${formatCoordinate(target.lat, "lat", 3)} · ${formatCoordinate(target.lon, "lon", 3)}` });
  renderDeadReckoning();
}

function positionText(position) {
  return `${position.label || "DR position"}${position.t !== null ? `, ${formatGameTime(position.t)}` : ""}`;
}

// Where the next DR position starts, while the tool is active, for the panel and the chart's marker.
export function reckoningStart() {
  if (!active) return null;
  if (picked?.chartId === activeChart().id) return picked;
  const position = latestPosition(activeChart(), { followingLive: live.following });
  if (!position) return null;
  return { ...position, label: `Your latest ${positionLabel(position)}${position.t !== null ? `, ${formatGameTime(position.t)}` : ""}` };
}

export function renderDeadReckoning() {
  if (!active) return;
  const chart = activeChart();
  const start = reckoningStart();
  elements["dr-from-label"].textContent = start ? start.label : "No position yet. Click the chart to choose where you are.";
  elements["dr-from-latest"].hidden = picked?.chartId !== chart.id;
  if (!elements["dr-speed"].value) elements["dr-speed"].value = chart.speedKn;
  if (document.activeElement !== elements["dr-percent"]) elements["dr-percent"].value = chart.drPercent;
}

// What a field should hold is part of its error, such as "the speed in knots".
function readNumber(id, what, max) {
  const value = Number(String(elements[id].value).replaceAll(",", "."));
  if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`Enter ${what} from 0 to ${max}.`);
  return value;
}

// Hours as 2.5 or 2:30.
function readHours() {
  const text = elements["dr-hours"].value.trim();
  const clock = /^(\d+):(\d{1,2})$/.exec(text);
  const hours = clock ? Number(clock[1]) + Number(clock[2]) / 60 : Number(text.replaceAll(",", "."));
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("Enter hours sailed above 0, such as 2.5 or 2:30.");
  return hours;
}

// The start's day and time. Both empty takes the start position's own time; a time without a day is
// refused rather than guessed.
function readStartTime(start) {
  const day = elements["dr-day"].value.trim();
  const time = elements["dr-time"].value.trim();
  if (!day && !time) return start.t;
  const t = parseDayTime(day, time);
  if (t === null) throw new Error("Enter both day and time, such as day 12 at 14:30, or leave both blank.");
  return t;
}

function plotDeadReckoning() {
  const start = reckoningStart();
  if (!start) throw new Error("First, click the chart where you are.");
  const course = parseBearing(elements["dr-course"].value);
  const speedKn = readNumber("dr-speed", "the speed in knots", 40);
  const hours = readHours();
  const percent = readNumber("dr-percent", "the error as a percentage", 100);
  const startT = readStartTime(start);
  const end = deadReckon(start, course, speedKn, hours);
  const position = createDrPosition({
    lat: end.lat,
    lon: end.lon,
    t: startT !== null ? startT + hours : null,
    sigmaNm: drSigma(start.sigmaNm, percent, end.nm),
    course,
    speedKn,
    hours,
    percent,
    from: { lat: start.lat, lon: start.lon, label: start.label }
  });
  picked = null;
  for (const id of ["dr-hours", "dr-day", "dr-time"]) elements[id].value = "";
  commit((chart) => {
    chart.drPercent = percent;
    chart.drPositions.push(position);
    revealLayer(chart, "dr", position);
    replaceSelectionState("dr", position.id);
  });
  showToast(`Plotted a DR position after ${end.nm.toFixed(1)} nm. The next one starts here.`);
}

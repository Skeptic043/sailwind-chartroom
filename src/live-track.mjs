// Follows Voyage Recorder or Coordinate Viewer as it records: the desktop host finds or asks for the file,
// watches it and sends each new run of lines.
import { isVoyageRecorderText, parseTrackText, readVoyageRecorder, revealLayer } from "./model.mjs";
import { discoveredMarks, hasMarks, removeAnswered } from "./discoveries.mjs";
import { elements, showToast } from "./dom.mjs";
import { activeChart, appendOutsideHistory, changeOutsideHistory, host, insertOutsideHistory, live, persist, workspace } from "./state.mjs";
import { joinRecording } from "./track.mjs";
import { centerOn } from "./render.mjs";
import { renderEverything } from "./panels.mjs";

// The chart that receives the positions, kept when another chart is opened meanwhile.
let followedChartId = null;
let fileName = "";
let awaitingFirst = false;
// The host's first run of lines is the whole file, which can hold earlier games in the same save slot.
let wholeFile = false;
// Carries a Voyage Recorder session across runs of lines.
const carry = { newSession: false };

export function initLiveTrack() {
  if (!host.liveTrack) return;
  // Voyage Recorder's save slots are offered to choose from; Coordinate Viewer's file is picked directly.
  // While following, the entry that started it stops it and the other is hidden.
  for (const [id, choice] of [["follow-track", {}], ["follow-track-cv", { pick: true }]]) {
    elements[id].hidden = false;
    elements[id].addEventListener("click", () => {
      if (followedChartId) host.stopTrack();
      else host.followTrack(activeChart().id, choice);
    });
  }
  // The host keeps the chart, so a reloaded page carries on into the same one.
  host.on("track-following", ({ name, chartId, resumed }) => {
    followedChartId = String(chartId ?? "");
    live.following = true;
    awaitingFirst = resumed !== true;
    wholeFile = resumed !== true;
    carry.newSession = false;
    carry.game = null;
    fileName = String(name ?? "");
    startedFrom = /\.jsonl$/i.test(fileName) ? "follow-track" : "follow-track-cv";
    renderButton();
    if (resumed !== true) showToast(`Following ${fileName}. New positions join this chart as you sail.`);
  });
  // The host found Voyage Recorder logs: the player picks a save slot, or asks for another file.
  host.on("track-choices", ({ chartId, logs }) => showSlotChoices(String(chartId ?? ""), Array.isArray(logs) ? logs : []));
  elements["slot-form"].addEventListener("submit", () => {
    const chosen = elements["slot-list"].querySelector("input:checked");
    if (chosen) host.followTrack(slotChartId, { log: Number(chosen.value) });
  });
  elements["missing-form"].addEventListener("submit", () => {
    pendingMissing?.();
    pendingMissing = null;
  });
  elements["slot-pick-file"].addEventListener("click", () => {
    elements["slot-dialog"].close();
    host.followTrack(slotChartId, { pick: true });
  });
  host.on("track-stopped", () => {
    followedChartId = null;
    live.following = false;
    renderButton();
    showToast("Stopped following the recording.");
  });
  host.on("track-lines", ({ text }) => addPositions(text));
}

// Live positions stay out of undo, so sailing never buries an edit, and save through the host's
// usual delayed write. The chart redraws once for each batch the host sends.
function addPositions(text) {
  const chart = workspace.charts.find((candidate) => candidate.id === followedChartId);
  // Its chart was deleted, so there is nowhere left to put the positions.
  if (!chart) return host.stopTrack();
  let points;
  let found = { ports: [], missions: [], newGames: 0 };
  // Only the latest game in the whole file joins the chart.
  const firstRun = wholeFile;
  wholeFile = false;
  try {
    if (isVoyageRecorderText(text)) ({ points, ...found } = readVoyageRecorder(text, carry, { latestGame: firstRun }));
    else points = parseTrackText(text, carry);
  } catch {
    return;
  }
  // A new game started in the slot while following carries on in this chart, after a break in the track.
  if (!firstRun && found.newGames) showToast("A new game started in this save slot. Its positions join this chart too.");
  const marks = discoveredMarks(chart, found, { clearReached: workspace.settings.clearReachedAreas });
  if (!points.length && !hasMarks(marks)) return;
  const latest = points.at(-1);
  const first = awaitingFirst && latest;
  if (first) {
    awaitingFirst = false;
    // Following starts on a shown track; hiding it afterwards is left alone.
    revealLayer(chart, "track", latest);
    points = joinFirstRun(chart, points);
  }
  appendOutsideHistory(chart, "track", points);
  addMarks(chart, marks);
  chart.updatedAt = new Date().toISOString();
  persist();
  if (chart !== activeChart()) return;
  renderEverything();
  // The chart opens on where the boat is when following starts.
  if (first) centerOn(latest);
}

// Ports reached and missions read change the chart outside undo, like the positions, and show their layers.
function addMarks(chart, marks) {
  if (!hasMarks(marks)) return;
  const { features, searches, cleared, answered } = marks;
  changeOutsideHistory(chart, (target) => removeAnswered(target, marks));
  appendOutsideHistory(chart, "features", features);
  appendOutsideHistory(chart, "searches", searches);
  for (const feature of features) revealLayer(chart, "feature", feature);
  for (const search of searches) revealLayer(chart, "search", search);
  const names = [...features.map((item) => item.name), ...searches.map((item) => item.label)].filter(Boolean);
  const count = answered.length + cleared.length;
  const resolved = count ? ` Resolved ${count} area${count === 1 ? "" : "s"}.` : "";
  showToast(`From Voyage Recorder: ${names.join(", ") || "nothing new"}.${resolved}`);
}

// The host sends the whole file first. Following carries on from the chart's last position from that
// recording; any positions it missed in between are offered, and the newest shows at once either way.
function joinFirstRun(chart, points) {
  const { fresh, matched } = joinRecording(chart.track, points);
  if (!fresh.length) return [];
  const newest = fresh.at(-1);
  const missing = fresh.slice(0, -1);
  const newestBreaks = newest.newSession === true;
  // Skipped positions leave a gap rather than a line straight across them.
  if (missing.length || !matched) newest.newSession = true;
  if (missing.length) offerMissing(chart, missing, newest, newestBreaks, matched);
  return [newest];
}

function offerMissing(chart, missing, newest, newestBreaks, matched) {
  elements["missing-text"].textContent = matched
    ? `${missing.length} position${missing.length === 1 ? " was" : "s were"} recorded since this chart's last one from ${fileName}. Add ${missing.length === 1 ? "it" : "them"} to the track?`
    : `${fileName} has ${missing.length} earlier position${missing.length === 1 ? "" : "s"} that ${missing.length === 1 ? "isn't" : "aren't"} on this chart. Add ${missing.length === 1 ? "it" : "them"} to the track?`;
  pendingMissing = () => {
    if (!workspace.charts.includes(chart)) return;
    if (!matched) missing[0].newSession = true;
    if (newestBreaks) newest.newSession = true;
    else delete newest.newSession;
    insertOutsideHistory(chart, "track", newest, missing);
    chart.updatedAt = new Date().toISOString();
    persist();
    if (chart === activeChart()) renderEverything();
    showToast(`Added ${missing.length} position${missing.length === 1 ? "" : "s"} to the track.`);
  };
  elements["missing-dialog"].showModal();
}

let pendingMissing = null;
let slotChartId = "";
// The entry that stops following: Voyage Recorder's for its logs, Coordinate Viewer's for any other file,
// also after a reload while the host carries on following.
let startedFrom = "follow-track";

function showSlotChoices(chartId, logs) {
  slotChartId = chartId;
  const list = elements["slot-list"];
  list.replaceChildren(...logs.map((log, index) => {
    const name = String(log.name ?? "");
    const slot = /^slot(\d+)\.jsonl$/i.exec(name);
    const label = document.createElement("label");
    const input = Object.assign(document.createElement("input"), { type: "radio", name: "slot", value: String(log.id), checked: index === 0 });
    const title = Object.assign(document.createElement("strong"), { textContent: slot ? `Save slot ${slot[1]}` : name });
    const where = String(log.place ?? "");
    const detail = Object.assign(document.createElement("span"), { textContent: [where, recordedAgo(log.modified)].filter(Boolean).join(" · ") });
    label.append(input, title, detail);
    return label;
  }));
  elements["slot-dialog"].showModal();
}

// "recorded 5 minutes ago", from the host's ISO time.
function recordedAgo(modified) {
  const minutes = Math.round((Date.now() - Date.parse(modified)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "recorded just now";
  if (minutes < 60) return `recorded ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `recorded ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `recorded ${Math.round(hours / 24)} days ago`;
}

function renderButton() {
  const labels = { "follow-track": "Follow live (Voyage Recorder)", "follow-track-cv": "Follow live (Coordinate Viewer)" };
  for (const [id, label] of Object.entries(labels)) {
    const stopper = Boolean(followedChartId) && id === startedFrom;
    elements[id].textContent = stopper ? `Stop following ${fileName}` : label;
    elements[id].classList.toggle("active", stopper);
    elements[id].hidden = Boolean(followedChartId) && !stopper;
  }
}

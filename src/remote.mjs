// A phone or tablet's side of the phone companion. Every change saved here goes to Chartroom on the PC, which
// sends back everything it changes (hub.mjs). Changes wait here, kept across reloads, until the PC confirms
// them, so a dropped connection loses nothing; when the PC had changed the same thing meanwhile, the player
// chooses which to keep.
import { createShadow, diffWorkspace, receiveOps, resolveConflict } from "./sync.mjs";
import { devicePrefs, withDevicePrefs } from "./host.mjs";
import { elements, showToast } from "./dom.mjs";
import { historyCopies, host, onPersist, persist, resetHistory, settleAfterOutsideChange, workspace } from "./state.mjs";

const QUEUE_KEY = "sailwind-chartroom:device-unsent";
const LISTS = { features: "location", savedRoutes: "saved route", track: "track position", measures: "measurement", winds: "wind", searches: "search area", segments: "line", drPositions: "dead reckoning position", notes: "note", comparisons: "compared voyage" };

let shadow = null;
let unsent = [];
let renderAll = () => {};
const conflicts = [];

export function initRemote({ renderAll: render }) {
  if (!host.device) return;
  renderAll = render;
  shadow = createShadow(workspace);
  try { unsent = JSON.parse(localStorage.getItem(QUEUE_KEY)) ?? []; } catch { unsent = []; }
  elements["storage-note"].textContent = "Charts stay in step with Chartroom on your PC.";
  onPersist(() => queue(diffWorkspace(shadow, workspace)));
  host.on("connection", showConnection);
  host.on("saved", showConnection);
  // Sent on every connection: start again from the PC's charts, then send what is still waiting.
  host.on("workspace", ({ workspace: fresh }) => {
    queue(diffWorkspace(shadow, workspace), { send: false });
    const next = withDevicePrefs(fresh, devicePrefs());
    for (const key of ["charts", "folders", "activeChartId"]) workspace[key] = next[key];
    workspace.settings.recorderKeys = fresh.settings?.recorderKeys ?? null;
    shadow = createShadow(workspace);
    // The charts are new objects, so the undo history no longer belongs to them.
    resetHistory();
    persist();
    renderAll();
    for (const batch of unsent) host.send({ type: "ops", ...batch });
    showConnection();
  });
  host.on("ops", ({ ops }) => {
    if (!Array.isArray(ops)) return;
    const opened = workspace.activeChartId;
    queue(receiveOps(shadow, workspace, ops, { targets: historyCopies }));
    settleAfterOutsideChange(opened);
    persist();
    renderAll();
  });
  host.on("ack", ({ batch, conflicts: found }) => {
    unsent = unsent.filter((entry) => entry.batch !== batch);
    keepUnsent();
    if (Array.isArray(found) && found.length) {
      conflicts.push(...found);
      if (!elements["conflict-dialog"].open) askNext();
    }
    showConnection();
  });
  // Opened on the PC's charts rather than a copy kept here: send what was waiting from before.
  if (host.connected) for (const batch of unsent) host.send({ type: "ops", ...batch });
  elements["conflict-form"].addEventListener("submit", (event) => answer(event.submitter?.value));
  // The PC asks whether to fill in positions missed before following; the first screen to answer decides.
  const missing = elements["missing-dialog"];
  let asked = false;
  host.on("missing", ({ text }) => {
    asked = Boolean(text);
    if (text) {
      elements["missing-text"].textContent = text;
      missing.returnValue = "";
      if (!missing.open) missing.showModal();
    } else if (missing.open) missing.close();
  });
  // Escape or the Back button would answer for everyone, so it waits for a button.
  missing.addEventListener("cancel", (event) => { if (asked) event.preventDefault(); });
  missing.addEventListener("close", () => {
    if (!asked) return;
    asked = false;
    host.send({ type: "missing-answer", add: missing.returnValue === "add" });
  });
  // The question needs an answer; Escape doesn't dismiss it.
  elements["conflict-dialog"].addEventListener("cancel", (event) => event.preventDefault());
}

let counter = 0;
function queue(ops, { send = true } = {}) {
  if (!ops.length) return;
  const batch = { batch: `${Date.now().toString(36)}-${counter += 1}`, ops };
  unsent.push(batch);
  keepUnsent();
  if (send) host.send({ type: "ops", ...batch });
}

function keepUnsent() {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(unsent)); } catch { /* kept in memory until the page closes */ }
}

// The save dot shows whether the PC has everything.
function showConnection() {
  const status = elements["save-status"];
  const waiting = unsent.length > 0;
  const label = !host.connected
    ? "Not connected to Chartroom on your PC. Changes are kept here and sent when it's open again."
    : waiting ? "Sending changes to your PC…" : "In step with Chartroom on your PC";
  status.classList.toggle("failed", !host.connected);
  status.classList.toggle("saving", host.connected && waiting);
  status.title = label;
  status.setAttribute("aria-label", label);
}

function describe({ op }) {
  if (op.op === "field") return { name: "This chart's name", route: "This chart's route", folderId: "This chart's folder" }[op.key] ?? "A detail of this chart";
  if (op.op === "folders") return "The chart folders";
  const item = op.item ?? op.base ?? {};
  const name = String(item.name ?? item.label ?? item.text ?? "").trim().slice(0, 40);
  const kind = LISTS[op.list] ?? "item";
  return name ? `The ${kind} “${name}”` : `A ${kind}`;
}

// One conflict at a time. The buttons depend on what happened to the PC's copy.
function askNext() {
  const conflict = conflicts[0];
  if (!conflict) return;
  const what = describe(conflict);
  // Only an item can have been deleted; a value the PC cleared is just a different value.
  const deleted = conflict.current === null && conflict.op.op === "put";
  const removing = conflict.op.op === "remove";
  elements["conflict-text"].textContent = deleted
    ? `${what} was deleted on your PC while you changed it here. Restore it, or delete it here too?`
    : removing ? `${what} was changed on your PC, so it wasn't deleted. Keep it, or delete it in both places?`
      : `${what} was changed on your PC while you changed it here. Which version should both keep?`;
  // The answer that keeps something is the highlighted one, so a stray tap never deletes.
  const choices = deleted ? [["theirs", "Delete"], ["mine", "Restore", true]]
    : removing ? [["mine", "Delete"], ["theirs", "Keep", true]]
      : [["theirs", "Keep PC version"], ...(conflict.op.op === "put" ? [["both", "Keep both"]] : []), ["mine", "Keep this version", true]];
  elements["conflict-actions"].replaceChildren(...choices.map(([value, label, primary]) =>
    Object.assign(document.createElement("button"), { type: "submit", value, textContent: label, className: primary ? "primary" : "" })));
  elements["conflict-dialog"].showModal();
}

function answer(choice) {
  const conflict = conflicts.shift();
  if (!conflict || !choice) return;
  const { send, local } = resolveConflict(conflict, choice);
  if (local.length) {
    const opened = workspace.activeChartId;
    queue(receiveOps(shadow, workspace, local, { targets: historyCopies }));
    settleAfterOutsideChange(opened);
  }
  queue(send);
  persist();
  renderAll();
  if (choice === "both") showToast("Kept both. The copy from here is next to the PC's.");
  // The next question opens once this dialog has closed.
  setTimeout(askNext, 0);
}

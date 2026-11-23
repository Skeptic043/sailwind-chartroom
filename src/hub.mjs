// The desktop's side of the phone companion. Phones and tablets on the player's network send their chart
// changes here through the host; this page applies them, and every change it saves, from the player, a device
// or a recording, goes out to all connected devices (sync.mjs).
import { applyOps, createShadow, diffWorkspace } from "./sync.mjs";
import { historyCopies, host, onPersist, persist, settleAfterOutsideChange, workspace } from "./state.mjs";
import { answerMissing, declineMissing, onMissingAsked } from "./live-track.mjs";

// What the devices last received. Only kept while at least one is connected.
let shadow = null;
const connected = new Set();
// Batches already applied, so one a device sends again after a lost answer isn't applied twice.
const applied = [];
const APPLIED_KEPT = 500;
// The missing-positions question while it waits for an answer, asked on every device too.
let missingQuestion = null;

export function initHub({ renderAll }) {
  if (!host.devices) return;
  onPersist(broadcast);
  onMissingAsked((text) => {
    missingQuestion = text;
    for (const deviceId of connected) host.syncSend(deviceId, { type: "missing", text });
  });
  host.on("device-joined", ({ deviceId }) => {
    // The others get anything not yet sent first, so the newcomer's copy and theirs match.
    if (connected.size) broadcast();
    else shadow = createShadow(workspace);
    connected.add(deviceId);
    host.syncSend(deviceId, { type: "workspace", workspace, version: host.version });
    if (missingQuestion) host.syncSend(deviceId, { type: "missing", text: missingQuestion });
  });
  host.on("device-left", ({ deviceId }) => {
    connected.delete(deviceId);
    if (!connected.size) shadow = null;
  });
  host.on("device-message", ({ deviceId, message }) => {
    if (!connected.has(deviceId)) return;
    if (message?.type === "missing-answer") return message.add === true ? answerMissing() : declineMissing();
    if (message?.type !== "ops" || !Array.isArray(message.ops)) return;
    const id = `${deviceId}:${message.batch}`;
    if (applied.includes(id)) return host.syncSend(deviceId, { type: "ack", batch: message.batch, conflicts: [] });
    applied.push(id);
    if (applied.length > APPLIED_KEPT) applied.shift();
    const opened = workspace.activeChartId;
    const { conflicts } = applyOps(workspace, message.ops, { check: true, targets: historyCopies });
    const now = new Date().toISOString();
    const changed = new Set(message.ops.map((op) => op?.chartId ?? op?.chart?.id));
    for (const chart of workspace.charts) if (changed.has(chart.id)) chart.updatedAt = now;
    settleAfterOutsideChange(opened);
    persist();
    renderAll();
    // The answer comes after the changes it caused, so the device has them when it hears its batch arrived.
    host.syncSend(deviceId, { type: "ack", batch: message.batch, conflicts });
  });
}

function broadcast() {
  if (!shadow) return;
  const ops = diffWorkspace(shadow, workspace);
  if (ops.length) host.syncBroadcast(ops);
}

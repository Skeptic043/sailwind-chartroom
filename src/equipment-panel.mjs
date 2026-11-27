// The Equipment section of the chart tools: the per-chart switch for equipment readings, vanilla and
// optional modded instruments, Realistic Skies difficulty selection, live summary of unlocked readings,
// and a scrollable popout dialog for saved change history.
import {
  EQUIPMENT_MODS,
  INSTRUMENTS,
  REALISTIC_SKIES_DIFFICULTIES,
  difficultyLabel,
  instrumentLabel,
  instrumentsAt,
  removeEquipmentChange,
  setEquipmentMods,
  setInstruments,
  setRealisticSkiesDifficulty,
  summarizeKnowledge,
  unavailableInstruments
} from "./equipment.mjs";
import { formatGameTime } from "./gametime.mjs";
import { elements } from "./dom.mjs";
import { activeChart, commit } from "./state.mjs";

const VANILLA_INSTRUMENTS = INSTRUMENTS.filter((instrument) => instrument.mod === null);

export function initEquipment() {
  elements["equipment-items"].replaceChildren(...VANILLA_INSTRUMENTS.map(makeInstrumentRow));
  elements["equipment-mods"].replaceChildren(...EQUIPMENT_MODS.map(({ id, label, note }) => {
    const row = document.createElement("label");
    row.title = note;
    const box = Object.assign(document.createElement("input"), { type: "checkbox", value: id });
    row.append(box, document.createTextNode(label));
    return row;
  }));

  elements["rs-difficulty-list"].replaceChildren(...REALISTIC_SKIES_DIFFICULTIES.map(({ id, label, note }) => {
    const row = document.createElement("label");
    const radio = Object.assign(document.createElement("input"), { type: "radio", name: "rs-difficulty", value: id });
    const text = document.createElement("div");
    text.style.display = "grid";
    const title = Object.assign(document.createElement("strong"), { textContent: label });
    const detail = Object.assign(document.createElement("span"), { textContent: note });
    text.append(title, detail);
    row.append(radio, text);
    return row;
  }));

  elements["equipment-enabled"].addEventListener("change", (event) => {
    commit((chart) => { chart.equipment.enabled = event.target.checked; });
  });

  const onInstrumentChange = () => {
    const items = [
      ...elements["equipment-items"].querySelectorAll("input:checked:not(:disabled)"),
      ...elements["equipment-mod-groups"].querySelectorAll("input:checked:not(:disabled)")
    ].map((box) => box.value);
    commit((chart) => setInstruments(chart.equipment, items, latestTime(chart), true));
  };
  elements["equipment-items"].addEventListener("change", onInstrumentChange);
  elements["equipment-mod-groups"].addEventListener("change", onInstrumentChange);

  elements["equipment-mods"].addEventListener("change", (event) => {
    const mods = [...elements["equipment-mods"].querySelectorAll("input:checked")].map((box) => box.value);
    const turnedOnRealisticSkies = event.target?.value === "realistic-skies" && event.target.checked;
    commit((chart) => setEquipmentMods(chart.equipment, mods));
    if (turnedOnRealisticSkies) openRealisticSkiesDialog();
  });

  elements["rs-difficulty-form"].addEventListener("submit", () => {
    const chosen = elements["rs-difficulty-list"].querySelector("input:checked");
    if (chosen) commit((chart) => setRealisticSkiesDifficulty(chart.equipment, chosen.value));
  });

  elements["equipment-history-open"].addEventListener("click", () => {
    renderEquipmentHistory();
    if (!elements["equipment-history-dialog"].open) elements["equipment-history-dialog"].showModal();
  });

  elements["equipment-history"].addEventListener("click", (event) => {
    const button = event.target.closest("button[data-remove-change]");
    if (!button) return;
    const index = Number(button.dataset.removeChange);
    commit((chart) => removeEquipmentChange(chart.equipment, index));
  });
}

function openRealisticSkiesDialog() {
  const current = activeChart().equipment.rsDifficulty ?? "chronometers";
  for (const radio of elements["rs-difficulty-list"].querySelectorAll("input")) {
    radio.checked = radio.value === current;
  }
  if (!elements["rs-difficulty-dialog"].open) elements["rs-difficulty-dialog"].showModal();
}

function makeInstrumentRow({ id, label, note }) {
  const row = document.createElement("label");
  if (note) row.title = note;
  const box = Object.assign(document.createElement("input"), { type: "checkbox", value: id });
  row.append(box, document.createTextNode(label));
  return row;
}

function latestTime(chart) {
  return chart.track.findLast((point) => Number.isFinite(point.t))?.t ?? null;
}

function formatChangeTime(t) {
  return Number.isFinite(t) ? formatGameTime(t) : "Start of chart";
}

function applyAvailability(row, box, instrument, disabled, unavailable, rsDifficulty) {
  const blocked = unavailable.has(instrument.id);
  box.disabled = disabled || blocked;
  row.classList.toggle("unavailable", blocked);
  if (blocked) {
    const reason = rsDifficulty === "magellan"
      ? "Not available in Realistic Skies Magellan difficulty"
      : "Requires seasons (not available in Realistic Skies Vanilla difficulty)";
    row.title = reason;
  } else {
    row.title = instrument.note ?? "";
  }
}

export function renderEquipment() {
  const chart = activeChart();
  const { equipment } = chart;
  const current = instrumentsAt(equipment, null);
  const enabledMods = new Set(equipment.mods ?? []);
  const unavailable = unavailableInstruments(equipment);
  const rsDifficulty = equipment.rsDifficulty ?? "chronometers";
  const disabled = !equipment.enabled;

  elements["equipment-enabled"].checked = equipment.enabled;
  elements["equipment-state"].textContent = equipment.enabled ? "On" : "Off";
  elements["equipment-summary"].textContent = summarizeKnowledge(equipment);

  const latest = latestTime(chart);
  elements["equipment-hint"].textContent = equipment.enabled
    ? (latest === null ? "Changes apply from the start of the chart." : `New changes apply from ${formatChangeTime(latest)} onward.`)
    : "Turn on to hide recorded readings your instruments could not have taken.";

  for (const row of elements["equipment-items"].querySelectorAll("label")) {
    const box = row.querySelector("input");
    const instrument = VANILLA_INSTRUMENTS.find((item) => item.id === box.value);
    box.checked = current.has(box.value) && !unavailable.has(box.value);
    if (instrument) applyAvailability(row, box, instrument, disabled, unavailable, rsDifficulty);
  }

  for (const box of elements["equipment-mods"].querySelectorAll("input")) {
    box.checked = enabledMods.has(box.value);
    box.disabled = disabled;
  }

  const modGroups = [];
  for (const mod of EQUIPMENT_MODS) {
    if (!enabledMods.has(mod.id)) continue;
    const group = document.createElement("div");
    group.className = "equipment-mod-group";
    const header = document.createElement("div");
    header.className = "equipment-group-header";
    const heading = Object.assign(document.createElement("div"), { className: "equipment-group-title", textContent: mod.label });
    header.append(heading);
    if (mod.id === "realistic-skies") {
      const diffBtn = Object.assign(document.createElement("button"), {
        type: "button",
        className: "equipment-diff-button",
        textContent: difficultyLabel(rsDifficulty).replace(" (default)", ""),
        title: "Change Realistic Skies difficulty",
        disabled
      });
      diffBtn.addEventListener("click", openRealisticSkiesDialog);
      header.append(diffBtn);
    }
    const grid = Object.assign(document.createElement("div"), { className: "equipment-items" });
    for (const instrument of INSTRUMENTS.filter((item) => item.mod === mod.id)) {
      const row = makeInstrumentRow(instrument);
      const box = row.querySelector("input");
      box.checked = current.has(instrument.id) && !unavailable.has(instrument.id);
      applyAvailability(row, box, instrument, disabled, unavailable, rsDifficulty);
      grid.append(row);
    }
    group.append(header, grid);
    modGroups.push(group);
  }
  elements["equipment-mod-groups"].replaceChildren(...modGroups);
  elements["equipment-mod-groups"].hidden = modGroups.length === 0;

  const changes = equipment.changes ?? [];
  elements["equipment-history-open"].hidden = changes.length === 0;
  elements["equipment-history-open"].textContent = `History (${changes.length})`;
  if (elements["equipment-history-dialog"].open) renderEquipmentHistory();
}

function renderEquipmentHistory() {
  const { equipment } = activeChart();
  const changes = equipment.changes ?? [];
  const disabled = !equipment.enabled;
  if (!changes.length) {
    elements["equipment-history"].replaceChildren(Object.assign(document.createElement("p"), {
      className: "fineprint",
      textContent: "No equipment changes recorded on this chart."
    }));
    return;
  }
  elements["equipment-history"].replaceChildren(...changes.map((change, index) => {
    const row = document.createElement("div");
    row.className = "equipment-history-row";
    const info = document.createElement("div");
    const whenText = formatChangeTime(change.t);
    const when = Object.assign(document.createElement("strong"), { textContent: whenText });
    const list = Object.assign(document.createElement("span"), {
      textContent: change.items.length ? change.items.map(instrumentLabel).join(", ") : "No instruments"
    });
    info.append(when, list);
    const remove = Object.assign(document.createElement("button"), {
      type: "button",
      textContent: "Remove",
      ariaLabel: `Remove equipment change at ${whenText}`,
      disabled
    });
    remove.dataset.removeChange = String(index);
    row.append(info, remove);
    return row;
  }));
}

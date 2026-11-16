// The Equipment section of the chart tools: the per-chart switch for equipment readings and the instruments
// the player has. Ticking or unticking an instrument applies from the latest recorded position onward.
import { INSTRUMENTS, instrumentsAt, setInstruments } from "./equipment.mjs";
import { elements } from "./dom.mjs";
import { activeChart, commit } from "./state.mjs";

export function initEquipment() {
  elements["equipment-items"].replaceChildren(...INSTRUMENTS.map(({ id, label }) => {
    const row = document.createElement("label");
    const box = Object.assign(document.createElement("input"), { type: "checkbox", value: id });
    row.append(box, document.createTextNode(label));
    return row;
  }));
  elements["equipment-enabled"].addEventListener("change", (event) => {
    commit((chart) => { chart.equipment.enabled = event.target.checked; });
  });
  elements["equipment-items"].addEventListener("change", () => {
    const items = [...elements["equipment-items"].querySelectorAll("input:checked")].map((box) => box.value);
    commit((chart) => setInstruments(chart.equipment, items, latestTime(chart)));
  });
}

function latestTime(chart) {
  return chart.track.findLast((point) => Number.isFinite(point.t))?.t ?? null;
}

export function renderEquipment() {
  const { equipment } = activeChart();
  const current = instrumentsAt(equipment, null);
  elements["equipment-enabled"].checked = equipment.enabled;
  elements["equipment-state"].textContent = equipment.enabled ? "On" : "Off";
  for (const box of elements["equipment-items"].querySelectorAll("input")) {
    box.checked = current.has(box.value);
    box.disabled = !equipment.enabled;
  }
}

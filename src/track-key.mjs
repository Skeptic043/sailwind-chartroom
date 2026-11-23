// The track key: a small panel over the chart explaining each mark a recorded track can show, drawn in the
// chart's own colours. The Key button beside Tools and Items, or View > Track key, shows and hides it, and its
// heading drags it; both are remembered with the other settings.
import { elements } from "./dom.mjs";
import { persist, workspace } from "./state.mjs";
import { makeFloating, placeFloating } from "./overlay.mjs";

const svg = (body) => `<svg viewBox="0 0 40 14" width="40" height="14" aria-hidden="true" focusable="false">${body}</svg>`;
const pole = `<path d="M17 13V1" stroke="var(--map-ink)" stroke-width="1.4"/>`;
// The same shapes as the chart's race flags: plain, pennant and chequered.
const FLAGS = Object.freeze({
  start: svg(`${pole}<rect x="17" y="1" width="9" height="6" fill="var(--map-line-green)"/>`),
  checkpoint: svg(`${pole}<path d="M17 1l9 3-9 3z" fill="var(--map-accent)"/>`),
  finish: svg(`${pole}<rect x="17" y="1" width="9" height="6" fill="var(--map-line-red)"/><path d="M20 1h3v3h-3zM17 4h3v3h-3zM23 4h3v3h-3z" fill="var(--map-paper-b)"/>`)
});

// Each row: a sample drawn like the chart draws it, and what it means.
const ROWS = Object.freeze([
  [svg(`<path d="M2 7h36" stroke="var(--map-track)" stroke-width="1.6" stroke-dasharray="3 5"/>`), "Your recorded track"],
  [svg(`<circle cx="20" cy="7" r="2.8" fill="var(--map-track)"/>`), "A recorded position by day"],
  [svg(`<circle cx="20" cy="7" r="2.2" fill="var(--map-paper-a)" stroke="var(--map-night)" stroke-width="1.4"/>`), "A recorded position at night"],
  [svg(`<path d="M5 7h27" stroke="var(--wind)" stroke-width="1.8" stroke-linecap="round"/><path d="M36 7l-9-5 3 5-3 5z" fill="var(--wind)"/>`), "Wind direction"],
  [svg(`<path d="M2 7h36" stroke="var(--map-track)" stroke-width="1.6" stroke-dasharray="3 5"/><circle cx="20" cy="7" r="2.2" fill="var(--map-track)"/><circle cx="20" cy="7" r="5" fill="none" stroke="var(--map-track)" stroke-width="1.3"/>`), "Manually connected track"],
  [FLAGS.start, "Race start"],
  [FLAGS.checkpoint, "Race checkpoint"],
  [FLAGS.finish, "Race finish"]
]);

export function initTrackKey() {
  elements["layer-track-key"].addEventListener("change", (event) => setShown(event.target.checked));
  elements["show-track-key"].addEventListener("click", () => setShown(workspace.settings.trackKey !== true));
  makeFloating(elements["track-key"], elements["track-key-heading"], () => workspace.settings.trackKeyPanel);
  elements["track-key-rows"].innerHTML = ROWS.map(([sample, meaning]) => `<tr><td>${sample}</td><td></td></tr>`).join("");
  // Meanings go in as text, so nothing in them is read as markup.
  [...elements["track-key-rows"].querySelectorAll("td:last-child")].forEach((cell, index) => { cell.textContent = ROWS[index][1]; });
}

function setShown(shown) {
  workspace.settings.trackKey = shown;
  persist();
  renderTrackKey();
}

export function renderTrackKey() {
  const shown = workspace.settings.trackKey === true;
  elements["layer-track-key"].checked = shown;
  elements["show-track-key"].setAttribute("aria-pressed", String(shown));
  elements["track-key"].hidden = !shown;
  placeFloating(elements["track-key"], workspace.settings.trackKeyPanel);
}

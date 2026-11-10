// Sidebar visibility and widths.
import { clamp } from "./format.mjs";
import { elements } from "./dom.mjs";
import { persist, workspace } from "./state.mjs";
import { resizeCanvas } from "./render.mjs";

let resizeFrame = null;

let panelResize = null;

function panelWidths() {
  const layout = workspace.layout;
  let left = layout.leftWidth;
  let right = layout.rightWidth;
  if (layout.leftOpen && layout.rightOpen && window.innerWidth > 860) {
    const available = Math.max(380, window.innerWidth - 420);
    if (left + right > available) {
      left = clamp(available * left / (left + right), 190, available - 190);
      right = available - left;
    }
  }
  return { left, right };
}

export function applyLayout() {
  const layout = workspace.layout;
  const widths = panelWidths();
  document.body.style.setProperty("--left-panel-width", `${widths.left}px`);
  document.body.style.setProperty("--right-panel-width", `${widths.right}px`);
  document.body.classList.toggle("left-panel-hidden", !layout.leftOpen);
  document.body.classList.toggle("right-panel-hidden", !layout.rightOpen);
  for (const side of ["left", "right"]) {
    const open = layout[`${side}Open`];
    const button = elements[`toggle-${side}-panel`];
    const label = `${open ? "Hide" : "Show"} chart ${side === "left" ? "tools" : "items"}`;
    button.classList.toggle("active", !open);
    button.setAttribute("aria-pressed", String(!open));
    button.title = label;
    button.setAttribute("aria-label", label);
    button.textContent = label;
    const resizer = elements[`${side}-panel-resizer`];
    resizer.setAttribute("aria-valuemin", "190");
    resizer.setAttribute("aria-valuemax", String(Math.round(panelMaxWidth(side))));
    resizer.setAttribute("aria-valuenow", String(Math.round(widths[side])));
  }
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(resizeCanvas);
}

export function togglePanel(side) {
  workspace.layout[`${side}Open`] = !workspace.layout[`${side}Open`];
  applyLayout();
  persist();
}

function panelMaxWidth(side) {
  const other = side === "left" ? "right" : "left";
  const otherWidth = workspace.layout[`${other}Open`] ? panelWidths()[other] : 0;
  return Math.max(190, Math.min(480, window.innerWidth - otherWidth - 420));
}

function setPanelWidth(side, width, save = false) {
  workspace.layout[`${side}Width`] = clamp(width, 190, panelMaxWidth(side));
  applyLayout();
  if (save) persist();
}

export function startPanelResize(side, event) {
  if (event.button !== 0 || !workspace.layout[`${side}Open`]) return;
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  panelResize = { side, pointerId: event.pointerId, startX: event.clientX, startWidth: panelWidths()[side] };
  document.body.classList.add("resizing-panels");
}

export function movePanelResize(event) {
  if (!panelResize || panelResize.pointerId !== event.pointerId) return;
  const direction = panelResize.side === "left" ? 1 : -1;
  setPanelWidth(panelResize.side, panelResize.startWidth + direction * (event.clientX - panelResize.startX));
}

export function endPanelResize(event) {
  if (!panelResize || panelResize.pointerId !== event.pointerId) return;
  panelResize = null;
  document.body.classList.remove("resizing-panels");
  persist();
}

export function resizePanelFromKeyboard(side, event) {
  const outward = side === "left" ? "ArrowRight" : "ArrowLeft";
  const inward = side === "left" ? "ArrowLeft" : "ArrowRight";
  if (event.key !== outward && event.key !== inward) return;
  event.preventDefault();
  setPanelWidth(side, panelWidths()[side] + (event.key === outward ? 20 : -20), true);
}

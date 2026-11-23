// Phones and tablets: which layout the page takes on a touch screen, the few controls that layout adds, and
// turning fingers on the chart into what the mouse does. A tap is a click, one finger dragging is a mouse
// drag, two fingers always pinch and pan, and a long press places without snapping, like holding Ctrl.
import { canvas, elements, showToast } from "./dom.mjs";
import { activeChart, input, live, persist, redo, selectItem, undo } from "./state.mjs";
import { centerOn, drawChart } from "./render.mjs";
import { eventPoint } from "./viewport.mjs";
import { cancelPointer, endPointer, mode, movePointer, panBy, setMode, startPointer, zoomAround } from "./interaction.mjs";

const LONG_PRESS_MS = 500;
// A finger moving less than this is still a tap or a long press.
const TAP_SLOP_PX = 8;

export function initTouch() {
  initLayout();
  initPointers();
  initControls();
}

// The mobile layouts are for touch screens only, so a narrow desktop window keeps its own. A phone is told
// from a tablet by its shorter side, so one turned sideways stays a phone. A convertible switches layout
// when it switches mode.
function initLayout() {
  const coarse = matchMedia("(pointer: coarse)");
  const leftPanel = document.querySelector(".left-panel");
  const items = document.querySelector(".right-panel .locations-section");
  const inspector = document.getElementById("inspector-host");
  const equipment = document.getElementById("equipment-panel");
  const status = elements["save-status"];
  const update = () => {
    const touch = coarse.matches;
    const phone = touch && Math.min(innerWidth, innerHeight) < 600;
    const body = document.body.classList;
    const changed = body.contains("touch") !== touch;
    body.toggle("touch", touch);
    body.toggle("phone", phone);
    body.toggle("tablet", touch && !phone);
    body.toggle("landscape", innerWidth > innerHeight);
    if (!changed) return;
    // On a touch screen the inspector and the Equipment panel move into the sheet, beside the chart items.
    equipment.classList.toggle("equipment-section", touch);
    if (touch) items.before(inspector, equipment);
    else leftPanel.append(equipment, inspector);
    // The save dot doubles as the connection button, which says what it shows when tapped.
    if (touch) {
      status.setAttribute("role", "button");
      status.tabIndex = 0;
    } else {
      status.setAttribute("role", "img");
      status.removeAttribute("tabindex");
    }
  };
  update();
  addEventListener("resize", update);
  coarse.addEventListener("change", update);
}

// What the page's pointer handlers need from an event, for a finger's action passed on late or as a tap.
function asEvent(event, free) {
  return { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, button: 0, shiftKey: false, ctrlKey: false, altKey: false, pointerType: "touch", free };
}

function initPointers() {
  const fingers = new Map();
  let pinch = null;
  const middle = (a, b) => ({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });
  const spread = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  // A finger's action waits until it moves, lifts or is held, so a second finger can still turn it into a pinch.
  const begin = (finger) => {
    clearTimeout(finger.timer);
    finger.started = true;
    startPointer(asEvent(finger.down, finger.free));
  };

  canvas.addEventListener("pointerdown", (event) => {
    input.touch = event.pointerType === "touch";
    if (!input.touch) return startPointer(event);
    // A first finger starts afresh, even if a dialog swallowed an earlier finger's lift.
    if (event.isPrimary) {
      for (const stale of fingers.values()) clearTimeout(stale.timer);
      fingers.clear();
      pinch = null;
    }
    const finger = { down: event, last: event, free: false, started: false, ignored: false };
    fingers.set(event.pointerId, finger);
    try { canvas.setPointerCapture(event.pointerId); } catch { /* the finger already lifted */ }
    if (fingers.size === 2) {
      // The first finger's action, if it had begun, ends where it is; then both fingers pinch.
      for (const other of fingers.values()) {
        clearTimeout(other.timer);
        // A drag the first finger had begun is dropped, so a pinch never leaves a stray area or wind.
        if (other.started && !other.ignored) cancelPointer();
        other.started = true;
        other.ignored = true;
      }
      const [a, b] = [...fingers.values()].map((entry) => entry.last);
      pinch = { centre: eventPoint(middle(a, b)), spread: spread(a, b) };
      return;
    }
    if (fingers.size > 2) {
      finger.ignored = true;
      finger.started = true;
      return;
    }
    finger.timer = setTimeout(() => {
      finger.free = true;
      navigator.vibrate?.(20);
    }, LONG_PRESS_MS);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "touch") {
      input.touch = false;
      return movePointer(event);
    }
    const finger = fingers.get(event.pointerId);
    if (!finger) return;
    finger.last = event;
    if (pinch && fingers.size === 2) {
      const [a, b] = [...fingers.values()].map((entry) => entry.last);
      const centre = eventPoint(middle(a, b));
      const now = spread(a, b);
      if (pinch.spread > 0 && now > 0) zoomAround(centre, now / pinch.spread);
      panBy(centre.x - pinch.centre.x, centre.y - pinch.centre.y);
      pinch = { centre, spread: now };
      drawChart();
      return;
    }
    if (finger.ignored) return;
    if (!finger.started) {
      if (Math.hypot(event.clientX - finger.down.clientX, event.clientY - finger.down.clientY) < TAP_SLOP_PX) return;
      begin(finger);
    }
    movePointer(asEvent(event, finger.free));
  });

  const lift = (event) => {
    if (event.pointerType !== "touch") return endPointer(event);
    const finger = fingers.get(event.pointerId);
    if (!finger) return;
    fingers.delete(event.pointerId);
    clearTimeout(finger.timer);
    if (pinch) {
      if (fingers.size < 2) {
        pinch = null;
        persist();
      } else if (fingers.size === 2) {
        // Of three fingers one lifted: the other two carry on pinching from where they are.
        const [a, b] = [...fingers.values()].map((entry) => entry.last);
        pinch = { centre: eventPoint(middle(a, b)), spread: spread(a, b) };
      }
      return;
    }
    if (finger.ignored) return;
    if (!finger.started) {
      // A tap that was cancelled, as when the browser took the gesture, does nothing.
      if (event.type !== "pointerup") return;
      // A tap shows where it landed, as hovering does, then clicks.
      movePointer(asEvent(finger.down, finger.free));
      begin(finger);
    }
    endPointer(asEvent(event, finger.free));
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);
}

function initControls() {
  const body = document.body.classList;

  // The phone's top bar: the menus as one sheet, and the chart picker, undo and redo from inside them.
  elements["touch-menu"].addEventListener("click", () => {
    const open = body.toggle("menu-open");
    elements["touch-menu"].setAttribute("aria-expanded", String(open));
    for (const menu of document.querySelectorAll(".app-menu")) menu.open = open;
  });
  document.querySelector(".menu-bar").addEventListener("click", (event) => {
    if (event.target.closest(".menu-popover button")) closeMenuSheet();
  });
  canvas.addEventListener("pointerdown", closeMenuSheet);
  const charts = elements["chart-select"];
  const mirror = elements["touch-chart-select"];
  const copyCharts = () => {
    mirror.replaceChildren(...[...charts.children].map((child) => child.cloneNode(true)));
    mirror.value = charts.value;
  };
  new MutationObserver(copyCharts).observe(charts, { childList: true, subtree: true });
  copyCharts();
  mirror.addEventListener("change", () => {
    charts.value = mirror.value;
    charts.dispatchEvent(new Event("change"));
  });
  elements["touch-undo"].addEventListener("click", undo);
  elements["touch-redo"].addEventListener("click", redo);
  const copyUndo = () => {
    elements["touch-undo"].disabled = elements.undo.disabled;
    elements["touch-redo"].disabled = elements.redo.disabled;
  };
  for (const id of ["undo", "redo"]) new MutationObserver(copyUndo).observe(elements[id], { attributes: true, attributeFilter: ["disabled"] });
  copyUndo();

  const status = elements["save-status"];
  status.addEventListener("click", () => { if (body.contains("touch")) showToast(status.title); });

  // The Items panel opens as a sheet over the chart, as the inspector does when something is selected.
  elements["touch-items"].addEventListener("click", () => {
    const open = body.toggle("panels-open");
    elements["touch-items"].setAttribute("aria-pressed", String(open));
    if (!open) body.remove("sheet-full");
  });
  elements["sheet-close"].addEventListener("click", () => {
    body.remove("sheet-full");
    if (body.contains("panels-open")) {
      body.remove("panels-open");
      elements["touch-items"].setAttribute("aria-pressed", "false");
    } else {
      selectItem(null, null);
    }
  });
  elements["sheet-size"].addEventListener("click", () => {
    const full = body.toggle("sheet-full");
    elements["sheet-size"].setAttribute("aria-expanded", String(full));
  });
  // Typing in a half-height sheet would put the field under the keyboard, so the sheet grows first.
  document.querySelector(".right-panel").addEventListener("focusin", (event) => {
    if (body.contains("phone") && event.target.matches("input:not([type=checkbox]), textarea, select")) body.add("sheet-full");
  });

  // Tools that wait for more taps end with Done, in place of Escape or right-click.
  const done = elements["tool-done"];
  const showDone = () => { done.hidden = mode === "select"; };
  new MutationObserver(showDone).observe(document.querySelector(".tool-grid"), { attributes: true, subtree: true, attributeFilter: ["class"] });
  new MutationObserver(showDone).observe(canvas, { attributes: true, attributeFilter: ["class"] });
  done.addEventListener("click", () => setMode("select"));
  showDone();

  // On a phone the route card is a chip until its heading is tapped.
  document.getElementById("route-summary-heading").addEventListener("click", () => {
    if (body.contains("phone")) document.getElementById("route-summary").classList.toggle("expanded");
  });

  // While following, a chip names the recording; tapping it brings the boat into view.
  const chip = elements["follow-chip"];
  const showFollowing = () => {
    const stopper = [elements["follow-track"], elements["follow-track-cv"]].find((button) => button.classList.contains("active"));
    chip.hidden = !live.following || !stopper;
    if (stopper) chip.textContent = stopper.textContent.replace(/^Stop following /, "Following ");
  };
  for (const id of ["follow-track", "follow-track-cv"]) new MutationObserver(showFollowing).observe(elements[id], { attributes: true, childList: true, characterData: true, subtree: true });
  chip.addEventListener("click", () => {
    const latest = activeChart().track.at(-1);
    if (latest) centerOn(latest);
  });
}

function closeMenuSheet() {
  if (!document.body.classList.contains("menu-open")) return;
  document.body.classList.remove("menu-open");
  for (const menu of document.querySelectorAll(".app-menu")) menu.open = false;
  elements["touch-menu"].setAttribute("aria-expanded", "false");
}

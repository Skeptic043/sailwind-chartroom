// Owns the active look. The colours live in styles.css; this module picks the theme and light or dark mode,
// reads the chart canvas colours from the stylesheet, and loads the Sailwind paper tile for the canvas.

export const THEMES = Object.freeze([
  { id: "chartroom", label: "Chartroom" },
  { id: "sailwind", label: "Sailwind paper" }
]);
export const APPEARANCES = Object.freeze([
  { id: "system", label: "Match Windows" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" }
]);

const darkQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
let palette = null;
let sheet = null;
let sheetLoaded = () => {};
let current = { theme: "chartroom", dark: true };

/** Applies the theme and mode to the page and returns whether the result is dark. */
export function applyTheme({ theme, appearance }) {
  const dark = appearance === "dark" || (appearance !== "light" && (darkQuery?.matches ?? true));
  const root = document.documentElement;
  root.dataset.theme = THEMES.some((entry) => entry.id === theme) ? theme : "chartroom";
  root.dataset.mode = dark ? "dark" : "light";
  current = { theme: root.dataset.theme, dark };
  palette = readPalette(getComputedStyle(root));
  sheet = null;
  if (palette.texture > 0) {
    const wanted = { ...current };
    const image = new Image();
    image.onload = () => {
      // A later theme change may have replaced this one while it loaded.
      if (current.theme !== wanted.theme || current.dark !== wanted.dark) return;
      sheet = image;
      sheetLoaded();
    };
    image.src = `assets/sailwind/paper-${dark ? "dark" : "light"}.jpg`;
  }
  return dark;
}

/** Calls back when the paper tile has loaded, so the chart can redraw with it. */
export function onSheetLoaded(callback) {
  sheetLoaded = callback;
}

/** Calls back whenever Windows switches between light and dark. */
export function onSystemAppearanceChange(callback) {
  darkQuery?.addEventListener("change", callback);
}

export function isDark() {
  return current.dark;
}

/** The chart canvas colours for the active theme. */
export function mapPalette() {
  return palette;
}

/** The seamless paper tile the Sailwind theme repeats under the chart, or null. */
export function paperTile() {
  return sheet;
}

function readPalette(style) {
  const value = (name) => style.getPropertyValue(`--map-${name}`).trim();
  return Object.freeze({
    paperA: value("paper-a"), paperB: value("paper-b"), grid: value("grid"), fine: value("fine"), ink: value("ink"),
    faded: value("faded"), route: value("route"), track: value("track"), night: value("night"), bearing: value("bearing"),
    searchRgb: value("search-rgb"), accent: value("accent"), select: value("select"), areaFill: value("area-fill"),
    boat: value("boat"), boatFill: value("boat-fill"), boatSail: value("boat-sail"),
    boatSelected: value("boat-selected"), boatSelectedFill: value("boat-selected-fill"), boatSelectedSail: value("boat-selected-sail"),
    islandFills: [value("land"), value("town"), value("rock")], islandDot: value("island-dot"),
    lines: { red: value("line-red"), blue: value("line-blue"), green: value("line-green") },
    preview: value("preview"), previewLine: value("preview-line"), texture: Number(value("texture")) || 0
  });
}

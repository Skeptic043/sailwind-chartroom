// App settings live in the workspace and are saved with the charts. The desktop host shows them in a
// native Settings window and sends back what the player applies; this module checks and applies them.
import { APPEARANCE_IDS, CHART_TOOLS, INTERFACE_SIZES, THEME_IDS, validateShortcuts } from "./model.mjs";
import { APPEARANCES, THEMES, applyTheme, isDark, onSheetLoaded, onSystemAppearanceChange } from "./theme.mjs";
import { drawChart } from "./render.mjs";
import { elements, showToast } from "./dom.mjs";
import { host, persist, workspace } from "./state.mjs";
import { renderEverything } from "./panels.mjs";
import { renderBoatLibrary, renderIslandLibrary } from "./dialogs.mjs";

// The theme must be in place before the first render, so app.mjs calls this before drawing.
export function initTheme() {
  onSheetLoaded(drawChart);
  applyAppearance();
  onSystemAppearanceChange(() => {
    if (workspace.settings.appearance !== "system") return;
    applyAppearance();
    renderEverything();
  });
}

function applyAppearance() {
  host.setAppearance(applyTheme(workspace.settings), workspace.settings.appearance === "system");
  if (elements["island-dialog"].open) renderIslandLibrary();
  if (elements["boat-dialog"].open) renderBoatLibrary();
}

export function initSettings() {
  applyInterfaceSize();
  if (!host.desktop) return;
  for (const id of ["open-settings", "text-menu"]) elements[id].hidden = false;
  elements["open-settings"].addEventListener("click", openSettings);
  elements["zoom-in"].addEventListener("click", () => stepInterfaceSize(1));
  elements["zoom-out"].addEventListener("click", () => stepInterfaceSize(-1));
  elements["zoom-reset"].addEventListener("click", () => stepInterfaceSize(0));
  host.on("settings-changed", ({ settings }) => applySettings(settings));
  // The macOS app menu has its own Settings item.
  host.on("show-settings", openSettings);
}

function openSettings() {
  const { shortcuts, checkForUpdates, interfaceSize, theme, appearance } = workspace.settings;
  const tools = CHART_TOOLS.map(({ mode, label }) => ({ mode, label, key: shortcuts[mode] }));
  host.openSettings({ tools, checkForUpdates, interfaceSize, theme, appearance, themes: THEMES, appearances: appearanceChoices(), dark: isDark() },
    CHART_TOOLS.map(({ mode, label, key }) => ({ mode, label, key })));
}

// The system choice is named for the system the app runs on.
function appearanceChoices() {
  return host.platform === "mac" ? APPEARANCES.map((choice) => choice.id === "system" ? { ...choice, label: "Match macOS" } : choice) : APPEARANCES;
}

function applySettings({ shortcuts, checkForUpdates, interfaceSize, theme, appearance }) {
  try {
    workspace.settings.shortcuts = validateShortcuts(shortcuts);
  } catch (error) {
    showToast(error.message, true);
    return;
  }
  workspace.settings.checkForUpdates = checkForUpdates !== false;
  if (INTERFACE_SIZES.includes(interfaceSize)) workspace.settings.interfaceSize = interfaceSize;
  if (THEME_IDS.includes(theme)) workspace.settings.theme = theme;
  if (APPEARANCE_IDS.includes(appearance)) workspace.settings.appearance = appearance;
  persist();
  applyAppearance();
  renderEverything();
  applyInterfaceSize();
}

// Ctrl + and Ctrl - step through the fixed sizes from the current one; 0 returns to the Windows text size.
export function stepInterfaceSize(direction) {
  if (!host.desktop) return;
  const sizes = INTERFACE_SIZES.filter(Boolean);
  const current = effectiveSize();
  const next = direction > 0 ? sizes.find((size) => size > current)
    : direction < 0 ? sizes.findLast((size) => size < current)
    : 0;
  // Already as large or as small as the steps go: leave the setting as it is.
  if (next === undefined) return;
  workspace.settings.interfaceSize = next;
  persist();
  applyInterfaceSize();
  showToast(next ? `Interface size ${next}%` : host.platform === "mac" ? "Interface size 100%" : `Interface size matches Windows (${host.textScale}%)`);
}

function effectiveSize() {
  return workspace.settings.interfaceSize || host.textScale;
}

function applyInterfaceSize() {
  host.setZoom(effectiveSize() / 100);
}

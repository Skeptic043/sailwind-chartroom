// Update checks and installs, as in Spectari: a bar when a startup check finds a newer release,
// Help menu items to check now or read the release notes, and a progress dialog while installing.
// The desktop host does all network and file work; this module only shows what it reports.
import { releaseNoteLines } from "./format.mjs";
import { elements, showToast } from "./dom.mjs";
import { host, persist, workspace } from "./state.mjs";

let pendingCheck = null;
let newest = null;
let installing = false;

export function initUpdates() {
  if (!host.desktop) return;
  elements["check-updates"].hidden = false;
  elements["release-notes"].hidden = false;
  if (host.platform === "mac") {
    // The macOS app shows its own update windows, so the page only asks for a check.
    elements["check-updates"].addEventListener("click", () => host.checkUpdates());
    elements["release-notes"].addEventListener("click", host.openReleases);
    if (workspace.settings.checkForUpdates) host.checkUpdates(true);
    return;
  }
  elements["check-updates"].addEventListener("click", () => check("manual"));
  elements["release-notes"].addEventListener("click", () => check("notes"));
  elements["update-bar-open"].addEventListener("click", host.openReleases);
  elements["update-bar-install"].addEventListener("click", () => showUpdate(newest));
  elements["update-bar-dismiss"].addEventListener("click", dismiss);
  elements["update-install"].addEventListener("click", install);
  elements["update-progress-cancel"].addEventListener("click", () => {
    if (installing) host.cancelUpdate();
    else elements["update-progress-dialog"].close();
  });
  // Escape must not hide the progress dialog while the host is still working.
  elements["update-progress-dialog"].addEventListener("cancel", (event) => { if (installing) event.preventDefault(); });
  host.on("updates", receive);
  host.on("update-progress", ({ status, fraction, cancelable }) => {
    elements["update-progress-status"].textContent = status;
    elements["update-progress-bar"].value = fraction ?? 0;
    elements["update-progress-cancel"].disabled = !cancelable;
  });
  host.on("update-failed", ({ message }) => {
    installing = false;
    elements["update-progress-title"].textContent = "Update not installed";
    elements["update-progress-status"].textContent = message;
    elements["update-progress-bar"].hidden = true;
    elements["update-progress-cancel"].textContent = "Close";
    elements["update-progress-cancel"].disabled = false;
    if (!elements["update-progress-dialog"].open) elements["update-progress-dialog"].showModal();
  });
  if (workspace.settings.checkForUpdates) check("startup");
}

function check(mode) {
  if (pendingCheck || installing) return;
  pendingCheck = mode;
  host.checkUpdates();
}

function receive({ ok, current, newer = [], all = [] }) {
  const mode = pendingCheck;
  pendingCheck = null;
  newest = ok && newer.length ? { current, newer } : null;
  if (mode === "startup") {
    if (newest && newer[0].version !== workspace.settings.skippedUpdate) {
      elements["update-bar-text"].textContent = `Sailwind Chartroom ${newer[0].version} is available.`;
      showBar(true);
    }
  } else if (!ok) {
    showToast(mode === "notes" ? "Couldn't load the release notes. Check your internet connection and try again." : "Couldn't check for updates. Check your internet connection and try again.", true);
  } else if (mode === "notes") {
    showNotes("Release notes", "", all, false);
  } else if (newest) {
    showUpdate(newest);
  } else {
    showToast(`Chartroom is up to date (${current}).`);
  }
}

function showUpdate(update) {
  if (!update) return;
  showNotes("Update available", `Sailwind Chartroom ${update.newer[0].version} is available. You have ${update.current}.`, update.newer, true);
}

function showNotes(title, summary, releases, offerInstall) {
  elements["update-dialog-title"].textContent = title;
  elements["update-dialog-summary"].textContent = summary;
  elements["update-dialog-summary"].hidden = !summary;
  elements["update-install"].hidden = !offerInstall;
  elements["update-dialog-close"].textContent = offerInstall ? "Cancel" : "Close";
  elements["update-notes"].replaceChildren(...releases.flatMap((release) => {
    const heading = document.createElement("h3");
    heading.textContent = release.version;
    const lines = releaseNoteLines(release.notes);
    if (!lines.length) lines.push({ kind: "text", text: "No notes for this version." });
    return [heading, ...lines.map(({ kind, text }) => {
      const line = document.createElement(kind === "heading" ? "h4" : kind === "bullet" ? "li" : "p");
      line.textContent = text;
      return line;
    })];
  }));
  elements["update-dialog"].showModal();
}

function showBar(shown) {
  elements["update-bar"].hidden = !shown;
  document.body.classList.toggle("update-bar-shown", shown);
}

function install() {
  elements["update-dialog"].close();
  showBar(false);
  installing = true;
  elements["update-progress-title"].textContent = `Updating to Sailwind Chartroom ${newest.newer[0].version}`;
  elements["update-progress-status"].textContent = "Starting…";
  elements["update-progress-bar"].hidden = false;
  elements["update-progress-bar"].value = 0;
  elements["update-progress-cancel"].textContent = "Cancel";
  elements["update-progress-dialog"].showModal();
  host.installUpdate();
}

// Dismissing skips this version only; a newer one is offered again.
function dismiss() {
  if (!newest) return;
  workspace.settings.skippedUpdate = newest.newer[0].version;
  showBar(false);
  persist();
}

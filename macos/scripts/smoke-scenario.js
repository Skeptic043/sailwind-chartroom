// Runs inside the packaged app's page (see SmokeTest.swift). smoke.mjs puts `phase` and `fixture`
// in front of this text. Returns what the page shows, as JSON text.
const find = (selector) => document.querySelector(selector);
const rows = () => document.querySelectorAll("#feature-list .feature-row").length;
const charts = () => [...find("#chart-select").options].map((option) => option.textContent);
const wait = async (test, what) => {
  const end = Date.now() + 20000;
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
const saved = () => wait(() => !find("#save-status").classList.contains("saving"), "the save");

await wait(() => find("#app-version").textContent !== "", "the host handshake");

if (phase === "create") {
  // A double-click on empty water adds a location.
  const canvas = find("#chart-canvas");
  const box = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new MouseEvent("dblclick", { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true }));
  await wait(() => rows() === 1, "the new location");
  await saved();

  // Import a chart through the page's own file input.
  const before = charts().length;
  const transfer = new DataTransfer();
  transfer.items.add(new File([fixture], "imported.json", { type: "application/json" }));
  const input = find("#json-file");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(() => charts().length === before + 1, "the imported chart");
  await saved();

  find("#export-all").click();
  // Lets the export reach the host before this script's answer does.
  await new Promise((resolve) => setTimeout(resolve, 500));
}

return JSON.stringify({
  version: find("#app-version").textContent,
  storageNote: find("#storage-note").textContent,
  desktop: !find("#open-settings").hidden,
  charts: charts(),
  rows: rows(),
  undoKey: find("#undo kbd").textContent
});

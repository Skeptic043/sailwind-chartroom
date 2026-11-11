// Drives the packaged macOS app through its critical paths and fails loudly when one breaks.
//
//   node smoke.mjs <Sailwind Chartroom.app> <work folder> [create|verify|recover ...]
//
// With no phases it runs all three against a fresh data folder:
//   create   first launch: add a location, import a chart, export a backup
//   verify   relaunch: the same charts are back, read from the workspace file
//   recover  damage the workspace file: the previous launch's copy is restored with one warning
// Each launch goes through `open`, as a double-click in Finder does. The save and open panels are
// skipped (exports go straight to a folder), so this proves the files, not the panels.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const [app, workArgument, ...requested] = process.argv.slice(2);
if (!app || !workArgument) {
  console.error("Usage: node smoke.mjs <app> <work folder> [create|verify|recover ...]");
  process.exit(1);
}
const work = resolve(workArgument);
const data = join(work, "data");
const exportsFolder = join(work, "exports");
const statePath = join(work, "created.json");
const phases = requested.length ? requested : ["create", "verify", "recover"];
mkdirSync(data, { recursive: true });
mkdirSync(exportsFolder, { recursive: true });

function launch(name, phase) {
  const fixture = readFileSync(join(here, "../../tests/fixtures/chartroom-0.4.15-chart.json"), "utf8");
  const script = join(work, `${name}.js`);
  const report = join(work, `${name}.json`);
  writeFileSync(script, `const phase = ${JSON.stringify(phase)};\nconst fixture = ${JSON.stringify(fixture)};\n${readFileSync(join(here, "smoke-scenario.js"), "utf8")}`);
  rmSync(report, { force: true });
  execFileSync("open", ["-n", "-W", resolve(app), "--args", "--data-dir", data, "--export-dir", exportsFolder, "--smoke-script", script, "--smoke-report", report], { stdio: "inherit", timeout: 180000 });
  assert.ok(existsSync(report), `${name}: the app wrote no report`);
  const result = JSON.parse(readFileSync(report, "utf8"));
  console.log(`${name}:`, JSON.stringify(result, null, 2));
  assert.equal(result.ok, true, `${name}: ${result.error}`);
  assert.equal(result.handshake, true, `${name}: the page never reached its host`);
  assert.deepEqual(result.pageErrors, [], `${name}: the page reported errors`);
  const page = JSON.parse(result.result);
  // Only the native host shows the save folder and Settings; a page on browser storage shows neither.
  assert.equal(page.desktop, true, `${name}: the page is not using the native host`);
  assert.ok(page.storageNote.includes(data), `${name}: the page does not save to the data folder`);
  assert.equal(page.version, result.version, `${name}: the page shows another version`);
  assert.equal(page.undoKey, "⌘Z", `${name}: shortcuts are not named for the Mac`);
  return { ...result, page };
}

const shown = (page) => ({ charts: page.charts, rows: page.rows });

for (const phase of phases) {
  if (phase === "create") {
    const { page, saves, warnings } = launch("create", "create");
    assert.deepEqual(warnings, []);
    assert.ok(saves >= 2, "the host saved the new location and the imported chart");
    assert.ok(page.charts.some((name) => name.startsWith("Fixture Sea")), "the imported chart is listed");
    assert.ok(page.rows > 0, "the imported chart shows its items");
    const workspace = JSON.parse(readFileSync(join(data, "workspace.json"), "utf8"));
    assert.equal(workspace.charts.length, page.charts.length, "workspace.json holds every chart");
    const [backup] = readdirSync(exportsFolder).filter((name) => name.startsWith("sailwind-chartroom-backup-"));
    assert.ok(backup, "the backup export was written");
    const exported = JSON.parse(readFileSync(join(exportsFolder, backup), "utf8"));
    assert.equal(exported.format, "sailwind-chartroom");
    assert.equal(exported.charts.length, page.charts.length, "the backup holds every chart");
    writeFileSync(statePath, JSON.stringify(shown(page)));
  } else if (phase === "verify") {
    const { page, warnings } = launch("verify", "verify");
    assert.deepEqual(warnings, []);
    assert.deepEqual(shown(page), JSON.parse(readFileSync(statePath, "utf8")), "the relaunch restored the charts");
  } else if (phase === "recover") {
    writeFileSync(join(data, "workspace.json"), "{ damaged");
    const { page, warnings } = launch("recover", "verify");
    assert.equal(warnings.length, 1, "one warning explains the recovery");
    assert.match(warnings[0], /previous launch/);
    assert.deepEqual(shown(page), JSON.parse(readFileSync(statePath, "utf8")), "the previous launch's charts were restored");
    assert.ok(readdirSync(data).some((name) => name.startsWith("workspace.unreadable-")), "the damaged file was kept");
  } else {
    throw new Error(`Unknown phase: ${phase}`);
  }
  console.log(`${phase}: passed`);
}

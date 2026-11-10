import { readFile } from "node:fs/promises";
import { test, expect } from "./harness.mjs";

test("starts from the host's workspace and reports the host's version", async ({ chartroom, page }) => {
  await chartroom.open();
  await expect(page.locator("#storage-note")).toContainText("D:/Charts");
  await expect(page.locator("#pin-window")).toBeAttached();
  await expect(page.locator("#pin-window")).not.toHaveAttribute("hidden", "");
  expect(await page.evaluate(() => window.__host.messages[0])).toBe("ready");
});

test("adds, edits and deletes a location, saving each change", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("l");
  await chartroom.clickChart(600, 400);
  await expect(page.locator("#feature-inspector")).toBeVisible();
  await page.locator("#feature-name").fill("Gold Rock");
  await page.locator("#feature-name").press("Enter");
  await expect.poll(async () => (await chartroom.chart()).features.map((feature) => feature.name)).toEqual(["Gold Rock"]);
  await expect(chartroom.items()).toHaveCount(1);
  await expect(chartroom.items().first()).toContainText("Gold Rock");

  await chartroom.press("Delete");
  await expect.poll(async () => (await chartroom.chart()).features.length).toBe(0);
  await chartroom.press("Control+z");
  await expect.poll(async () => (await chartroom.chart()).features.length).toBe(1);
  await chartroom.press("Control+y");
  await expect.poll(async () => (await chartroom.chart()).features.length).toBe(0);
});

test("a reload keeps edits made since launch", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("l");
  await chartroom.clickChart(500, 300);
  await chartroom.saved();
  await page.reload();
  await expect(page.locator("#app-version")).toHaveText("9.9.9");
  await expect(chartroom.items()).toHaveCount(1);
});

test("plots a route, saves it, and starts a fresh active route", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("r");
  await chartroom.clickChart(400, 300);
  await chartroom.clickChart(600, 320);
  await chartroom.clickChart(700, 500);
  await expect(page.locator("#route-summary")).toBeVisible();
  await page.locator("#save-route").click();
  const chart = await chartroom.chart();
  expect(chart.route).toEqual([]);
  expect(chart.savedRoutes).toHaveLength(1);
  expect(chart.savedRoutes[0].points).toHaveLength(3);
  await expect(page.locator("#route-summary")).toBeHidden();
});

test("drags out a search area that snaps to a compass point", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("s");
  await chartroom.dragChart({ x: 500, y: 450 }, { x: 500, y: 250 });
  await expect(page.locator("#search-inspector")).toBeVisible();
  const [search] = (await chartroom.chart()).searches;
  expect(search.bearing).toBe(0);
  expect(search.distanceNm).toBeGreaterThan(0);
});

test("shift-drag selects several items and dragging moves them together", async ({ chartroom }) => {
  await chartroom.open();
  for (const x of [500, 560]) {
    await chartroom.press("l");
    await chartroom.clickChart(x, 400);
  }
  const before = (await chartroom.chart()).features.map(({ lat, lon }) => ({ lat, lon }));
  await chartroom.dragChart({ x: 450, y: 350 }, { x: 620, y: 450 }, { modifiers: ["Shift"] });
  await chartroom.dragChart({ x: 500, y: 400 }, { x: 540, y: 400 });
  const after = (await chartroom.chart()).features;
  const shifts = after.map((feature, index) => feature.lon - before[index].lon);
  expect(shifts[0]).toBeGreaterThan(0);
  expect(shifts[1]).toBeCloseTo(shifts[0], 6);
});

test("chart items filter and search narrow the list", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("l");
  await chartroom.clickChart(500, 400);
  await chartroom.press("r");
  await chartroom.clickChart(700, 400);
  await chartroom.press("Escape");
  await expect(chartroom.items()).toHaveCount(2);
  await page.locator("#item-filter").selectOption("route");
  await expect(chartroom.items()).toHaveCount(1);
  await page.locator("#item-filter").selectOption("all");
  await page.locator("#feature-search").fill("waypoint");
  await expect(chartroom.items()).toHaveCount(1);
});

test("menus open from the keyboard and close with Escape", async ({ chartroom, page }) => {
  await chartroom.open();
  const file = page.locator('.app-menu[data-menu="file"] summary');
  await file.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('.app-menu[data-menu="file"]')).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(page.locator('.app-menu[data-menu="file"]')).not.toHaveAttribute("open", "");
  await file.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.app-menu[data-menu="edit"] summary')).toBeFocused();
});

test("the island library applies an outline to the selected location", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("l");
  await chartroom.clickChart(500, 400);
  await chartroom.press("i");
  await expect(page.locator("#island-dialog")).toBeVisible();
  await page.locator("#island-search").fill("Dead Cove");
  await page.locator("#island-list .island-row").first().click();
  await expect(page.locator("#feature-island-status")).toContainText("Dead Cove");
  expect((await chartroom.chart()).features[0].islandId).toBeTruthy();
});

test("exports the active chart as JSON", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("l");
  await chartroom.clickChart(500, 400);
  const download = page.waitForEvent("download");
  await page.locator("#export-json").evaluate((button) => button.click());
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.json$/);
  const exported = JSON.parse(await readFile(await file.path(), "utf8"));
  expect(exported).toMatchObject({ format: "sailwind-chartroom", version: 1 });
  expect(exported.charts[0].features).toHaveLength(1);
});

async function plotAndSaveRoute(chartroom, page) {
  await chartroom.press("r");
  await chartroom.clickChart(400, 300);
  await chartroom.clickChart(600, 300);
  await chartroom.clickChart(600, 500);
  await page.locator("#save-route").click();
  await chartroom.press("v");
}

test("a saved route is listed, selectable, renamable and can be hidden", async ({ chartroom, page }) => {
  await chartroom.open();
  await plotAndSaveRoute(chartroom, page);
  const row = chartroom.items().filter({ hasText: "Route 1" });
  await expect(row).toContainText("3 waypoints");
  await row.click();
  await expect(page.locator("#saved-route-inspector")).toBeVisible();
  await page.locator("#saved-route-name").fill("Gold Rock run");
  await page.locator("#saved-route-name").press("Tab");
  await page.locator("#saved-route-visible").uncheck();
  await expect.poll(async () => (await chartroom.chart()).savedRoutes[0]).toMatchObject({ name: "Gold Rock run", hidden: true });
  await expect(chartroom.items().filter({ hasText: "Gold Rock run" })).toContainText("hidden");
});

test("saved waypoints can be edited on the chart and the whole route dragged", async ({ chartroom, page }) => {
  await chartroom.open();
  await plotAndSaveRoute(chartroom, page);
  await chartroom.clickChart(400, 300);
  await expect(page.locator("#route-inspector")).toBeVisible();
  await expect(page.locator("#route-point-kind")).toHaveText("Waypoint 1 of Route 1");
  await page.locator("#route-name").fill("Departure");
  await page.locator("#route-name").press("Tab");
  await expect.poll(async () => (await chartroom.chart()).savedRoutes[0].points[0].name).toBe("Departure");

  await page.locator("#select-saved-route").click();
  await expect(page.locator("#saved-route-inspector")).toBeVisible();
  const before = (await chartroom.chart()).savedRoutes[0].points.map((point) => point.lon);
  await chartroom.dragChart({ x: 500, y: 300 }, { x: 560, y: 300 });
  const after = (await chartroom.chart()).savedRoutes[0].points.map((point) => point.lon);
  const shifts = after.map((lon, index) => lon - before[index]);
  expect(shifts[0]).toBeGreaterThan(0);
  expect(shifts[2]).toBeCloseTo(shifts[0], 6);

  await page.locator("#delete-saved-route").click();
  await expect.poll(async () => (await chartroom.chart()).savedRoutes).toEqual([]);
  await chartroom.press("Control+z");
  await expect.poll(async () => (await chartroom.chart()).savedRoutes.length).toBe(1);
});

test("About shows the version and the full license notices bundled with the app", async ({ chartroom, page }) => {
  await chartroom.open();
  await page.locator('.app-menu[data-menu="help"] summary').click();
  await page.locator("#about").click();
  await expect(page.locator("#about-version")).toHaveText("9.9.9");
  await expect(page.locator("#about-license")).toContainText("MIT License");
  await expect(page.locator("#about-notices")).toContainText("Sailwind-Map");
});

test("refuses a file from a newer Chartroom with a clear message", async ({ chartroom, page }) => {
  await chartroom.open();
  await page.locator("#json-file").setInputFiles({ name: "future.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "sailwind-chartroom", version: 99, charts: [] })) });
  await expect(page.locator("#toast")).toContainText("newer version of Chartroom");
});

test("Settings opens the native window with the current keys and applies what it sends back", async ({ chartroom, page }) => {
  await chartroom.open();
  const reply = { shortcuts: { select: "v", location: "k", route: "r", measure: "m", area: "a", search: "s", wind: "w" }, checkForUpdates: true, interfaceSize: 150 };
  await page.evaluate((settings) => { window.__host.settingsReply = settings; }, reply);
  await page.locator('.app-menu[data-menu="file"] summary').click();
  await page.locator("#open-settings").click();
  const opened = await page.evaluate(() => window.__host.settingsOpened);
  expect(opened.settings.tools.find((tool) => tool.mode === "location")).toEqual({ mode: "location", label: "Add location", key: "l" });
  expect(opened.defaults).toHaveLength(7);
  await expect(page.locator('.tool[data-mode="location"] b')).toHaveText("K");
  await expect(page.locator('kbd[data-shortcut="location"]')).toHaveText("K");
  await chartroom.press("k");
  await chartroom.clickChart(500, 400);
  await expect.poll(async () => (await chartroom.chart()).features.length).toBe(1);
  expect((await chartroom.saved()).settings).toMatchObject({ interfaceSize: 150, shortcuts: { location: "k" } });
  expect((await page.evaluate(() => window.__host.zooms)).at(-1)).toBe(1.5);
});

test("Ctrl + and Ctrl - step the interface size and Ctrl 0 returns to the Windows size", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("Control+=");
  await chartroom.press("Control+=");
  await chartroom.press("Control+-");
  await chartroom.press("Control+0");
  await chartroom.press("Control+-");
  expect(await page.evaluate(() => window.__host.zooms)).toEqual([1, 1.25, 1.5, 1.25, 1]);
  expect((await chartroom.saved()).settings.interfaceSize).toBe(0);
});

test("resolving a named search removes every search with that name", async ({ chartroom, page }) => {
  const search = (id, lat, label) => ({ id, lat, lon: 0, bearing: 90, distanceNm: 100, label });
  await chartroom.open({ charts: [{ id: "chart-1", name: "Sea", view: { lat: 0, lon: 0, zoom: 5 }, searches: [search("s1", 0, "Chronos"), search("s2", 0.2, "chronos"), search("s3", -0.2, "Chronos"), search("s4", 5, "Other")] }] });
  await chartroom.items().filter({ hasText: "Chronos" }).first().click();
  await page.locator("#search-mark").click();
  await chartroom.clickChart(600, 400);
  const chart = await chartroom.chart();
  expect(chart.searches.map((item) => item.label)).toEqual(["Other"]);
  expect(chart.features.map((item) => item.name)).toEqual(["Chronos"]);
});

test("selecting a saved route shows its figures in the route panel", async ({ chartroom, page }) => {
  await chartroom.open();
  await plotAndSaveRoute(chartroom, page);
  await expect(page.locator("#route-summary")).toBeHidden();
  await chartroom.items().filter({ hasText: "Route 1" }).click();
  await expect(page.locator("#route-summary")).toBeVisible();
  await expect(page.locator("#route-summary-title")).toHaveText("Route 1");
  await expect(page.locator("#route-actions")).toBeHidden();
  await expect(page.locator("#route-distance")).not.toHaveText("0.0 nm");
  await chartroom.press("Escape");
  await expect(page.locator("#route-summary")).toBeHidden();
});

const newerReleases = {
  newer: [{ version: "10.1", notes: "## Added\n- Tide tables", installable: true }, { version: "10.0.1", notes: "- Fixed labels", installable: true }],
  all: [{ version: "10.1", notes: "- Tide tables" }, { version: "10.0.1", notes: "" }]
};

test("a startup check shows the update bar, and Dismiss skips that version", async ({ chartroom, page }) => {
  await chartroom.open(null, { updates: newerReleases });
  await expect(page.locator("#update-bar")).toBeVisible();
  await expect(page.locator("#update-bar-text")).toHaveText("Sailwind Chartroom 10.1 is available.");
  await page.locator("#update-bar-dismiss").click();
  await expect(page.locator("#update-bar")).toBeHidden();
  expect((await chartroom.saved()).settings.skippedUpdate).toBe("10.1");
  await page.reload();
  await expect(page.locator("#app-version")).toHaveText("9.9.9");
  await expect.poll(() => chartroom.messages()).toContain("check-updates");
  await expect(page.locator("#update-bar")).toBeHidden();
});

test("Update now shows every missed version's notes and reports install progress and failure", async ({ chartroom, page }) => {
  await chartroom.open(null, { updates: newerReleases });
  await page.locator("#update-bar-install").click();
  await expect(page.locator("#update-dialog-summary")).toHaveText("Sailwind Chartroom 10.1 is available. You have 9.9.9.");
  await expect(page.locator("#update-notes h3")).toHaveText(["10.1", "10.0.1"]);
  await expect(page.locator("#update-notes li")).toHaveText(["Tide tables", "Fixed labels"]);
  await page.locator("#update-install").click();
  await expect(page.locator("#update-progress-dialog")).toBeVisible();
  await expect(page.locator("#update-progress-status")).toHaveText("The download failed.");
  await expect(page.locator("#update-progress-cancel")).toHaveText("Close");
  expect(await chartroom.messages()).toContain("install-update");
  await page.locator("#update-progress-cancel").click();
  await expect(page.locator("#update-progress-dialog")).toBeHidden();
});

test("Help shows up to date and release notes; the startup check can be turned off", async ({ chartroom, page }) => {
  await chartroom.open(null, { updates: { all: newerReleases.all } });
  await page.locator('.app-menu[data-menu="help"] summary').click();
  await page.locator("#check-updates").click();
  await expect(page.locator("#toast")).toContainText("Chartroom is up to date (9.9.9).");
  await page.locator('.app-menu[data-menu="help"] summary').click();
  await page.locator("#release-notes").click();
  await expect(page.locator("#update-notes h3")).toHaveText(["10.1", "10.0.1"]);
  await expect(page.locator("#update-notes p")).toHaveText(["No notes for this version."]);
  await expect(page.locator("#update-install")).toBeHidden();
  await page.locator("#update-dialog-close").click();

  await page.evaluate(() => { window.__host.settingsReply = { shortcuts: { select: "v", location: "l", route: "r", measure: "m", area: "a", search: "s", wind: "w" }, checkForUpdates: false, interfaceSize: 0 }; });
  await page.locator('.app-menu[data-menu="file"] summary').click();
  await page.locator("#open-settings").click();
  expect((await chartroom.saved()).settings.checkForUpdates).toBe(false);
  await page.evaluate(() => { window.__host.messages.length = 0; });
  await page.reload();
  await expect(page.locator("#app-version")).toHaveText("9.9.9");
  expect(await chartroom.messages()).not.toContain("check-updates");
});

test("themes and light or dark mode apply from settings and follow Settings changes", async ({ chartroom, page }) => {
  await chartroom.open({ settings: { theme: "sailwind", appearance: "light" }, charts: [{ id: "c", name: "Sea" }] });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sailwind");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--paper-texture"))).toContain("assets/sailwind/paper-light.jpg");
  const reply = { shortcuts: { select: "v", location: "l", route: "r", measure: "m", area: "a", search: "s", wind: "w" }, checkForUpdates: true, interfaceSize: 0, theme: "chartroom", appearance: "dark" };
  await page.evaluate((settings) => { window.__host.settingsReply = settings; }, reply);
  await page.locator('.app-menu[data-menu="file"] summary').click();
  await page.locator("#open-settings").click();
  const opened = await page.evaluate(() => window.__host.settingsOpened.settings);
  expect(opened).toMatchObject({ theme: "sailwind", appearance: "light", dark: false });
  expect(opened.themes.map((theme) => theme.id)).toEqual(["chartroom", "sailwind"]);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "chartroom");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  expect((await chartroom.saved()).settings).toMatchObject({ theme: "chartroom", appearance: "dark" });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--paper-texture").trim())).toBe("none");
});

test("Match Windows follows the system light or dark setting", async ({ chartroom, page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await chartroom.open();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
});

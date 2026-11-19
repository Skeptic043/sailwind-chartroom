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
  await expect(page.locator("#feature-name"), "typing names the new location").toBeFocused();
  await page.keyboard.type("Gold Rock");
  await expect(page.locator("#feature-name")).toHaveValue("Gold Rock");
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
  // Route in the top bar hides and shows the panel, and its heading drags it.
  await page.locator("#show-route-panel").click();
  await expect(page.locator("#route-summary")).toBeHidden();
  await page.locator("#show-route-panel").click();
  await expect(page.locator("#route-summary")).toBeVisible();
  const before = await page.locator("#route-summary").boundingBox();
  const handle = await page.locator("#route-summary-heading").boundingBox();
  await page.mouse.move(handle.x + 10, handle.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle.x - 290, handle.y + 205, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator("#route-summary").boundingBox();
  expect(Math.round(after.x - before.x)).toBe(-300);
  expect(Math.round(after.y - before.y)).toBe(200);
  expect((await chartroom.saved()).settings.routePanel.x).toBeLessThan(1);
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

test("search areas snap to the chosen 16, 32 or 64-point compass", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("s");
  await expect(page.locator("#search-points")).toHaveValue("16");
  // About 8.5° east of north: north on a 16-point compass, 11.25° on a 64-point one.
  await chartroom.dragChart({ x: 500, y: 450 }, { x: 530, y: 250 });
  await page.keyboard.press("Escape");
  await chartroom.press("s");
  await page.locator("#search-points").selectOption("32");
  await chartroom.dragChart({ x: 300, y: 450 }, { x: 330, y: 250 });
  const [sixteen, thirtyTwo] = (await chartroom.chart()).searches;
  expect([sixteen.bearing, sixteen.spreadDeg]).toEqual([0, 11.25]);
  expect([thirtyTwo.bearing, thirtyTwo.spreadDeg]).toEqual([11.25, 5.625]);
  expect((await chartroom.saved()).settings.searchPoints).toBe(32);
});

test("a location can hide its name on the chart", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("l");
  await chartroom.clickChart(500, 400);
  await page.locator("#feature-name").fill("Quiet cove");
  await page.locator("#feature-name").blur();
  const picture = () => page.locator("#chart-canvas").evaluate((canvas) => canvas.toDataURL());
  const named = await picture();
  await expect(page.locator("#feature-show-name")).toBeChecked();
  await page.locator("#feature-show-name").uncheck();
  expect((await chartroom.chart()).features[0].showName).toBe(false);
  expect(await picture()).not.toBe(named);
  await page.locator("#feature-show-name").check();
  expect((await chartroom.chart()).features[0].showName).toBeUndefined();
  expect(await picture()).toBe(named);
});

test("a search area takes an island from the library and can drop it again", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("s");
  await chartroom.dragChart({ x: 500, y: 450 }, { x: 500, y: 250 });
  await page.locator("#choose-search-island").click();
  await page.locator("#island-search").fill("Dead Cove");
  await page.locator("#island-list .island-row").first().click();
  await expect(page.locator("#search-island-status")).toHaveText("Dead Cove");
  expect((await chartroom.chart()).searches[0].islandId).toBe("emerald/dead_cove");
  await page.locator("#choose-search-island").click();
  await page.locator("#remove-island").click();
  await expect(page.locator("#search-island-status")).toHaveText("None");
  expect((await chartroom.chart()).searches[0].islandId).toBeUndefined();
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
  await expect(page.locator(".app-menu > summary")).toHaveText(["File", "Edit", "View", "Voyage", "Help"]);
  await expect(page.locator("#save-chart")).toHaveCount(0);
  const file = page.locator('.app-menu[data-menu="file"] summary');
  await file.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('.app-menu[data-menu="file"]')).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(page.locator('.app-menu[data-menu="file"]')).not.toHaveAttribute("open", "");
  await file.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.app-menu[data-menu="edit"] summary')).toBeFocused();
  const view = page.locator('.app-menu[data-menu="view"] summary');
  await view.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.app-menu[data-menu="voyage"] summary')).toBeFocused();
});

test("saving shows only a dot, so the top bar buttons stay put", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.saved();
  // Every change of the dot is recorded with where the buttons beside it were at that moment.
  await page.evaluate(() => {
    const status = document.querySelector("#save-status");
    window.__saveSeen = [];
    new MutationObserver(() => window.__saveSeen.push({ title: status.title, x: document.querySelector("#show-key-overlay").getBoundingClientRect().x }))
      .observe(status, { attributes: true, attributeFilter: ["title"] });
  });
  const x = await page.evaluate(() => document.querySelector("#show-key-overlay").getBoundingClientRect().x);
  await chartroom.press("l");
  await chartroom.clickChart(400, 300);
  await chartroom.saved();
  const seen = await page.evaluate(() => window.__saveSeen);
  expect(seen.map((entry) => entry.title)).toContain("Saving…");
  expect(seen.at(-1).title).toBe("Saved");
  expect(seen.every((entry) => entry.x === x)).toBe(true);
  await expect(page.locator("#save-status")).toHaveText("");
});

test("menus and panel buttons fit at the largest interface scale", async ({ chartroom, page }) => {
  await page.setViewportSize({ width: 450, height: 600 });
  await chartroom.open();
  const edges = await page.evaluate(() => ({
    menu: document.querySelector('.app-menu[data-menu="help"] > summary').getBoundingClientRect().right,
    actions: document.querySelector("#show-key-overlay").getBoundingClientRect().right,
    viewport: window.innerWidth
  }));
  expect(edges.menu).toBeLessThanOrEqual(edges.viewport);
  expect(edges.actions).toBeLessThanOrEqual(edges.viewport);
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

test("the vanilla map draws under the chart with its secrets, and trade winds stand alone", async ({ chartroom, page }) => {
  await chartroom.open();
  const picture = () => page.locator("canvas").first().evaluate((canvas) => canvas.toDataURL());
  const toggle = (id) => page.locator(id).evaluate((input) => input.click());
  await expect(page.locator("#layer-secrets")).toBeDisabled();
  await expect(page.locator("#layer-trade-winds")).toBeEnabled();
  await expect(page.locator("#layer-expanded-winds")).toBeDisabled();
  const empty = await picture();
  await toggle("#layer-vanilla");
  await expect(page.locator("#layer-secrets")).toBeEnabled();
  const islands = await picture();
  expect(islands).not.toBe(empty);
  await toggle("#layer-trade-winds");
  const winds = await picture();
  expect(winds).not.toBe(islands);
  await toggle("#layer-secrets");
  expect((await chartroom.chart()).layers).toMatchObject({ vanillaMap: true, secretIslands: true, tradeWinds: true });
  await toggle("#layer-vanilla");
  expect(await picture(), "trade winds stay without the vanilla map").not.toBe(empty);
  await toggle("#layer-trade-winds");
  expect(await picture()).toBe(empty);
  expect((await chartroom.chart()).features).toHaveLength(0);
});

test("exports the active chart as JSON", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("l");
  await chartroom.clickChart(500, 400);
  await page.locator("#export-json").evaluate((button) => button.click());
  const [file] = await page.evaluate(() => window.__host.exports);
  expect(file.name).toMatch(/\.json$/);
  const exported = JSON.parse(file.contents);
  expect(exported).toMatchObject({ format: "sailwind-chartroom", version: expect.any(Number) });
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
  await page.locator('.app-menu[data-menu="help"] > summary').click();
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
  const reply = { shortcuts: { select: "v", location: "k", route: "r", measure: "m", area: "a", search: "s", wind: "w", dr: "d", note: "n", encounter: "e" }, checkForUpdates: true, interfaceSize: 150 };
  await page.evaluate((settings) => { window.__host.settingsReply = settings; }, reply);
  await page.locator('.app-menu[data-menu="file"] summary').click();
  await page.locator("#open-settings").click();
  const opened = await page.evaluate(() => window.__host.settingsOpened);
  expect(opened.settings.tools.find((tool) => tool.mode === "location")).toEqual({ mode: "location", label: "Add location", key: "l" });
  expect(opened.defaults).toHaveLength(10);
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
  await page.locator('.app-menu[data-menu="help"] > summary').click();
  await page.locator("#check-updates").click();
  await expect(page.locator("#toast")).toContainText("Chartroom is up to date (9.9.9).");
  await page.locator('.app-menu[data-menu="help"] > summary').click();
  await page.locator("#release-notes").click();
  await expect(page.locator("#update-notes h3")).toHaveText(["10.1", "10.0.1"]);
  await expect(page.locator("#update-notes p")).toHaveText(["No notes for this version."]);
  await expect(page.locator("#update-install")).toBeHidden();
  await page.locator("#update-dialog-close").click();

  await page.evaluate(() => { window.__host.settingsReply = { shortcuts: { select: "v", location: "l", route: "r", measure: "m", area: "a", search: "s", wind: "w", dr: "d", note: "n", encounter: "e" }, checkForUpdates: false, clearReachedAreas: false, interfaceSize: 0 }; });
  await page.locator('.app-menu[data-menu="file"] summary').click();
  await page.locator("#open-settings").click();
  await expect.poll(async () => (await chartroom.saved())?.settings.checkForUpdates).toBe(false);
  expect((await chartroom.saved()).settings.clearReachedAreas).toBe(false);
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
  const reply = { shortcuts: { select: "v", location: "l", route: "r", measure: "m", area: "a", search: "s", wind: "w", dr: "d", note: "n", encounter: "e" }, checkForUpdates: true, interfaceSize: 0, theme: "chartroom", appearance: "dark", iconSize: "small" };
  await page.evaluate((settings) => { window.__host.settingsReply = settings; }, reply);
  await page.locator('.app-menu[data-menu="file"] summary').click();
  await page.locator("#open-settings").click();
  const opened = await page.evaluate(() => window.__host.settingsOpened.settings);
  expect(opened).toMatchObject({ theme: "sailwind", appearance: "light", dark: false });
  expect(opened.themes.map((theme) => theme.id)).toEqual(["chartroom", "sailwind"]);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "chartroom");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  expect((await chartroom.saved()).settings).toMatchObject({ theme: "chartroom", appearance: "dark", iconSize: "small" });
  expect(opened.iconSizes.map((size) => size.id)).toEqual(["tiny", "small", "normal", "large"]);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--paper-texture").trim())).toBe("none");
});

test("Match Windows follows the system light or dark setting", async ({ chartroom, page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await chartroom.open();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
});

test("in the macOS app, Option places freely and shortcuts are named for the Mac", async ({ chartroom, page }) => {
  await chartroom.open(null, { platform: "mac" });
  await expect(page.locator("#redo kbd")).toHaveText("⇧⌘Z");
  await expect(page.locator("#undo kbd")).toHaveText("⌘Z");
  for (const modifier of ["Control", "Alt"]) {
    await chartroom.press("w");
    await chartroom.dragChart({ x: 500, y: 400 }, { x: 590, y: 371 }, { modifiers: [modifier] });
  }
  const [snapped, free] = (await chartroom.chart()).winds.map((wind) => wind.bearing);
  expect(snapped % 11.25).toBe(0);
  expect(free % 11.25).not.toBe(0);
  expect(await chartroom.messages()).toContain("check-updates");
});

test("the measure line stays until it is replaced or deleted, and View can hide it", async ({ chartroom, page }) => {
  await chartroom.open();
  const picture = () => page.locator("canvas").first().evaluate((canvas) => canvas.toDataURL());
  const toggle = () => page.locator("#layer-measure").evaluate((input) => input.click());
  await chartroom.press("m");
  await chartroom.dragChart({ x: 400, y: 400 }, { x: 600, y: 400 });
  await expect(page.locator("#measure-inspector")).toBeVisible();
  await expect(page.locator("#measure-detail")).toContainText("090° E");
  const [first] = (await chartroom.chart()).measures;
  await chartroom.press("v");
  await chartroom.clickChart(300, 200);
  const shown = await picture();
  await toggle();
  expect(await picture()).not.toBe(shown);
  await chartroom.clickChart(500, 400);
  await expect(page.locator("#measure-inspector")).toBeHidden();
  await toggle();
  await chartroom.clickChart(500, 400);
  await expect(page.locator("#measure-inspector")).toBeVisible();
  await chartroom.dragChart({ x: 600, y: 400 }, { x: 600, y: 300 });
  const adjusted = (await chartroom.chart()).measures[0];
  expect(adjusted.end.lat).toBeGreaterThan(first.end.lat);
  expect(adjusted.lat).toBe(first.lat);
  await chartroom.press("m");
  await chartroom.clickChart(400, 300);
  await chartroom.clickChart(400, 200);
  const replaced = (await chartroom.chart()).measures;
  expect(replaced).toHaveLength(1);
  expect(replaced[0].id).not.toBe(first.id);
  await chartroom.press("Delete");
  expect((await chartroom.chart()).measures).toEqual([]);
});

test("island outlines can be hidden while their locations stay", async ({ chartroom, page }) => {
  await chartroom.open();
  const picture = () => page.locator("canvas").first().evaluate((canvas) => canvas.toDataURL());
  const toggle = () => page.locator("#layer-islands").evaluate((input) => input.click());
  const empty = await picture();
  await chartroom.press("l");
  await chartroom.clickChart(500, 400);
  await chartroom.press("i");
  await page.locator("#island-search").fill("Dead Cove");
  await page.locator("#island-list .island-row").first().click();
  await chartroom.press("Escape");
  const outlined = await picture();
  await toggle();
  const hidden = await picture();
  expect(hidden).not.toBe(outlined);
  expect(hidden).not.toBe(empty);
  expect((await chartroom.chart()).layers.islands).toBe(false);
  expect((await chartroom.chart()).features).toHaveLength(1);
  await toggle();
  expect(await picture()).toBe(outlined);
});

test("route speed arrows step in half knots and keep 0.1 kn as the lowest speed", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("r");
  await chartroom.clickChart(400, 300);
  await chartroom.clickChart(600, 300);
  const speed = page.locator("#route-speed");
  await speed.fill("3");
  await speed.press("Tab");
  await speed.focus();
  await speed.press("ArrowUp");
  await expect(speed).toHaveValue("3.5");
  await speed.press("ArrowDown");
  await speed.press("ArrowDown");
  await expect(speed).toHaveValue("2.5");
  expect((await chartroom.chart()).speedKn).toBe(2.5);
  await speed.fill("0.5");
  await speed.press("Tab");
  await speed.focus();
  await speed.press("ArrowDown");
  await expect(speed).toHaveValue("0.1");
  await speed.press("ArrowUp");
  await expect(speed).toHaveValue("0.5");
  await speed.fill("4.2");
  await speed.press("Tab");
  expect((await chartroom.chart()).speedKn).toBe(4.2);
});

test("View hides each tool's items, and its parts wait for them", async ({ chartroom, page }) => {
  await chartroom.open();
  const toggle = (id) => page.locator(id).evaluate((input) => input.click());
  await chartroom.press("s");
  await chartroom.dragChart({ x: 500, y: 450 }, { x: 500, y: 250 });
  await chartroom.press("Escape");
  await toggle("#layer-searches");
  await expect(page.locator("#layer-search-lines")).toBeDisabled();
  await expect(page.locator("#layer-search-islands")).toBeDisabled();
  await chartroom.clickChart(500, 450);
  await expect(page.locator("#search-inspector")).toBeHidden();
  await toggle("#layer-searches");
  await toggle("#layer-search-lines");
  expect((await chartroom.chart()).layers).toMatchObject({ searches: true, searchLines: false });
  await chartroom.press("l");
  await toggle("#layer-locations");
  await chartroom.clickChart(700, 400);
  expect((await chartroom.chart()).layers.locations, "adding a location shows locations again").toBe(true);
  await page.locator('.app-menu[data-menu="view"] summary').click();
  await page.locator("#layer-grid").click();
  await expect(page.locator('.app-menu[data-menu="view"]'), "checkboxes leave the menu open").toHaveAttribute("open", "");
});

test("a measure line can be kept as a coloured chart line", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("m");
  await chartroom.dragChart({ x: 400, y: 400 }, { x: 600, y: 400 });
  await page.locator("#keep-measure").click();
  await expect(page.locator("#line-colour-row")).toBeVisible();
  await page.locator("#line-colour").selectOption("green");
  await chartroom.press("m");
  await chartroom.dragChart({ x: 400, y: 300 }, { x: 600, y: 300 });
  const chart = await chartroom.chart();
  expect(chart.measures).toHaveLength(1);
  expect(chart.segments).toHaveLength(1);
  expect(chart.segments[0].color).toBe("green");
});

test("a saved route takes new waypoints from its last one", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("r");
  await chartroom.clickChart(400, 300);
  await chartroom.clickChart(500, 300);
  await page.locator("#save-route").click();
  await chartroom.press("v");
  await chartroom.clickChart(450, 300);
  await expect(page.locator("#saved-route-inspector")).toBeVisible();
  await page.locator("#extend-saved-route").click();
  await chartroom.clickChart(600, 400);
  await chartroom.clickChart(700, 400);
  const chart = await chartroom.chart();
  expect(chart.route).toEqual([]);
  expect(chart.savedRoutes[0].points).toHaveLength(4);
});

test("imports a Scrambled Seas save as a chart of its moved islands", async ({ chartroom, page }) => {
  await chartroom.open();
  const vectors = Array.from({ length: 67 }, () => "<Vector3><x>90000</x><y>0</y><z>0</z></Vector3>").join("");
  const xml = `<?xml version="1.0" encoding="utf-8"?><ScrambledSeasSaveContainer><worldScramblerSeed>7</worldScramblerSeed><borderExpander>0</borderExpander><islandOffsets>${vectors}</islandOffsets></ScrambledSeasSaveContainer>`;
  await page.locator("#json-file").setInputFiles({ name: "scramble_0.xml", mimeType: "text/xml", buffer: Buffer.from(xml) });
  await expect(page.locator("#layer-imported-map")).toBeChecked();
  await expect(page.locator("#layer-vanilla")).not.toBeChecked();
  const chart = await chartroom.chart();
  expect(chart.name).toContain("Scrambled Seas 7");
  expect(chart.scramble.islands.find((island) => island.id === "alankh/gold_rock_city").lon).toBeCloseTo(-4.867 + 10, 2);
  await page.locator("#json-file").setInputFiles({ name: "preset.xml", mimeType: "text/xml", buffer: Buffer.from("<ScrambledSeasSaveContainer><islandOffsets /></ScrambledSeasSaveContainer>") });
  await expect(page.locator("#toast")).toContainText("no island positions yet");
});

test("follows Coordinate Viewer live into the chart it started on", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("l");
  await chartroom.clickChart(500, 400);
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track-cv").click();
  await expect(page.locator("#follow-track-cv")).toHaveText("Stop following coords_0.txt");
  // Nothing is saved until the first position arrives, so this waits on the host itself.
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length ?? 0)).toBe(2);
  const [first, second] = (await chartroom.chart()).track;
  expect([first.lat, first.day, second.lon]).toEqual([40.1, "3", 0.6]);
  // The fake Coordinate Viewer writes the wind as 90 and 92: blowing north, then just west of north.
  expect([first.wind, second.wind, second.t]).toEqual(["N", "N", 3 * 24 + 10]);
  await chartroom.press("Control+z");
  const undone = await chartroom.chart();
  expect(undone.features, "undo takes back the location").toHaveLength(0);
  expect(undone.track, "but keeps the live positions").toHaveLength(2);
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track-cv").click();
  await expect(page.locator("#follow-track-cv")).toHaveText("Follow live (Coordinate Viewer)");
});

test("follows a Voyage Recorder log live, with its boat, speed and sessions", async ({ chartroom, page }) => {
  const runs = [
    '{"type":"position","day":3,"hour":9.5,"lat":40.1,"lon":0.5,"event":"start","boat":"medi medium","course":90,"knots":5.2,"windFrom":180,"windKnots":10}\n',
    // A load: the session line arrives in one run and its first position in the next.
    '{"type":"position","day":3,"hour":10,"lat":40.1,"lon":0.6,"boat":"medi medium","course":90,"knots":5.4}\n{"type":"session","day":1,"hour":8}\n',
    '{"type":"position","day":1,"hour":8,"lat":30,"lon":1}\n{"type":"posi'
  ];
  const now = Date.now();
  const choices = [
    { id: 0, name: "slot2.jsonl", place: "", modified: new Date(now - 5 * 60000).toISOString() },
    { id: 1, name: "slot1.jsonl", place: "", modified: new Date(now - 3 * 3600000).toISOString() }
  ];
  await chartroom.open(null, { recording: { name: "slot1.jsonl", runs, choices } });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  // The newest save slot is offered first and selected; the player picks another.
  await expect(page.locator("#slot-dialog")).toBeVisible();
  await expect(page.locator("#slot-list label")).toHaveText(["Save slot 2recorded 5 minutes ago", "Save slot 1recorded 3 hours ago"]);
  await expect(page.locator('#slot-list input[value="0"]')).toBeChecked();
  await page.locator("#slot-list label").nth(1).click();
  await page.locator("#slot-form button.primary").click();
  await expect(page.locator("#follow-track")).toHaveText("Stop following slot1.jsonl");
  expect(await page.evaluate(() => window.__host.follows.at(-1))).toEqual({ log: 1 });
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length ?? 0)).toBe(3);
  const [first, second, third] = (await chartroom.chart()).track;
  expect([first.boat, first.knots, first.course, first.event, first.t]).toEqual(["Brig", 5.2, 90, "start", 3 * 24 + 9.5]);
  // Wind from the south blows north.
  expect([first.wind, first.windDeg]).toEqual(["N", 0]);
  // Following starts a new stretch, since what came before the newest position was left out.
  expect([first.newSession, second.newSession, third.newSession, third.boat]).toEqual([true, undefined, true, undefined]);
});

test("following a recording joins the chart's track and offers the positions it missed", async ({ chartroom, page }) => {
  const line = (hour, lat) => `{"type":"position","day":3,"hour":${hour},"lat":${lat},"lon":0.5}\n`;
  const runs = [line(9, 40) + line(9.5, 40.01) + line(10, 40.02) + line(10.5, 40.03), line(11, 40.04)];
  await chartroom.open(null, { recording: { name: "slot1.jsonl", runs } });
  // The chart already has the first two positions, from following earlier.
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#paste-track").click();
  await page.locator("#paste-text").fill(line(9, 40) + line(9.5, 40.01));
  await page.locator("#paste-form button.primary").click();
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await expect(page.locator("#missing-text")).toHaveText("1 position was recorded since this chart's last one from slot1.jsonl. Add it to the track?");
  await page.locator("#missing-form button.primary").click();
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length ?? 0)).toBe(5);
  const track = (await chartroom.chart()).track;
  expect(track.map((point) => point.lat)).toEqual([40, 40.01, 40.02, 40.03, 40.04]);
  // Filled in, the track runs on without a break.
  expect(track.slice(2).map((point) => point.newSession ?? false)).toEqual([false, false, false]);
});

test("ports and missions noted while following become chart marks", async ({ chartroom, page }) => {
  const runs = [
    '{"type":"position","day":4,"hour":9,"lat":30.6,"lon":-2.45}\n',
    '{"type":"port","day":4,"hour":9.5,"port":"Gold Rock City","island":1,"lat":30.5,"lon":-2.5,"portLat":30.6,"portLon":-2.45}\n'
      + '{"type":"mission","day":4,"hour":10,"origin":"Gold Rock City","originIsland":1,"originLat":30.6,"originLon":-2.45,"destination":"Fort Aestrin","destinationIsland":15,"heading":22.5,"points":16,"miles":214}\n'
  ];
  await chartroom.open(null, { recording: { name: "slot1.jsonl", runs } });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await expect(page.locator("#toast")).toContainText("From Voyage Recorder: Gold Rock City, Fort Aestrin.");
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.searches?.length ?? 0)).toBe(1);
  const chart = await chartroom.chart();
  expect(chart.features.map((feature) => [feature.name, feature.islandId])).toEqual([["Gold Rock City", "alankh/gold_rock_city"]]);
  expect([chart.searches[0].label, chart.searches[0].spreadDeg]).toEqual(["Fort Aestrin", 11.25]);
});

test("following a save slot leaves out its earlier games", async ({ chartroom, page }) => {
  const runs = [
    '{"type":"session","day":2,"hour":6,"game":"aaaa"}\n{"type":"position","day":2,"hour":6,"lat":20,"lon":5}\n'
      + '{"type":"port","day":2,"hour":7,"port":"Gold Rock City","island":1,"lat":30.5,"lon":-2.5,"portLat":30.6,"portLon":-2.45}\n'
      + '{"type":"session","day":1,"hour":8,"game":"bbbb"}\n{"type":"position","day":1,"hour":8,"lat":30,"lon":1}\n',
    // Another new game while following carries on in the same chart.
    '{"type":"session","day":1,"hour":8,"game":"cccc"}\n{"type":"position","day":1,"hour":8,"lat":31,"lon":2}\n'
  ];
  await chartroom.open(null, { recording: { name: "slot1.jsonl", runs } });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await expect(page.locator("#toast")).toContainText("A new game started in this save slot.");
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length ?? 0)).toBe(2);
  const chart = await chartroom.chart();
  expect(chart.track.map((point) => [point.lat, point.newSession ?? false])).toEqual([[30, true], [31, true]]);
  expect(chart.features, "the earlier game's port isn't charted").toHaveLength(0);
});

test("a new game is noticed after a first run without positions", async ({ chartroom, page }) => {
  const runs = [
    '{"type":"session","day":2,"hour":6,"game":"aaaa"}\n{"type":"port","day":2,"hour":7,"port":"Gold Rock City","island":1,"lat":30.5,"lon":-2.5,"portLat":30.6,"portLon":-2.45}\n',
    '{"type":"session","day":1,"hour":8,"game":"bbbb"}\n{"type":"position","day":1,"hour":8,"lat":30,"lon":1}\n'
  ];
  await chartroom.open(null, { recording: { name: "slot1.jsonl", runs } });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await expect(page.locator("#toast")).toContainText("A new game started in this save slot.");
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length ?? 0)).toBe(1);
  expect((await chartroom.chart()).features.map((feature) => feature.name), "the port came while following, so it stays").toEqual(["Gold Rock City"]);
});

test("the macOS app offers live following too", async ({ chartroom, page }) => {
  await chartroom.open(null, { platform: "mac" });
  await expect(page.locator("#follow-track")).toBeVisible({ visible: false });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await expect(page.locator("#follow-track")).toBeVisible();
});

test("a route copies for SailMaster as a web map path", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("r");
  await chartroom.clickChart(400, 300);
  await chartroom.clickChart(600, 300);
  await page.locator("#copy-sailmaster").click();
  const copied = await page.evaluate(() => window.__host.copied);
  const route = JSON.parse(copied);
  expect(route.path).toHaveLength(2);
  expect(route.path.every((entry) => entry.colour === "orangepoint" && entry.pos.length === 2)).toBe(true);
});

test("a Coordinate Viewer position can be selected, edited and deleted", async ({ chartroom, page }) => {
  await chartroom.open();
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track-cv").click();
  // Nothing is saved until the first position arrives, so this waits on the host itself.
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length ?? 0)).toBe(2);
  await page.keyboard.press("Escape");
  const box = await chartroom.canvas.boundingBox();
  const spot = await page.evaluate(() => {
    const canvas = document.querySelector("#chart-canvas").getBoundingClientRect();
    return { width: canvas.width, height: canvas.height };
  });
  await chartroom.clickChart(spot.width / 2, spot.height / 2);
  await expect(page.locator("#track-inspector")).toBeVisible();
  await page.locator("#track-name").fill("Noon fix");
  await page.locator("#track-name").press("Tab");
  expect((await chartroom.chart()).track.map((point) => point.name)).toContain("Noon fix");
  await chartroom.press("Delete");
  expect((await chartroom.chart()).track).toHaveLength(1);
});

const seaWith = (items) => ({ activeChartId: "sea", charts: [{ id: "sea", name: "Sea", view: { lat: 20, lon: 0, zoom: 2.5 }, ...items }] });

test("the last recorded position sits above a location at the same spot and is picked first", async ({ chartroom, page }) => {
  await chartroom.open(seaWith({
    features: [{ id: "harbour", lat: 20, lon: 0, name: "Harbour" }],
    track: [{ id: "earlier", lat: 19.5, lon: -0.5 }, { id: "latest", lat: 20, lon: 0 }]
  }));
  const spot = await page.evaluate(() => {
    const canvas = document.querySelector("#chart-canvas").getBoundingClientRect();
    return { width: canvas.width, height: canvas.height };
  });
  await chartroom.clickChart(spot.width / 2, spot.height / 2);
  await expect(page.locator("#track-inspector")).toBeVisible();
});

test("a circumnavigation chart routes across the edge the short way", async ({ chartroom, page }) => {
  await chartroom.open(seaWith({ route: [{ id: "a", lat: 20, lon: 170 }, { id: "b", lat: 20, lon: -170 }, { id: "c", lat: 10, lon: -160 }] }));
  await expect(page.locator("#route-distance")).toContainText("49,580");
  await page.locator("#route-circumnavigation").check();
  await expect.poll(async () => (await chartroom.chart()).circumnavigation).toBe(true);
  // 20° east across the edge, then 10° south and 10° east.
  await expect(page.locator("#route-distance")).toHaveText(`${Math.round(20 * 140 + Math.hypot(10, 10) * 140).toLocaleString()} nm`);
  await page.locator("#route-circumnavigation").uncheck();
  await expect(page.locator("#route-distance")).toContainText("49,580");
});

test("locked items stay put until unlocked from the inspector or the Edit menu", async ({ chartroom, page }) => {
  await chartroom.open(seaWith({ view: { lat: 0, lon: 0, zoom: 20 }, features: [{ id: "rock", lat: 0, lon: 0, name: "Rock" }] }));
  await chartroom.items().first().click();
  const lock = page.locator("#feature-inspector [data-lock]");
  await lock.click();
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#feature-lat")).toBeDisabled();
  await expect(chartroom.items().first()).toContainText("Locked");
  const box = await chartroom.canvas.boundingBox();
  const centre = { x: box.width / 2, y: box.height / 2 };
  await chartroom.dragChart(centre, { x: centre.x + 80, y: centre.y + 40 });
  const [rock] = (await chartroom.chart()).features;
  expect([rock.lat, rock.lon, rock.locked]).toEqual([0, 0, true]);
  await page.locator("[data-menu=edit] summary").click();
  await page.locator("#unlock-selected").click();
  await expect.poll(async () => (await chartroom.chart()).features[0].locked).toBeUndefined();
  await expect(page.locator("#feature-lat")).toBeEnabled();
});

test("a location keeps several boats chosen from the library", async ({ chartroom, page }) => {
  await chartroom.open(seaWith({ features: [{ id: "port", lat: 0, lon: 0, name: "Port", boatId: "vanilla/dhow" }] }));
  await chartroom.items().first().click();
  await expect(page.locator("#feature-boat-status")).toContainText("Dhow");
  await page.locator("#choose-feature-boat").click();
  await page.locator(".boat-row", { hasText: "Cog" }).click();
  await expect(page.locator("#boat-dialog")).toBeVisible();
  await expect.poll(async () => (await chartroom.chart()).features[0].boatIds).toEqual(["vanilla/dhow", "vanilla/cog"]);
  await page.locator(".boat-row", { hasText: "Dhow" }).first().click();
  await expect.poll(async () => (await chartroom.chart()).features[0].boatIds).toEqual(["vanilla/cog"]);
  await page.locator("#boat-dialog [data-close]").click();
  await expect(page.locator("#feature-boat-status")).toContainText("Cog");
});

test("zooms in far enough for a small island to fill the chart", async ({ chartroom, page }) => {
  await chartroom.open(seaWith({ view: { lat: 0, lon: 0, zoom: 500 } }));
  const box = await chartroom.canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 30; step += 1) await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await chartroom.chart()).view.zoom).toBeGreaterThan(50000);
});

test("renaming a precisely placed location leaves it where it is", async ({ chartroom, page }) => {
  await chartroom.open(seaWith({ view: { lat: 0.123456, lon: 0.654321, zoom: 90000 }, features: [{ id: "buoy", lat: 0.123456, lon: 0.654321, name: "Buoy" }] }));
  await chartroom.items().first().click();
  await page.locator("#feature-name").fill("Bell buoy");
  await page.locator("#feature-name").press("Enter");
  await expect.poll(async () => (await chartroom.chart()).features[0].name).toBe("Bell buoy");
  const [buoy] = (await chartroom.chart()).features;
  expect([buoy.lat, buoy.lon]).toEqual([0.123456, 0.654321]);
});

const atSea = (items) => seaWith({ view: { lat: 30.6, lon: -4.45, zoom: 400 }, ...items });

test("dead reckoning carries on from the latest position, or from a point clicked on the chart", async ({ chartroom, page }) => {
  await chartroom.open(atSea({ track: [{ id: "cv", lat: 30.6, lon: -4.6, t: 3 * 24 + 10, day: "3", time: "10:00", windDeg: 45 }] }));
  await chartroom.press("d");
  await expect(page.locator("#dr-panel")).toBeVisible();
  await expect(page.locator("#dr-from-label")).toHaveText("Your latest recorded position, day 3 10:00");
  await expect(page.locator("#dr-percent").locator("..")).toHaveAttribute("title", /share of the distance sailed/);
  await page.locator("#dr-course").fill("E");
  await page.locator("#dr-speed").fill("6");
  await page.locator("#dr-hours").fill("2");
  await page.getByRole("button", { name: "Plot DR position" }).click();
  const [dr] = (await chartroom.chart()).drPositions;
  expect([dr.lat, dr.t, dr.course, dr.from.lon]).toEqual([30.6, 3 * 24 + 12, 90, -4.6]);
  expect(dr.sigmaNm, "10% of the 12 nm sailed").toBeCloseTo(1.2, 9);
  expect(dr.lon).toBeCloseTo(-4.6 + 12 / 140, 9);
  await expect(page.locator("#dr-inspector")).toBeVisible();
  await expect(page.locator("#dr-from-label")).toHaveText("Your latest DR position, day 3 12:00");

  // A click on open water starts the next one there, until the latest position is chosen again.
  await chartroom.clickChart(100, 100);
  await expect(page.locator("#dr-from-label")).toHaveText(/° N · /);
  await expect(page.locator("#dr-from-latest")).toBeVisible();
  await page.locator("#dr-from-latest").click();
  await expect(page.locator("#dr-from-label")).toHaveText("Your latest DR position, day 3 12:00");

  await page.locator('.app-menu[data-menu="view"] > summary').click();
  await page.locator("#layer-dead-reckoning").uncheck();
  await expect.poll(async () => (await chartroom.chart()).layers.deadReckoning).toBe(false);
});

test("the game clock speeds up passages and dead reckoning on a slowed clock, set from either panel", async ({ chartroom, page }) => {
  await chartroom.open(atSea({ speedKn: 6, track: [{ id: "cv", lat: 30.6, lon: -4.6, t: 3 * 24 + 10, day: "3", time: "10:00" }] }));
  await chartroom.press("r");
  await chartroom.clickChart(400, 300);
  await chartroom.clickChart(600, 300);
  const eta = await page.locator("#route-eta").textContent();
  await page.locator("#route-clock").fill("50");
  await page.locator("#route-clock").press("Tab");
  await expect.poll(async () => (await chartroom.chart()).clockPercent).toBe(50);
  await expect(page.locator("#route-eta")).not.toHaveText(eta);
  await chartroom.press("Escape");
  await chartroom.press("d");
  await expect(page.locator("#dr-clock")).toHaveValue("50");
  await page.locator("#dr-course").fill("E");
  await page.locator("#dr-speed").fill("6");
  await page.locator("#dr-hours").fill("2");
  await page.getByRole("button", { name: "Plot DR position" }).click();
  const [dr] = (await chartroom.chart()).drPositions;
  expect(dr.lon, "6 kn for 2 game hours at half clock covers 24 nm").toBeCloseTo(-4.6 + 24 / 140, 9);
  await expect(page.locator("#dr-detail")).toContainText("Distance: 24");
  await expect(page.locator("#dr-detail")).toContainText("Game clock: 50%");
});

test("Chart details sets the game clock, and a new chart starts on the open chart's clock", async ({ chartroom, page }) => {
  await chartroom.open();
  await page.locator('.app-menu[data-menu="file"] > summary').click();
  await page.locator("#chart-settings").click();
  await expect(page.locator("#dialog-chart-clock")).toHaveValue("100");
  await page.locator("#dialog-chart-clock").fill("50");
  await page.getByRole("button", { name: "Save chart" }).click();
  await expect.poll(async () => (await chartroom.chart()).clockPercent).toBe(50);
  await page.locator('.app-menu[data-menu="file"] > summary').click();
  await page.locator("#new-chart").click();
  await expect(page.locator("#dialog-chart-clock")).toHaveValue("50");
});

test("naming a location after a search area removes the search area, and undo brings it back", async ({ chartroom, page }) => {
  await chartroom.open(seaWith({ searches: [{ id: "hunt", lat: 20, lon: -1, bearing: 90, distanceNm: 60, spreadDeg: 20, label: "Gold Rock" }] }));
  await chartroom.press("l");
  await chartroom.clickChart(600, 400);
  await page.locator("#feature-name").fill("gold rock");
  await page.locator("#feature-name").press("Enter");
  await expect.poll(async () => (await chartroom.chart()).searches.length).toBe(0);
  await expect(page.locator("#toast")).toHaveText("Removed the search area for gold rock. Undo brings it back.");
  await chartroom.press("Control+z");
  await expect.poll(async () => (await chartroom.chart()).searches.map((search) => search.id)).toEqual(["hunt"]);
});

test("selected track positions show their figures and save as a route", async ({ chartroom, page }) => {
  await chartroom.open(seaWith({
    view: { lat: 0, lon: 0.01, zoom: 2000 },
    track: [{ id: "t1", lat: 0, lon: 0, t: 10 }, { id: "t2", lat: 0, lon: 0.01, t: 10.5 }, { id: "t3", lat: 0, lon: 0.02, t: 11 }]
  }));
  const box = await chartroom.canvas.boundingBox();
  await chartroom.dragChart({ x: 20, y: 20 }, { x: box.width - 20, y: box.height - 20 }, { modifiers: ["Shift"] });
  await expect(page.locator("#track-selection")).toBeVisible();
  await expect(page.locator("#track-selection-detail")).toContainText("3 positions");
  await page.locator("#track-to-route").click();
  const [route] = (await chartroom.chart()).savedRoutes;
  expect(route.points.map((point) => point.lon)).toEqual([0, 0.02]);
});

test("View hides only the lines between recorded positions", async ({ chartroom, page }) => {
  const track = [{ id: "t1", lat: 0, lon: 0, t: 10 }, { id: "t2", lat: 0, lon: 0.01, t: 10.5 }, { id: "t3", lat: 0, lon: 0.02, t: 11 }];
  await chartroom.open(seaWith({ view: { lat: 0, lon: 0.01, zoom: 2000 }, track }));
  const picture = () => page.locator("#chart-canvas").evaluate((canvas) => canvas.toDataURL());
  const withLines = await picture();
  await page.locator('.app-menu[data-menu="view"] > summary').click();
  await expect(page.locator("#layer-track-lines")).toBeChecked();
  await page.locator("#layer-track-lines").uncheck();
  await expect(page.locator("#layer-track")).toBeChecked();
  await expect(page.locator("#layer-track-cv")).toBeChecked();
  await page.keyboard.press("Escape");
  expect(await picture()).not.toBe(withLines);
  expect((await chartroom.chart()).track).toHaveLength(3);
  expect((await chartroom.chart()).layers.trackLines).toBe(false);
  const canvas = await chartroom.canvas.boundingBox();
  await chartroom.clickChart(canvas.width / 2, canvas.height / 2);
  await expect(page.locator("#track-inspector")).toBeVisible();
});

test("View hides Voyage Recorder automatic and manual locations separately", async ({ chartroom, page }) => {
  const track = [
    { id: "cv", lat: 0, lon: -0.03, t: 9 },
    { id: "automatic", lat: 0, lon: -0.02, t: 10, source: "voyage" },
    { id: "manual", lat: 0, lon: -0.01, t: 11, source: "voyage", event: "mark" },
    { id: "race", lat: 0, lon: 0.01, t: 12, source: "voyage", event: "race-start" },
    { id: "latest", lat: 0, lon: 0.03, t: 13, source: "voyage" }
  ];
  await chartroom.open(seaWith({ view: { lat: 0, lon: 0, zoom: 2000 }, track }));
  const picture = () => page.locator("#chart-canvas").evaluate((canvas) => canvas.toDataURL());
  const allLocations = await picture();

  await page.locator('.app-menu[data-menu="view"] > summary').click();
  await expect(page.locator("label:has(#layer-track-winds) span")).toHaveText("Wind direction");
  await expect(page.locator("#layer-track-voyage-automatic")).toBeChecked();
  await expect(page.locator("#layer-track-voyage-manual")).toBeChecked();
  await page.locator("#layer-track-voyage-automatic").uncheck();
  const withoutAutomatic = await picture();
  expect(withoutAutomatic).not.toBe(allLocations);

  await page.keyboard.press("Escape");
  const canvas = await chartroom.canvas.boundingBox();
  await chartroom.clickChart(canvas.width / 2 + 60, canvas.height / 2);
  await expect(page.locator("#track-inspector"), "a hidden automatic reading takes its arrow with it").toBeHidden();
  await chartroom.clickChart(canvas.width / 2 + 20, canvas.height / 2);
  await expect(page.locator("#track-inspector"), "the last shown position is still selectable").toBeVisible();
  await page.locator('.app-menu[data-menu="view"] > summary').click();
  await page.locator("#layer-track-voyage-manual").uncheck();
  const withoutVoyageLocations = await picture();
  expect(withoutVoyageLocations).not.toBe(withoutAutomatic);

  await page.locator("#layer-track-cv").uncheck();
  expect(await picture(), "Coordinate Viewer remains visible until its own control is changed").not.toBe(withoutVoyageLocations);
  const chart = await chartroom.chart();
  expect(chart.track).toHaveLength(5);
  expect([chart.layers.trackVoyageAutomaticLocations, chart.layers.trackVoyageManualLocations]).toEqual([false, false]);
});

test("the top bar toggles show and hide the side panels", async ({ chartroom, page }) => {
  await chartroom.open();
  await expect(page.locator("#show-left-panel")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#show-left-panel").click();
  await expect(page.locator("body")).toHaveClass(/left-panel-hidden/);
  await expect(page.locator("#show-left-panel")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#show-right-panel").click();
  await expect(page.locator("body")).toHaveClass(/right-panel-hidden/);
  await page.locator("#show-left-panel").click();
  await expect(page.locator("body")).not.toHaveClass(/left-panel-hidden/);
});

test("floating panels stay accessible when sidebars resize", async ({ chartroom, page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await chartroom.open({
    activeChartId: "sea",
    layout: { leftWidth: 190, rightWidth: 190, leftOpen: true, rightOpen: true },
    settings: {
      trackKey: true,
      overlay: { shown: true, x: 0.02, y: 0.08 },
      routePanel: { shown: true, x: 1, y: 0.02 },
      trackKeyPanel: { x: 0.5, y: 0.6 }
    },
    charts: [{ id: "sea", name: "Sea", view: { lat: 0, lon: 0, zoom: 20 }, route: [{ id: "a", lat: 0, lon: 0 }, { id: "b", lat: 1, lon: 1 }] }]
  });
  const ids = ["route-summary", "track-key", "key-overlay"];
  const positions = () => page.evaluate((panelIds) => {
    const stage = document.querySelector("#chart-canvas").getBoundingClientRect();
    return Object.fromEntries(panelIds.map((id) => {
      const box = document.querySelector(`#${id}`).getBoundingClientRect();
      return [id, { left: box.left - stage.left, right: box.right - stage.left, width: stage.width }];
    }));
  }, ids);
  const expectInside = async () => {
    const current = await positions();
    for (const id of ids) {
      expect(current[id].left, `${id} left edge`).toBeGreaterThanOrEqual(0);
      expect(current[id].right, `${id} right edge`).toBeLessThanOrEqual(current[id].width + 1);
    }
    return current;
  };
  await expectInside();
  await page.locator("#right-panel-resizer").focus();
  for (let step = 0; step < 15; step += 1) await page.keyboard.press("ArrowLeft");
  const afterRight = await expectInside();
  expect(Math.round(afterRight["route-summary"].right), "a panel at the right edge stays there").toBe(Math.round(afterRight["route-summary"].width));
  await page.locator("#left-panel-resizer").focus();
  for (let step = 0; step < 15; step += 1) await page.keyboard.press("ArrowRight");
  await expectInside();
  await page.locator("#show-right-panel").click();
  const wider = await expectInside();
  expect(Math.round(wider["route-summary"].right), "and stays there when the chart widens").toBe(Math.round(wider["route-summary"].width));
  await page.locator("#show-right-panel").click();
  await expectInside();
  await chartroom.saved();
  await page.reload();
  await expect(page.locator("#app-version")).toHaveText("9.9.9");
  await expectInside();
});

test("undo after moving a recorded position puts it back, and earlier history keeps it too", async ({ chartroom, page }) => {
  await chartroom.open(seaWith({ view: { lat: 0, lon: 0, zoom: 200 }, track: [{ id: "cv", lat: 0, lon: 0, t: 30, day: "1", time: "06:00" }] }));
  const centre = await page.evaluate(() => {
    const canvas = document.querySelector("#chart-canvas").getBoundingClientRect();
    return { x: canvas.width / 2, y: canvas.height / 2 };
  });
  await chartroom.press("l");
  await chartroom.clickChart(centre.x + 150, centre.y + 100);
  await page.keyboard.press("Escape");
  await chartroom.dragChart(centre, { x: centre.x + 60, y: centre.y });
  await expect.poll(async () => (await chartroom.chart()).track[0].lon).toBeGreaterThan(0.2);
  await chartroom.press("Control+z");
  await expect.poll(async () => (await chartroom.chart()).track[0].lon).toBe(0);
  await chartroom.press("Control+z");
  const chart = await chartroom.chart();
  expect(chart.features).toHaveLength(0);
  expect(chart.track[0].lon).toBe(0);
});

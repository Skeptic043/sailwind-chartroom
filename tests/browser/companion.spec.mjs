import { test, expect } from "./harness.mjs";

const lines = (...records) => records.map((record) => JSON.stringify(record)).join("\n") + "\n";

test("a note's popout opens beside its icon, follows it, flips at the edge and saves its text", async ({ chartroom, page }) => {
  await chartroom.open();
  const box = await chartroom.canvas.boundingBox();
  await chartroom.press("n");
  await chartroom.clickChart(300, 300);
  const popout = page.locator("#note-popout");
  await expect(popout).toBeVisible();
  await expect(popout).toHaveClass(/right/);
  const before = await popout.boundingBox();
  expect(before.x).toBeGreaterThan(box.x + 300);
  await page.locator("#note-popout-text").fill("Whales off the bow\nthree of them");
  await page.locator("#note-popout-close").click();
  await expect(popout).toBeHidden();
  expect((await chartroom.chart()).notes[0].text).toBe("Whales off the bow\nthree of them");
  // Clicking the icon opens it again; panning the chart carries it along.
  await chartroom.clickChart(300, 300);
  await expect(popout).toBeVisible();
  await chartroom.dragChart({ x: 450, y: 500 }, { x: 400, y: 450 });
  await expect.poll(async () => Math.round((await popout.boundingBox()).x - before.x)).toBe(-50);
  // Near the right edge it opens on the icon's left.
  await chartroom.press("n");
  await chartroom.clickChart(box.width - 30, 300);
  await expect(popout).toHaveClass(/left/);
  expect((await popout.boundingBox()).x + (await popout.boundingBox()).width).toBeLessThan(box.x + box.width - 30);
  await expect(chartroom.items().filter({ hasText: "Whales off the bow" })).toHaveCount(1);
});

// Safari's engine, which the macOS app uses, doesn't focus buttons and checkboxes when they're clicked, so
// each step clicks inside and then leaves focus on the page, as a Mac does.
test("Escape closes a menu and the note popout when focus is outside them", async ({ chartroom, page }) => {
  await chartroom.open();
  const blur = () => page.evaluate(() => document.activeElement?.blur());
  const view = page.locator('.app-menu[data-menu="view"]');
  await view.locator("summary").click();
  await page.locator("#layer-track-key").check();
  await blur();
  await page.keyboard.press("Escape");
  await expect(view).not.toHaveAttribute("open", "");
  await expect(page.locator("#layer-track-key")).toBeChecked();
  await expect(page.locator("#track-key")).toBeVisible();
  // A dialog that opens by itself over an open menu, like Follow live's, closes with one Escape.
  await view.locator("summary").click();
  await page.evaluate(() => document.querySelector("#missing-dialog").showModal());
  await page.keyboard.press("Escape");
  await expect(page.locator("#missing-dialog")).toBeHidden();

  await page.keyboard.press("Escape");
  await chartroom.press("n");
  await chartroom.clickChart(300, 300);
  const popout = page.locator("#note-popout");
  await expect(popout).toBeVisible();
  await page.locator("#note-popout-text").click();
  await blur();
  await page.keyboard.press("Escape");
  await expect(popout).toBeHidden();

  // Once focus moves on, Escape is the chart's again and the popout stays open.
  await chartroom.clickChart(300, 300);
  await expect(popout).toBeVisible();
  await page.locator("#note-popout-text").click();
  await chartroom.canvas.focus();
  await page.keyboard.press("Escape");
  await expect(popout).toBeVisible();
});

test("the encounter tool places whales that can be changed and resized, and plain locations have no icon", async ({ chartroom, page }) => {
  await chartroom.open();
  await chartroom.press("e");
  await chartroom.clickChart(400, 300);
  await expect(page.locator("#feature-kind")).toHaveText("Selected encounter");
  expect((await chartroom.chart()).features[0]).toMatchObject({ icon: "whales", name: "Whales" });
  // It opens beside its icon for notes, like a note.
  await expect(page.locator("#note-popout")).toBeVisible();
  await expect(page.locator("#note-popout-title")).toHaveValue("Whales");
  // The button beside close switches the encounter's type, renaming it while it has its type's name.
  await page.locator("#note-popout-type").click();
  await page.locator(".popout-type-item", { hasText: "Dense fog" }).first().click();
  await expect.poll(async () => (await chartroom.chart()).features[0]).toMatchObject({ icon: "fog", name: "Dense fog" });
  await page.locator("#note-popout-type").click();
  await page.locator(".popout-type-item", { hasText: /^Whales$/ }).click();
  await expect(page.locator("#note-popout-title")).toHaveValue("Whales");
  await page.locator("#note-popout-text").fill("A pod heading north");
  await page.locator("#note-popout-close").click();
  await expect.poll(async () => (await chartroom.chart()).features[0].notes).toBe("A pod heading north");
  await expect(page.locator("#feature-icon option")).toHaveCount(7);
  await page.locator("#feature-icon").selectOption("flotsam-whales");
  await page.locator("#feature-size").selectOption("small");
  expect((await chartroom.chart()).features[0]).toMatchObject({ icon: "flotsam-whales", size: "small", name: "Flotsam and whales" });
  await expect(page.locator("#feature-name")).toHaveValue("Flotsam and whales");
  // A name the player chose stays when the type changes.
  await page.locator("#feature-name").fill("Big pod");
  await page.locator("#feature-name").press("Tab");
  await page.locator("#feature-icon").selectOption("whales");
  expect((await chartroom.chart()).features[0]).toMatchObject({ icon: "whales", name: "Big pod" });
  await chartroom.press("l");
  await chartroom.clickChart(200, 200);
  await expect(page.locator("#feature-icon-row")).toBeHidden();
  await page.locator("#feature-size").selectOption("tiny");
  const plain = (await chartroom.chart()).features[1];
  expect(plain.icon).toBeUndefined();
  expect(plain.size).toBe("tiny");
});

test("following Voyage Recorder adds its notes once and shows its keys in the overlay", async ({ chartroom, page }) => {
  const runs = [
    lines(
      { type: "session", day: 3, hour: 9, game: "g1", world: { kind: "vanilla" }, keys: { record: "J", location: "V", note: "N" } },
      { type: "position", day: 3, hour: 9.5, lat: 40.1, lon: 0.5, event: "start" },
      { type: "note", id: "n1", day: 3, hour: 9.6, lat: 40.15, lon: 0.55, text: "Fog bank to the north" }
    ),
    lines({ type: "keys", keys: { record: "LeftControl + J", location: "V", note: "N" } }, { type: "position", day: 3, hour: 10, lat: 40.2, lon: 0.6 })
  ];
  await chartroom.open(null, { recording: { name: "slot1.jsonl", runs } });
  await page.locator("#show-key-overlay").click();
  await expect(page.locator("#show-key-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#key-overlay td.key")).toHaveText(["J", "V", "Shift + V"]);
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.notes?.length ?? 0)).toBe(1);
  const chart = await chartroom.chart();
  expect(chart.notes[0]).toMatchObject({ recorderId: "n1", text: "Fog bank to the north" });
  expect(chart.recording.world).toEqual({ kind: "vanilla" });
  await expect(page.locator("#key-overlay td.key")).toHaveText(["Ctrl + J", "V", "Shift + V"]);
  await page.locator("#show-key-overlay").click();
  await expect(page.locator("#key-overlay")).toBeHidden();
});

test("landfall-only imports and live updates share map locations across reloads", async ({ chartroom, page }) => {
  const session = { type: "session", game: "g1", world: { kind: "vanilla" } };
  const atoll = { type: "landfall", day: 3, hour: 9, source: "terra-incognita", islandId: "terra incognita Atoll (route) #12", name: "Atoll (route) #12", lat: 30.201, lon: -2.451, islandLat: 30.205, islandLon: -2.455 };
  const atollLabel = "Atoll #12";
  const boneIsle = { type: "landfall", day: 3, hour: 10, source: "native", islandId: "36", lat: 39, lon: 4, islandLat: 39.01, islandLon: 4.01 };
  const file = { name: "slot1.jsonl", mimeType: "text/plain", buffer: Buffer.from(lines(session, atoll)) };
  const workspace = { activeChartId: "landfalls", charts: [{ id: "landfalls", layers: { vanillaMap: true, secretIslands: true }, searches: [
    { id: "bone-search", lat: 39, lon: 3.5, bearing: 90, distanceNm: 70, label: "bone isle" },
    { id: "oasis-search", lat: 31, lon: -4, bearing: 90, distanceNm: 70, label: "Oasis" }
  ] }] };
  await chartroom.open(workspace, { recording: { name: file.name, runs: [lines(session, atoll), lines({ ...atoll, lat: 30.208 }, boneIsle)] } });
  await page.locator("#track-file").setInputFiles(file);
  await expect(chartroom.items().filter({ hasText: atollLabel })).toHaveCount(1);
  const screen = await page.evaluate(async ({ lat, lon }) => (await import("/src/viewport.mjs")).worldToScreen({ lat, lon }), atoll);
  await chartroom.clickChart(screen.x, screen.y);
  await expect(page.locator("#feature-name")).toHaveValue(atollLabel);

  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.features?.length ?? 0)).toBe(2);
  await expect(chartroom.items().filter({ hasText: "Bone Isle" })).toHaveCount(1);
  const chart = await chartroom.chart();
  expect(chart.features[0]).toMatchObject({ name: atollLabel, lat: atoll.lat, lon: atoll.lon, showIsland: false });
  expect(chart.features[1]).toMatchObject({ name: "Bone Isle", islandId: "aestrin/bone_isle", showIsland: true });
  expect(chart.searches.map(({ label }) => label)).toEqual(["Oasis"]);
  expect(chart.track).toHaveLength(0);

  await page.reload();
  await expect(chartroom.items().filter({ hasText: "Bone Isle" })).toHaveCount(1);
  await page.locator("#track-file").setInputFiles(file);
  expect((await chartroom.chart()).features.map(({ id }) => id)).toEqual(chart.features.map(({ id }) => id));
});

test("a recorded location on a relocated island draws the shifted outline", async ({ chartroom, page }) => {
  const session = { type: "session", game: "g1", world: { kind: "scrambled", layout: "test" } };
  const mark = { type: "position", event: "mark", day: 3, hour: 9, lat: 34.3, lon: 13.02 };
  const landfall = { ...mark, type: "landfall", source: "native", islandId: "38", islandLat: 34.32, islandLon: 13.03, offsetLat: 2.875, offsetLon: 7.75 };
  await chartroom.open(null, { recording: { name: "slot1.jsonl", runs: [lines(session), lines(mark, landfall)] } });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await expect(chartroom.items().filter({ hasText: "Turtle Island" })).toHaveCount(1);
  const chart = await chartroom.chart();
  expect(chart.features[0]).toMatchObject({ islandId: "emerald/turtle_island", showIsland: true });
  expect(chart.features[0].lat).toBeCloseTo(31.43298 + landfall.offsetLat, 6);
  expect(chart.features[0].lon).toBeCloseTo(5.2606 + landfall.offsetLon, 6);
});

test("small island locations draw their outlines without oversized dots", async ({ chartroom, page }) => {
  await chartroom.open({ activeChartId: "islands", charts: [{ id: "islands", view: { lat: 34, lon: 13, zoom: 16 }, features: [
    { id: "discovered", lat: 34.3, lon: 13.02, name: "Turtle Island", islandId: "emerald/turtle_island",
      discovery: { source: "native", islandId: "38", islandLat: 34.32, islandLon: 13.03 } },
    { id: "manual", lat: 31.43, lon: 10, name: "My island", islandId: "emerald/turtle_island" },
    { id: "pin", lat: 35, lon: 15, name: "Just a pin", showIsland: false }
  ] }] });
  const result = await page.evaluate(async () => {
    const { activeChart } = await import("/src/state.mjs");
    const { drawChart } = await import("/src/render.mjs");
    const { chartIsland, islandPixelSpan, worldToScreen } = await import("/src/viewport.mjs");
    const points = activeChart().features.map((feature) => ({ ...worldToScreen(feature), arcs: 0 }));
    const context = document.querySelector("#chart-canvas").getContext("2d");
    const arc = context.arc;
    context.arc = function (x, y, ...args) {
      for (const point of points) {
        if (Math.abs(point.x - x) < 1e-6 && Math.abs(point.y - y) < 1e-6) point.arcs++;
      }
      return arc.call(this, x, y, ...args);
    };
    try { drawChart(); } finally { context.arc = arc; }
    return { span: islandPixelSpan(chartIsland(activeChart().features[0])), arcs: points.map(({ arcs }) => arcs) };
  });
  expect(result.span).toBeLessThan(5);
  expect(result.arcs).toEqual([0, 0, 1]);
});

test("following a later port arrival upgrades the imported landing and preserves it through undo", async ({ chartroom, page }) => {
  const session = { type: "session", game: "g1", world: { kind: "scrambled", layout: "test" } };
  const landing = { type: "landfall", day: 3, hour: 9, source: "native", islandId: "38",
    lat: 34.31, lon: 13.02, islandLat: 34.32, islandLon: 13.03 };
  const port = { type: "port", day: 3, hour: 10, island: 38, port: "Turtle Island",
    lat: landing.islandLat, lon: landing.islandLon, offsetLat: 2.875, offsetLon: 7.75 };
  const depart = { type: "depart", day: 3, hour: 11, island: port.island, port: port.port };
  const file = { name: "slot1.jsonl", mimeType: "text/plain" };
  await chartroom.open(null, { recording: { name: file.name, runs: [lines(session, port, depart)] } });
  await page.locator("#track-file").setInputFiles({ ...file, buffer: Buffer.from(lines(session, landing)) });
  const imported = (await chartroom.chart()).features[0];
  expect(imported).toMatchObject({ islandId: "emerald/turtle_island", showIsland: false });

  const screen = await page.evaluate(async ({ lat, lon }) => (await import("/src/viewport.mjs")).worldToScreen({ lat, lon }), landing);
  await chartroom.clickChart(screen.x, screen.y);
  const name = page.locator("#feature-name");
  await expect(name).toHaveValue("Turtle Island");
  await name.fill("My landing");
  await name.press("Tab");
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await expect.poll(async () => (await chartroom.chart()).visits.map(({ kind }) => kind)).toEqual(["arrive", "depart"]);
  const checkOutline = async (expectedName) => {
    const { features } = await chartroom.chart();
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ id: imported.id, name: expectedName, showIsland: true });
    expect(features[0].lat).toBeCloseTo(34.30798, 6);
    expect(features[0].lon).toBeCloseTo(13.01060, 6);
  };
  await checkOutline("My landing");

  await chartroom.press("Control+z");
  await checkOutline("Turtle Island");
  await page.reload();
  await page.locator("#track-file").setInputFiles({ ...file, buffer: Buffer.from(lines(session, landing, port, depart)) });
  await checkOutline("Turtle Island");
  expect((await chartroom.chart()).visits.map(({ kind }) => kind)).toEqual(["arrive", "depart"]);
});

test("equipment readings are switched on per chart with the instruments the player has", async ({ chartroom, page }) => {
  await chartroom.open();
  await page.locator("#equipment-panel > summary").click();
  await expect(page.locator("#equipment-items input")).toHaveCount(6);
  await expect(page.locator("#equipment-items input").first()).toBeDisabled();
  await page.locator("#equipment-enabled").check();
  await page.locator("#equipment-items label", { hasText: "Quadrant" }).locator("input").check();
  const { equipment } = await chartroom.chart();
  expect(equipment.enabled).toBe(true);
  expect(equipment.changes.at(-1).items).toEqual(["quadrant"]);
});

test("Manage charts sorts charts into folders that the Active chart menu shows", async ({ chartroom, page }) => {
  await chartroom.open({ charts: [{ id: "a", name: "First" }, { id: "b", name: "Second" }], activeChartId: "a" });
  await page.locator('.app-menu[data-menu="file"] > summary').click();
  await page.locator("#manage-charts").click();
  await page.locator("#manage-new-folder").click();
  await page.locator('#manage-list [data-folder] input').fill("Races");
  await page.locator('#manage-list [data-folder] input').press("Enter");
  await page.locator('#manage-list [data-chart="b"]').click();
  await page.locator("#manage-move").selectOption({ label: "Races" });
  await expect(page.locator("#manage-path")).toHaveText("Races › Second");
  await page.locator('#manage-list [data-chart="b"]').dblclick();
  await page.locator('#manage-list [data-chart="b"] input').fill("Second race");
  await page.locator('#manage-list [data-chart="b"] input').press("Enter");
  await expect(page.locator("#manage-path")).toHaveText("Races › Second race");
  await page.locator('#manage-list [data-chart="b"]').dblclick();
  await page.locator('#manage-list [data-chart="b"] input').fill("Second");
  await page.locator('#manage-list [data-chart="b"] input').press("Enter");
  await expect(page.locator("#manage-list .manage-row .manage-name")).toHaveText(["Races", "Second", "First"]);
  await expect(page.locator("#chart-select optgroup")).toHaveAttribute("label", "Races");
  await expect(page.locator("#chart-select optgroup option")).toHaveText(["Second"]);
  const saved = await chartroom.saved();
  expect(saved.folders.map((folder) => folder.name)).toEqual(["Races"]);
  // Dragging a chart onto the folder moves it in too.
  await page.locator('#manage-list [data-chart="a"]').dragTo(page.locator('#manage-list [data-folder]'));
  await expect.poll(async () => (await chartroom.saved()).charts.every((chart) => chart.folderId)).toBe(true);
  await page.locator('#manage-list [data-folder]').click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#manage-delete").click();
  await expect.poll(async () => (await chartroom.saved()).charts.map((chart) => chart.folderId ?? "")).toEqual(["", ""]);
});

test("a voyage exports with the chosen parts and compares on another chart", async ({ chartroom, page }) => {
  const runs = [lines(
    { type: "session", day: 3, hour: 9, game: "g1", world: { kind: "vanilla" }, plugins: [{ guid: "a.b", name: "A", version: "1" }] },
    { type: "position", day: 3, hour: 9, lat: 40.1, lon: 0.5, boat: "medi medium", event: "start", windFrom: 90, windKnots: 8 },
    { type: "depart", day: 3, hour: 9.2, port: "Gold Rock City", island: 1 },
    { type: "position", day: 3, hour: 10, lat: 40.2, lon: 0.7, boat: "medi medium", event: "race-start", windFrom: 90, windKnots: 9 },
    { type: "position", day: 3, hour: 11, lat: 40.3, lon: 0.9, boat: "medi medium", event: "race-finish", windFrom: 95, windKnots: 10 }
  )];
  await chartroom.open(null, { recording: { name: "slot1.jsonl", runs } });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  // Following a new chart offers the positions before the newest one.
  await page.locator("#missing-form button.primary").click();
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length ?? 0)).toBe(3);
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#export-voyage").click();
  await expect(page.locator("#export-summary")).toContainText("3 positions");
  // The panel leaves the chart usable, and each end shows its position's time and what was recorded there.
  expect(await page.locator("#export-voyage-dialog").evaluate((dialog) => dialog.open && !dialog.matches(":modal"))).toBe(true);
  await page.locator("#export-race-markers").click();
  await expect(page.locator("#export-summary")).toContainText("2 positions");
  await expect(page.locator("#export-from-text")).toContainText("Race start");
  await expect(page.locator("#export-to-text")).toContainText("Race finish");
  await page.locator('[data-step="export-from"][data-by="-1"]').click();
  await expect(page.locator("#export-summary")).toContainText("3 positions");
  await page.locator("#export-name").fill("Morning run");
  await page.locator("#export-share label", { hasText: "Boat" }).locator("input").uncheck();
  await page.locator("#export-voyage-form button.primary").click();
  const [exported] = await page.evaluate(() => window.__host.exports);
  expect(exported.name).toBe("morning-run.voyage.json");
  const file = JSON.parse(exported.contents);
  expect(file).toMatchObject({ format: "sailwind-voyage", name: "Morning run", world: { kind: "vanilla" } });
  expect(file.points.map((point) => point.boat)).toEqual([undefined, undefined, undefined]);
  expect(file.visits.map((visit) => visit.port)).toEqual(["Gold Rock City"]);
  expect(file.game).toMatch(/^[0-9a-f]{16}$/);
  await page.locator("#voyage-file").setInputFiles({ name: "morning-run.voyage.json", mimeType: "application/json", buffer: Buffer.from(exported.contents) });
  await expect(page.locator("#compare-section")).toBeVisible();
  await expect(page.locator("#compare-list .compare-row")).toHaveCount(1);
  // Where each voyage's time counts from only matters when lining them up, so it shows with Show location by time elapsed.
  await expect(page.locator("#compare-list select")).toHaveCount(0);
  // Its numbers sit in chips that keep each value on one line, and what the file has can be drawn.
  await expect(page.locator("#compare-list .stat-chip").nth(1)).toHaveText("2h 00m");
  await expect(page.locator("#compare-list .compare-toggles label")).toHaveText(["Wind", "Port visits"]);
  await page.locator("#compare-list .compare-toggles label", { hasText: "Wind" }).locator("input").check();
  expect((await chartroom.chart()).comparisons[0].details).toMatchObject({ wind: true, ports: true });
  await page.locator("#compare-align").check();
  await expect(page.locator("#compare-scrub-row")).toBeVisible();
  await expect(page.locator("#compare-list select option")).toHaveText(["Its first position", /Leaving Gold Rock City/]);
  await page.locator("#compare-list button", { hasText: "Go to" }).click();
  await page.locator("#compare-scrub").fill("1");
  await expect(page.locator("#compare-elapsed")).toHaveText("1h 00m");
  await expect(page.locator("#compare-total")).toHaveText("2h 00m");
  // Speeds are multiples of the game's own clock, from 1× (game speed) to 500×.
  await expect(page.locator("#compare-speed-label")).toHaveText("100×");
  await page.locator("#compare-speed").fill("0");
  await expect(page.locator("#compare-speed-label")).toHaveText("1×");
  await page.locator("#compare-speed").fill("8");
  await expect(page.locator("#compare-speed-label")).toHaveText("500×");
  expect((await chartroom.chart()).comparisons[0].name).toBe("Morning run");
});

// Chartroom Voyages' public data, served from the given files instead of the site.
async function site(page, files) {
  await page.route("https://skeptic043.github.io/sailwind-chartroom-voyages/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/sailwind-chartroom-voyages/", "");
    const headers = { "access-control-allow-origin": "*" };
    if (path in files) await route.fulfill({ json: files[path], headers });
    else await route.fulfill({ status: 404, body: "", headers });
  });
}

// Gold Rock City and Neverdin, as Chartroom's island catalog places them.
const GRC = { lat: 31.10547, lon: -4.86723 };
const NEVERDIN = { lat: 30.88448, lon: -5.43159 };

test("Publish world/route and Enter a race save the file, check the run and open the site's forms", async ({ chartroom, page }) => {
  const course = (id, rules = {}) => ({ id, version: 1, name: id, world: "vanilla", start: { island: "alankh/gold_rock_city" }, checkpoints: [{ island: "alankh/neverdin" }], order: "any", finish: { lastCheckpoint: true }, rules: { sortBy: "game", mods: { mode: "any", plugins: [] }, ...rules } });
  await site(page, {
    "data/courses.json": [{ id: "dash", name: "Dash", world: "vanilla", runs: 2 }, { id: "clean", name: "Clean", world: "vanilla", runs: 0 }, { id: "elsewhere", name: "Elsewhere", world: "ss-0000000000000000", runs: 0 }],
    "data/boards/dash.json": { course: course("dash"), runs: [] },
    "data/boards/clean.json": { course: course("clean", { mods: { mode: "block", plugins: ["a.b"] } }), runs: [] }
  });
  const runs = [lines(
    { type: "session", day: 3, hour: 9, game: "g1", world: { kind: "vanilla" }, plugins: [{ guid: "a.b", name: "A", version: "1" }] },
    // Hourly readings at a plausible 12 knots from Gold Rock City to Neverdin.
    ...Array.from({ length: 8 }, (_, step) => ({ type: "position", day: 3, hour: 9 + step, lat: GRC.lat + (NEVERDIN.lat - GRC.lat) * step / 7, lon: GRC.lon + (NEVERDIN.lon - GRC.lon) * step / 7 }))
  )];
  await chartroom.open(null, { recording: { name: "slot1.jsonl", runs } });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await page.locator("#missing-form button.primary").click();
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length ?? 0)).toBe(8);

  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#share-voyage").click();
  await expect(page.locator("#export-title")).toHaveText("Share voyage");
  await expect(page.locator("#export-course-row")).toBeHidden();
  // Escape closes the panel after a click inside it, even without focus there, as on a Mac.
  await page.locator("#export-intro").click();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Escape");
  await expect(page.locator("#export-voyage-dialog")).toBeHidden();
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#share-voyage").click();
  await page.locator("#export-submit").click();
  await expect.poll(() => page.evaluate(() => window.__host.links ?? [])).toEqual(["https://github.com/Skeptic043/sailwind-chartroom-voyages/issues/new?template=share-voyage.yml"]);
  expect(await page.evaluate(() => window.__host.exports.length)).toBe(1);

  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#enter-race").click();
  await expect(page.locator("#export-title")).toHaveText("Enter a race");
  await expect(page.locator("#export-course option")).toHaveText(["Dash (2 runs)", "Clean (0 runs)"]);
  const mods = page.locator('#export-share input[value="plugins"]');
  await expect(mods).toBeChecked();
  await expect(mods).toBeDisabled();
  // A run the board would turn away says why, and nothing is saved or opened.
  await page.locator("#export-course").selectOption("clean");
  await page.locator("#export-submit").click();
  await expect(page.locator("#export-check")).toContainText("wouldn't be accepted: This race doesn't allow a.b.");
  expect(await page.evaluate(() => window.__host.exports.length)).toBe(1);
  await page.locator("#export-course").selectOption("dash");
  await expect(page.locator("#export-check")).toContainText("Valid run:");
  await page.locator("#export-submit").click();
  await expect.poll(() => page.evaluate(() => window.__host.links.at(-1))).toBe("https://github.com/Skeptic043/sailwind-chartroom-voyages/issues/new?template=enter-race.yml&course=dash");
  const entry = JSON.parse(await page.evaluate(() => window.__host.exports.at(-1).contents));
  expect(entry.plugins).toEqual([{ guid: "a.b", name: "A", version: "1" }]);
  await expect(page.locator("#export-voyage-dialog")).toBeHidden();
});

test("a recording from before Voyage Recorder 0.2.2 can declare a world to publish or enter a race", async ({ chartroom, page }) => {
  const course = (id, world, rules = {}) => ({ id, version: 1, name: id, world, start: { island: "alankh/gold_rock_city" }, checkpoints: [{ island: "alankh/neverdin" }], order: "any", finish: { lastCheckpoint: true }, rules: { sortBy: "game", mods: { mode: "any", plugins: [] }, ...rules } });
  await site(page, {
    "data/worlds.json": [{ key: "vanilla", name: "Vanilla Sailwind" }, { key: "ss-0000000000000000", name: "Scrambled seed 1" }],
    "data/courses.json": [{ id: "dash", name: "Dash", world: "vanilla", runs: 2 }, { id: "elsewhere", name: "Elsewhere", world: "ss-0000000000000000", runs: 0 }],
    "data/boards/dash.json": { course: course("dash", "vanilla", { mods: { mode: "only", plugins: [] } }), runs: [] },
    "data/boards/elsewhere.json": { course: course("elsewhere", "ss-0000000000000000"), runs: [] }
  });
  // No world, real time or mod list in the session line, as Voyage Recorder 0.1.9 wrote it.
  const runs = [lines(
    { type: "session", day: 3, hour: 9, game: "g1" },
    ...Array.from({ length: 8 }, (_, step) => ({ type: "position", day: 3, hour: 9 + step, lat: GRC.lat + (NEVERDIN.lat - GRC.lat) * step / 7, lon: GRC.lon + (NEVERDIN.lon - GRC.lon) * step / 7 }))
  )];
  await chartroom.open(null, { recording: { name: "slot1.jsonl", runs } });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await page.locator("#missing-form button.primary").click();
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length ?? 0)).toBe(8);

  // Publish world/route now opens and asks the player to declare the world.
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#share-voyage").click();
  await expect(page.locator("#export-voyage-dialog")).toBeVisible();
  await expect(page.locator("#export-world-row")).toBeVisible();
  await page.locator("#export-submit").click();
  await expect(page.locator("#export-check")).toContainText("Choose which world this route was sailed in");
  await page.locator("#export-world-choice").selectOption("vanilla");
  await expect(page.locator("#export-world")).toContainText("declared by you");
  await page.locator("#export-submit").click();
  await expect.poll(() => page.evaluate(() => window.__host.links?.at(-1))).toBe("https://github.com/Skeptic043/sailwind-chartroom-voyages/issues/new?template=share-voyage.yml");
  const published = JSON.parse(await page.evaluate(() => window.__host.exports.at(-1).contents));
  expect(published.world).toEqual({ kind: "vanilla" });
  expect(published.worldDeclared).toBe(true);

  // Declaring a Scrambled Seas World Generator link prefills the GitHub form fields.
  const generatorLink = "https://skeptic043.github.io/scrambled-seas-world-generator/#v=1&lo1=-20&lo2=40&la1=20&la2=50&seed=-77";
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#share-voyage").click();
  await page.locator("#export-world-choice").selectOption("scrambled");
  await expect(page.locator("#export-world-source-row")).toBeVisible();
  await page.locator("#export-world-source").fill(generatorLink);
  await page.locator("#export-submit").click();
  await expect.poll(() => page.evaluate(() => window.__host.links?.length ?? 0)).toBe(2);
  const scrambledForm = new URL(await page.evaluate(() => window.__host.links.at(-1)));
  expect(scrambledForm.searchParams.get("template")).toBe("share-voyage.yml");
  expect(scrambledForm.searchParams.get("world")).toBe("Scrambled Seas (paste link or XML below)");
  expect(scrambledForm.searchParams.get("scrambled_world")).toBe(generatorLink);

  // Declaring a Scrambled Seas XML embeds the full world settings directly in the exported file.
  const scrambledXml = `<ScrambledSeasSaveContainer><version>60</version><worldScramblerSeed>-77</worldScramblerSeed><islandSpread>6500</islandSpread><minArchipelagoSeparation>45000</minArchipelagoSeparation><minIslandSeparation>1950</minIslandSeparation><worldLonMin>-20</worldLonMin><worldLonMax>40</worldLonMax><worldLatMin>20</worldLatMin><worldLatMax>50</worldLatMax><borderExpander>1</borderExpander></ScrambledSeasSaveContainer>`;
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#share-voyage").click();
  await page.locator("#export-world-choice").selectOption("scrambled");
  await page.locator("#export-world-source").fill(scrambledXml);
  await page.locator("#export-submit").click();
  await expect.poll(() => page.evaluate(() => window.__host.links?.length ?? 0)).toBe(3);
  expect(await page.evaluate(() => window.__host.links.at(-1))).toBe("https://github.com/Skeptic043/sailwind-chartroom-voyages/issues/new?template=share-voyage.yml");
  const xmlPublished = JSON.parse(await page.evaluate(() => window.__host.exports.at(-1).contents));
  expect(xmlPublished.world).toMatchObject({ kind: "scrambled", seed: -77 });
  expect(xmlPublished.worldDeclared).toBe(true);

  // In Save route to file, the Scrambled Seas label asks for XML only and rejects generator links.
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#export-voyage").click();
  await page.locator("#export-world-choice").selectOption("scrambled");
  await expect(page.locator("#export-world-source-label")).toHaveText("Scrambled Seas XML");
  await page.locator("#export-world-source").fill(generatorLink);
  await page.locator("#export-submit").click();
  await expect(page.locator("#export-check")).toContainText("need the Scrambled Seas XML");
  await page.locator('#export-voyage-dialog button[data-close]').click();

  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#enter-race").click();
  // Without a recorded world every race is offered with its world name, and the run counts as sailed in the chosen race's world.
  await expect(page.locator("#export-course option")).toHaveText(["Dash — Vanilla Sailwind (2 runs)", "Elsewhere — Scrambled seed 1 (0 runs)"]);
  await expect(page.locator("#export-world")).toHaveText("World not recorded, so the run counts as sailed in the race's world.");
  // Declaring Vanilla while targeting a Scrambled Seas race is caught locally before saving.
  await page.locator("#export-course").selectOption("elsewhere");
  await page.locator("#export-world-choice").selectOption("vanilla");
  await page.locator("#export-submit").click();
  await expect(page.locator("#export-check")).toContainText("sailed in a different world from the race's");
  // Declaring Vanilla for a Vanilla race notes it as player-declared.
  await page.locator("#export-course").selectOption("dash");
  await page.locator("#export-submit").click();
  await expect(page.locator("#export-check")).toContainText("The board will note: world declared by player, mods not recorded.");
  const declaredEntry = JSON.parse(await page.evaluate(() => window.__host.exports.at(-1).contents));
  expect(declaredEntry.world).toEqual({ kind: "vanilla" });
  expect(declaredEntry.worldDeclared).toBe(true);

  // Leaving world unset enters the race with unknown world and world-not-recorded note.
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#enter-race").click();
  await page.locator("#export-course").selectOption("dash");
  await page.locator("#export-submit").click();
  await expect(page.locator("#export-check")).toContainText("The board will note: world not recorded, mods not recorded.");
  await expect.poll(() => page.evaluate(() => window.__host.links?.at(-1))).toBe("https://github.com/Skeptic043/sailwind-chartroom-voyages/issues/new?template=enter-race.yml&course=dash");
  const entry = JSON.parse(await page.evaluate(() => window.__host.exports.at(-1).contents));
  expect(entry.world).toEqual({ kind: "unknown" });
  expect(entry.plugins).toBeUndefined();
});

test("a desktop host with exportWithLink saves first, reveals the file, and waits before showing the toast", async ({ chartroom, page }) => {
  await site(page, {
    "data/courses.json": [{ id: "dash", name: "Dash", world: "vanilla", runs: 1 }],
    "data/boards/dash.json": { course: { id: "dash", version: 1, name: "Dash", world: "vanilla", start: { island: "alankh/gold_rock_city" }, checkpoints: [{ island: "alankh/neverdin" }], order: "any", finish: { lastCheckpoint: true }, rules: { sortBy: "game", mods: { mode: "any", plugins: [] } } }, runs: [] }
  });
  const runs = [lines(
    { type: "session", day: 3, hour: 9, game: "g1", world: { kind: "vanilla" }, plugins: [] },
    ...Array.from({ length: 8 }, (_, step) => ({ type: "position", day: 3, hour: 9 + step, lat: GRC.lat + (NEVERDIN.lat - GRC.lat) * step / 7, lon: GRC.lon + (NEVERDIN.lon - GRC.lon) * step / 7 }))
  )];
  await chartroom.open(null, { recording: { name: "slot1.jsonl", runs }, exportWithLink: true });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await page.locator("#missing-form button.primary").click();
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length ?? 0)).toBe(8);

  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#enter-race").click();
  await page.locator("#export-submit").click();
  await expect.poll(() => page.evaluate(() => window.__host.exports.length)).toBe(1);
  const [req] = await page.evaluate(() => window.__host.exports);
  expect(req.id).toBeTruthy();
  expect(req.openUrl).toBe("https://github.com/Skeptic043/sailwind-chartroom-voyages/issues/new?template=enter-race.yml&course=dash");
  expect(req.reveal).toBe(true);
  expect(await page.evaluate(() => window.__host.links ?? [])).toEqual([]);
  await expect(page.locator("#toast")).not.toContainText("Route saved");
  // An unrelated export-result (e.g. File > Export this chart) does not consume the pending voyage toast.
  await page.evaluate(() => window.__host.emit({ type: "export-result", id: null, saved: true, opened: false }));
  await expect(page.locator("#toast")).not.toContainText("Route saved");
  // Cancelling the Save dialog keeps the toast quiet.
  await page.evaluate((id) => window.__host.emit({ type: "export-result", id, saved: false, opened: false }), req.id);
  await expect(page.locator("#toast")).not.toContainText("Route saved");

  // Saving shows the timed race summary in the toast.
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#enter-race").click();
  await page.locator("#export-submit").click();
  await expect.poll(() => page.evaluate(() => window.__host.exports.length)).toBe(2);
  const second = await page.evaluate(() => window.__host.exports.at(-1));
  await page.evaluate((id) => window.__host.emit({ type: "export-result", id, saved: true, opened: true }), second.id);
  await expect(page.locator("#toast")).toContainText("Route saved (5h 00m from Gold Rock City)");

  // If the file saved but the browser couldn't be opened, Chartroom tells the player clearly.
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#share-voyage").click();
  await page.locator("#export-submit").click();
  await expect.poll(() => page.evaluate(() => window.__host.exports.length)).toBe(3);
  const third = await page.evaluate(() => window.__host.exports.at(-1));
  await page.evaluate((id) => window.__host.emit({ type: "export-result", id, saved: true, opened: false }), third.id);
  await expect(page.locator("#toast")).toContainText("your browser couldn't be opened");

  // Local Save route to file sends neither openUrl nor reveal.
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#export-voyage").click();
  await page.locator("#export-submit").click();
  await expect.poll(() => page.evaluate(() => window.__host.exports.length)).toBe(4);
  const localReq = await page.evaluate(() => window.__host.exports.at(-1));
  expect(localReq.openUrl).toBeUndefined();
  expect(localReq.reveal).toBeUndefined();
  await page.evaluate((id) => window.__host.emit({ type: "export-result", id, saved: true, opened: false }), localReq.id);
  await expect(page.locator("#toast")).toHaveText("Route saved to file.");
});

test("Publish route as race reads the route's islands and opens the race form filled in", async ({ chartroom, page }) => {
  await site(page, { "data/courses.json": [{ id: "taken", name: "Taken", world: "vanilla", runs: 0 }] });
  const route = [{ id: "a", ...GRC }, { id: "b", lat: 31.4, lon: -5.2, name: "Buoy" }, { id: "c", ...NEVERDIN }, { id: "d", ...GRC }];
  await chartroom.open({ charts: [{ id: "c1", name: "Race", view: { lat: 31, lon: -5.1, zoom: 6 }, route, recording: { game: "g", world: { kind: "vanilla" } } }], activeChartId: "c1" });
  await page.locator("#publish-route-course").click();
  await expect(page.locator("#course-summary")).toHaveText("Start: Gold Rock City (island)\nCheckpoints: Buoy (mark, 3 nm), Neverdin (island)\nFinish: Gold Rock City (island)");
  await page.locator("#course-name").fill("Taken");
  await page.locator("#course-form button.primary").click();
  await expect(page.locator("#toast")).toContainText('A race called "taken" already exists');
  await page.locator("#course-name").fill("Buoy and back");
  await page.locator("#course-mods").selectOption("only");
  await page.locator("#course-plugins").fill("com.example.allowed");
  await page.locator("#course-form button.primary").click();
  await expect.poll(() => page.evaluate(() => window.__host.links?.length ?? 0)).toBe(1);
  const link = new URL(await page.evaluate(() => window.__host.links[0]));
  expect(link.searchParams.get("template")).toBe("create-course.yml");
  const submitted = JSON.parse(link.searchParams.get("course"));
  expect(submitted).toMatchObject({ id: "buoy-and-back", world: "vanilla", order: "fixed", start: { island: "alankh/gold_rock_city" }, finish: { island: "alankh/gold_rock_city" },
    checkpoints: [{ name: "Buoy", radiusNm: 3 }, { island: "alankh/neverdin" }], rules: { mods: { mode: "only", plugins: ["com.example.allowed"] } } });
  expect(submitted.author).toBeUndefined();
});

test("Browse worlds and routes adds a world's routes as comparisons and shows its heatmap", async ({ chartroom, page }) => {
  const voyage = { format: "sailwind-voyage", version: 1, id: "7", submitter: "sailor", name: "Long way round", world: { kind: "vanilla" }, points: [{ t: 80, ...GRC }, { t: 84, ...NEVERDIN }] };
  await site(page, {
    "data/worlds.json": [{ key: "vanilla", name: "Vanilla Sailwind", voyages: 1, courses: [] }],
    "data/courses.json": [],
    "data/worlds/vanilla.json": { key: "vanilla", name: "Vanilla Sailwind", heatmap: { cellDegrees: 0.2, max: 1, voyages: 1, cells: { "153,-23": 1 } },
      voyageList: [{ id: "7", name: "Long way round", submitter: "sailor", distanceNm: 110, hours: 4, boats: ["Brig"], file: "voyages/vanilla/7.json" }] },
    "voyages/vanilla/7.json": voyage
  });
  await chartroom.open({ charts: [{ id: "c1", name: "Sea", view: { lat: 31, lon: -5.1, zoom: 6 } }], activeChartId: "c1" });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#browse-voyages").click();
  await expect(page.locator("#browse-world option")).toHaveText(["Vanilla Sailwind (1 voyage)"]);
  await expect(page.locator("#browse-list .browse-row")).toContainText("Long way round");
  await page.locator("#browse-list button", { hasText: "Compare" }).click();
  await expect(page.locator("#browse-list button")).toHaveText("Added");
  await page.locator("#browse-heatmap").check();
  await page.locator("#browse-open-site").click();
  await expect.poll(() => page.evaluate(() => window.__host.links ?? [])).toEqual(["https://skeptic043.github.io/sailwind-chartroom-voyages/#world/vanilla"]);
  await page.locator("#browse-dialog button.primary").click();
  await expect(page.locator("#compare-list .compare-row")).toHaveCount(1);
  expect((await chartroom.chart()).comparisons[0].name).toBe("Long way round");
});

test("Connect track joins two stretches into one, and the track key explains the ring", async ({ chartroom, page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const track = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, lat: 31 - i * 0.05, lon: -5 + i * 0.03, t: 7200 + i, source: "voyage" })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, lat: 30.3 - i * 0.03, lon: -4.6 + i * 0.03, t: 7230 + i, source: "voyage", ...(i === 0 && { newSession: true }) }))
  ];
  await chartroom.open({ charts: [{ id: "c1", name: "Sea", view: { lat: 30.7, lon: -4.8, zoom: 900 }, track }], activeChartId: "c1" });
  await page.locator('.app-menu[data-menu="view"] > summary').click();
  await expect(page.locator("#layer-track-gaps")).toHaveCount(0);
  await page.locator("#layer-track-key").check();
  await page.keyboard.press("Escape");
  await expect(page.locator("#track-key tr")).toHaveCount(8);
  await expect(page.locator("#track-key")).toContainText("Manually connected track");
  await expect(page.locator("#track-key")).toContainText("Wind direction");
  expect((await chartroom.saved()).settings.trackKey).toBe(true);
  // Key in the top bar hides it, like Route and Hotkeys, and its heading drags it.
  await expect(page.locator("#show-track-key")).toHaveAttribute("aria-pressed", "true");
  const handle = await page.locator("#track-key-heading").boundingBox();
  await page.mouse.move(handle.x + 10, handle.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle.x + 210, handle.y + 105, { steps: 5 });
  await page.mouse.up();
  expect((await chartroom.saved()).settings.trackKeyPanel.x).toBeGreaterThan(0.02);
  await page.locator("#show-track-key").click();
  await expect(page.locator("#track-key")).toBeHidden();
  // The view is centred on 30.7°N 4.8°W at 900 pixels a degree: a5 (30.75°N 4.85°W) is 45 left and 45 up,
  // b0 (30.3°N 4.6°W) 180 right and 360 down.
  const box = await page.locator("#chart-canvas").boundingBox();
  await chartroom.clickChart(box.width / 2 - 45, box.height / 2 - 45);
  await expect(page.locator("#track-connect-detail")).toContainText("Shift-click the position on the other side");
  await expect(page.locator("#track-connect")).toBeDisabled();
  await page.keyboard.down("Shift");
  await chartroom.clickChart(box.width / 2 + 180, box.height / 2 + 360);
  await page.keyboard.up("Shift");
  await expect(page.locator("#track-connect")).toBeEnabled();
  await page.locator("#track-connect").click();
  await expect.poll(async () => (await chartroom.chart()).track.find((point) => point.id === "b0").joinPrevious).toBe(true);
  await chartroom.clickChart(box.width / 2 + 180, box.height / 2 + 360);
  await expect(page.locator("#track-join")).toBeVisible();
  await page.locator("#track-join").click();
  await expect.poll(async () => (await chartroom.chart()).track.find((point) => point.id === "b0").joinPrevious).toBeUndefined();
});

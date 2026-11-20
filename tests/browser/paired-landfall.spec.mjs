import { readFile } from "node:fs/promises";
import { test, expect } from "./harness.mjs";

const recordingPath = process.env.SAILWIND_PAIR_RECORDING;
test.skip(!recordingPath, "The paired package check supplies a recording from the packaged Voyage Recorder.");

async function readRecording() {
  const text = await readFile(recordingPath, "utf8");
  const rows = text.trimEnd().split(/\r?\n/);
  expect(rows.map((row) => JSON.parse(row).type)).toEqual(["header", "session", "position", "landfall"]);
  expect(JSON.parse(rows[2]).event).toBe("mark");
  const terra = JSON.parse(rows[3]).source === "terra-incognita";
  return { text, terra, session: rows.slice(0, 2).join("\n") + "\n", landing: rows.slice(2).join("\n") + "\n" };
}

async function expectOutline(page, terra) {
  const { features, outline, firstPoint } = await page.evaluate(async () => {
    const { activeChart } = await import("/src/state.mjs");
    const { chartIsland } = await import("/src/viewport.mjs");
    const { features } = activeChart();
    const island = features.length === 1 ? chartIsland(features[0]) : null;
    return { features, outline: island?.id, firstPoint: island?.shapes[0].rings[0].slice(0, 2) };
  });
  expect(features, "Exactly one editable landfall location").toHaveLength(1);
  if (terra) {
    expect(outline, "The recorded SeaStacks variant must select its own outline").toBe("terra-incognita/stacks_13");
    expect(features[0]).toMatchObject({ name: "Sea Stacks #1", lat: 34.33, lon: 13.04 });
    // The catalog's first vertex (0.00464 east, 0.00244 north) with the fixture's 270° yaw.
    expect(firstPoint).toEqual([-0.00244, 0.00464]);
    return;
  }
  expect(outline, "A relocated landfall must show the Turtle Island outline").toBe("emerald/turtle_island");
  // Expected catalog anchor (31.43298, 5.26060) plus the fixture's move (2.875, 7.75).
  // Keep these assertions independent of both the saved island root and Chartroom's placement helper.
  expect(features[0].lat, "The outline must use its shifted catalog latitude").toBeCloseTo(34.30798, 6);
  expect(features[0].lon, "The outline must use its shifted catalog longitude").toBeCloseTo(13.01060, 6);
}

test("paired landfall import places one outline on replay", async ({ chartroom, page }) => {
  const { text, terra } = await readRecording();
  const file = { name: "slot.jsonl", mimeType: "text/plain", buffer: Buffer.from(text) };
  await chartroom.open();
  for (const count of [1, 2]) {
    await page.locator("#track-file").setInputFiles(file);
    await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length)).toBe(count);
    await expectOutline(page, terra);
  }
});

test("paired landfall live follow places one outline on replay", async ({ chartroom, page }) => {
  const { session, landing, terra } = await readRecording();
  await chartroom.open(null, { recording: { name: "slot.jsonl", runs: [session, landing, landing] } });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length)).toBe(2);
  await expectOutline(page, terra);
});

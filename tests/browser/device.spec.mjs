// The page on a phone or tablet: it pairs with the PC, opens on the PC's charts, sends its changes and keeps
// them until the PC confirms, and asks when the PC changed the same thing.
import { test, expect } from "./harness.mjs";
import { createFeature, createWorkspace } from "../../src/model.mjs";

const sent = (page) => page.evaluate(() => window.__pc.sent);
const deliver = (page, message) => page.evaluate((message) => window.__pc.deliver(message), message);
const batches = async (page) => (await sent(page)).filter((message) => message.type === "ops");

async function pairAndOpen(chartroom, page, workspace) {
  await chartroom.openDevice("#pair=123456");
  await expect.poll(async () => (await sent(page))[0]).toEqual({ type: "pair", code: "123456", name: expect.any(String) });
  await deliver(page, { type: "welcome", deviceId: "device-1", name: "Phone", token: "secret" });
  await deliver(page, { type: "workspace", workspace, version: "9.9.9" });
  await expect(page.locator("#app-version")).toHaveText("9.9.9");
}

test("a scanned code pairs, the PC's charts open, and the code leaves the address", async ({ chartroom, page }) => {
  const workspace = createWorkspace();
  workspace.charts[0].features.push(createFeature({ lat: 30, lon: 1, name: "Gold Rock" }));
  await pairAndOpen(chartroom, page, workspace);
  await expect(chartroom.items().filter({ hasText: "Gold Rock" })).toHaveCount(1);
  expect(page.url()).toBe("http://chartroom-pc:47821/");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sailwind-chartroom:device")).token)).toBe("secret");
});

test("without a code the page asks for one", async ({ chartroom, page }) => {
  await chartroom.openDevice();
  await page.locator("#device-pairing input").fill("654321");
  await page.locator("#device-pairing button").click();
  await expect.poll(async () => (await sent(page))[0]?.code).toBe("654321");
});

test("a change made here goes to the PC and waits until it is confirmed, also across a lost connection", async ({ chartroom, page }) => {
  await pairAndOpen(chartroom, page, createWorkspace());
  await chartroom.press("l");
  await chartroom.clickChart(400, 300);
  await expect.poll(async () => (await batches(page)).length).toBe(1);
  const [first] = await batches(page);
  expect(first.ops.some((op) => op.op === "put" && op.list === "features")).toBe(true);
  // The connection drops before the PC answers; on reconnecting the PC sends its charts and the change goes again.
  await page.evaluate(() => window.__pc.drop());
  await expect(page.locator("#save-status")).toHaveClass(/failed/);
  await expect.poll(() => page.evaluate(() => window.__pc.sockets.length), { timeout: 8000 }).toBe(2);
  await expect.poll(async () => (await sent(page)).at(-1)).toEqual({ type: "hello", token: "secret" });
  await deliver(page, { type: "welcome", deviceId: "device-1", name: "Phone" });
  await deliver(page, { type: "workspace", workspace: createWorkspace(), version: "9.9.9" });
  await expect.poll(async () => (await batches(page)).at(-1)?.batch).toBe(first.batch);
  await deliver(page, { type: "ack", batch: first.batch, conflicts: [] });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("sailwind-chartroom:device-unsent")))).toEqual([]);
});

test("the PC's changes appear here", async ({ chartroom, page }) => {
  const workspace = createWorkspace();
  await pairAndOpen(chartroom, page, workspace);
  const item = createFeature({ lat: 30, lon: 1, name: "From the PC" });
  await deliver(page, { type: "ops", ops: [{ op: "put", chartId: workspace.charts[0].id, list: "features", item, base: null, after: null }] });
  await expect(chartroom.items().filter({ hasText: "From the PC" })).toHaveCount(1);
  expect(await batches(page)).toEqual([]);
});

test("a change the PC also made asks which to keep, and keeping both sends a copy", async ({ chartroom, page }) => {
  const workspace = createWorkspace();
  const rock = createFeature({ lat: 30, lon: 1, name: "Rock" });
  workspace.charts[0].features.push(rock);
  await pairAndOpen(chartroom, page, workspace);
  const op = { op: "put", chartId: workspace.charts[0].id, list: "features", item: { ...rock, name: "Rock, phone" }, base: rock };
  await deliver(page, { type: "ack", batch: "x", conflicts: [{ op, current: { ...rock, name: "Rock, PC" } }] });
  await expect(page.locator("#conflict-text")).toContainText("The location “Rock, phone” was changed on your PC");
  await page.getByRole("button", { name: "Keep both" }).click();
  await expect(page.locator("#conflict-dialog")).toBeHidden();
  const copy = (await batches(page)).flatMap((batch) => batch.ops).find((entry) => entry.item?.name === "Rock, phone");
  expect(copy.base).toBe(null);
  expect(copy.item.id).not.toBe(rock.id);
  await expect(chartroom.items().filter({ hasText: "Rock, PC" })).toHaveCount(1);
});

test("scanning an old code on a paired phone keeps its pairing", async ({ chartroom, page }) => {
  await pairAndOpen(chartroom, page, createWorkspace());
  await page.goto("about:blank");
  await page.goto("http://chartroom-pc:47821/#pair=999999");
  await expect.poll(async () => (await sent(page)).at(-1)).toEqual({ type: "pair", code: "999999", name: expect.any(String), previous: "secret" });
  await deliver(page, { type: "denied" });
  await page.evaluate(() => window.__pc.drop());
  await expect.poll(async () => (await sent(page)).at(-1), { timeout: 8000 }).toEqual({ type: "hello", token: "secret" });
  await expect(page.locator("#device-pairing")).toHaveCount(0);
});

test("the PC's question about missing positions is asked here too, and either answer goes back", async ({ chartroom, page }) => {
  await pairAndOpen(chartroom, page, createWorkspace());
  await deliver(page, { type: "missing", text: "12 positions were recorded since this chart's last one from slot1.jsonl. Add them to the track?" });
  await expect(page.locator("#missing-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Add to track" }).click();
  await expect.poll(async () => (await sent(page)).at(-1)).toEqual({ type: "missing-answer", add: true });
  await deliver(page, { type: "missing", text: "Again?" });
  await deliver(page, { type: "missing", text: null });
  await expect(page.locator("#missing-dialog")).toBeHidden();
  expect((await sent(page)).filter((message) => message.type === "missing-answer")).toHaveLength(1);
});

test("a device starts with the PC's settings but the track key hidden", async ({ chartroom, page }) => {
  const workspace = createWorkspace();
  workspace.settings.trackKey = true;
  workspace.settings.iconSize = "large";
  await pairAndOpen(chartroom, page, workspace);
  await expect(page.locator("#track-key")).toBeHidden();
  await page.locator("#show-track-key").evaluate((button) => button.click());
  await expect(page.locator("#track-key")).toBeVisible();
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem("sailwind-chartroom:device-prefs")).settings);
  expect([prefs.trackKey, prefs.iconSize]).toEqual([true, "large"]);
});

test("undo takes back an edit made here after the PC has confirmed it", async ({ chartroom, page }) => {
  await pairAndOpen(chartroom, page, createWorkspace());
  await chartroom.press("l");
  await chartroom.clickChart(400, 300);
  await expect.poll(async () => (await batches(page)).length).toBe(1);
  const [batch] = await batches(page);
  // The PC sends the change back to every device, this one included, then confirms it.
  await deliver(page, { type: "ops", ops: batch.ops });
  await deliver(page, { type: "ack", batch: batch.batch, conflicts: [] });
  await chartroom.press("Control+z");
  await expect.poll(async () => (await batches(page)).at(-1).ops.some((op) => op.op === "remove" && op.list === "features")).toBe(true);
  await expect(chartroom.items()).toHaveCount(0);
});

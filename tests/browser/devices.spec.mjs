// The desktop page as the phone companion's hub: devices get the charts when they join, their changes apply
// outside the desktop's undo history, and every change goes out to them.
import { test, expect } from "./harness.mjs";

const sync = (page) => page.evaluate(() => window.__host.sync);
const emit = (page, message) => page.evaluate((message) => window.__host.emit(message), message);
// Read from the host's copy, which exists once anything has been saved.
const savedName = (page) => page.evaluate(() => window.__host.workspace?.charts?.[0]?.name);
const broadcasts = async (page) => (await sync(page)).filter((entry) => entry.type === "sync-broadcast").flatMap((entry) => entry.ops);

async function join(chartroom, page) {
  await chartroom.open(null, { devices: true });
  await emit(page, { type: "device-joined", deviceId: "phone" });
  await expect.poll(async () => (await sync(page)).find((entry) => entry.message?.type === "workspace")?.deviceId).toBe("phone");
  return (await sync(page)).find((entry) => entry.message?.type === "workspace").message.workspace.activeChartId;
}

test("a joining phone gets the charts, and the desktop's edits go out to it", async ({ chartroom, page }) => {
  await join(chartroom, page);
  await chartroom.press("l");
  await chartroom.clickChart(400, 300);
  await expect.poll(async () => (await broadcasts(page)).filter((op) => op.op === "put" && op.list === "features").length).toBe(1);
});

test("a phone's note shows on the desktop, survives the desktop's undo, and is confirmed", async ({ chartroom, page }) => {
  const chartId = await join(chartroom, page);
  // The desktop places a location, then the phone adds a note.
  await chartroom.press("l");
  await chartroom.clickChart(400, 300);
  await expect.poll(async () => (await chartroom.chart()).features.length).toBe(1);
  const note = { id: "note-phone", lat: 20, lon: 5, text: "Seen from the phone" };
  await emit(page, { type: "device-message", deviceId: "phone", message: { type: "ops", batch: 1, ops: [{ op: "put", chartId, list: "notes", item: note, base: null, after: null }] } });
  await expect.poll(async () => (await sync(page)).find((entry) => entry.message?.type === "ack")?.message).toEqual({ type: "ack", batch: 1, conflicts: [] });
  expect((await chartroom.chart()).notes.map((entry) => entry.text)).toEqual(["Seen from the phone"]);
  // Undo takes back the desktop's own location only.
  await chartroom.press("Control+z");
  const chart = await chartroom.chart();
  expect(chart.features).toEqual([]);
  expect(chart.notes.map((entry) => entry.text)).toEqual(["Seen from the phone"]);
  expect((await broadcasts(page)).some((op) => op.op === "remove" && op.list === "features")).toBe(true);
});

test("a phone's change to something the desktop changed since is answered as a conflict", async ({ chartroom, page }) => {
  const chartId = await join(chartroom, page);
  const ops = (name, base) => [{ op: "field", chartId, key: "name", value: name, base }];
  await emit(page, { type: "device-message", deviceId: "phone", message: { type: "ops", batch: 1, ops: ops("Phone sea", "My Scrambled Sea") } });
  await expect.poll(() => savedName(page)).toBe("Phone sea");
  await emit(page, { type: "device-message", deviceId: "phone", message: { type: "ops", batch: 2, ops: ops("Stale sea", "My Scrambled Sea") } });
  await expect.poll(async () => (await sync(page)).find((entry) => entry.message?.batch === 2)?.message.conflicts[0]?.current).toBe("Phone sea");
  expect(await savedName(page)).toBe("Phone sea");
});

test("positions the desktop follows reach the phone, and a phone that leaves gets nothing more", async ({ chartroom, page }) => {
  await join(chartroom, page);
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track-cv").click();
  await expect.poll(async () => (await broadcasts(page)).filter((op) => op.list === "track").length).toBe(2);
  await emit(page, { type: "device-left", deviceId: "phone" });
  const before = (await sync(page)).length;
  await chartroom.press("l");
  await chartroom.clickChart(400, 300);
  await expect.poll(async () => (await chartroom.chart()).features.length).toBe(1);
  expect((await sync(page)).length).toBe(before);
});

test("the Phones and tablets dialog turns devices on, shows the code to scan and lists paired devices", async ({ chartroom, page }) => {
  await chartroom.open(null, { devices: true });
  await page.locator('.app-menu[data-menu="file"] > summary').click();
  await page.locator("#open-devices").click();
  await page.locator("#devices-enabled").check();
  await expect.poll(() => chartroom.messages()).toContain("devices-enable");
  const qr = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  await emit(page, { type: "devices-state", enabled: true, running: true, addresses: ["192.168.1.20"], devices: [], pairing: null });
  await page.locator("#devices-connect").click();
  await expect.poll(() => chartroom.messages()).toContain("devices-pair");
  await emit(page, {
    type: "devices-state", enabled: true, running: true, addresses: ["192.168.1.20"],
    devices: [{ id: "device-1", name: "Android phone", lastSeen: new Date().toISOString(), connected: true }],
    pairing: { code: "123456", url: "http://192.168.1.20:47821/#pair=123456", address: "192.168.1.20", qr }
  });
  await expect(page.locator("#devices-code")).toHaveText("123456");
  await expect(page.locator("#devices-url")).toHaveText("http://192.168.1.20:47821/");
  await expect(page.locator("#devices-list li")).toContainText("Connected");
  await page.locator("#devices-list button").click();
  await expect.poll(() => chartroom.messages()).toContain("devices-remove");
  await page.locator("#devices-form button[type=submit]").click();
  await expect.poll(() => chartroom.messages()).toContain("devices-pair-stop");
});

test("a batch a phone sends again after a lost answer is confirmed but not applied twice", async ({ chartroom, page }) => {
  const chartId = await join(chartroom, page);
  const message = { type: "ops", batch: "b1", ops: [{ op: "field", chartId, key: "name", value: "Phone sea", base: "My Scrambled Sea" }] };
  await emit(page, { type: "device-message", deviceId: "phone", message });
  await expect.poll(() => savedName(page)).toBe("Phone sea");
  await page.evaluate(() => { document.querySelector("#chart-settings").click(); });
  await page.locator("#dialog-chart-name").fill("Desktop sea");
  await page.locator("#chart-form button[type=submit]").click();
  await expect.poll(() => savedName(page)).toBe("Desktop sea");
  await emit(page, { type: "device-message", deviceId: "phone", message });
  await expect.poll(async () => (await sync(page)).filter((entry) => entry.message?.type === "ack").length).toBe(2);
  expect((await sync(page)).filter((entry) => entry.message?.type === "ack").at(-1).message.conflicts).toEqual([]);
  expect(await savedName(page)).toBe("Desktop sea");
});

test("a phone can answer the question about missing positions, which then closes here", async ({ chartroom, page }) => {
  const line = (hour, lat) => `{"type":"position","day":3,"hour":${hour},"lat":${lat},"lon":0.5}
`;
  const runs = [line(9, 40) + line(9.5, 40.01) + line(10, 40.02) + line(10.5, 40.03), line(11, 40.04)];
  await chartroom.open(null, { devices: true, recording: { name: "slot1.jsonl", runs } });
  await emit(page, { type: "device-joined", deviceId: "phone" });
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#paste-track").click();
  await page.locator("#paste-text").fill(line(9, 40) + line(9.5, 40.01));
  await page.locator("#paste-form button.primary").click();
  await page.locator('.app-menu[data-menu="voyage"] > summary').click();
  await page.locator("#follow-track").click();
  await expect(page.locator("#missing-dialog")).toBeVisible();
  await expect.poll(async () => (await sync(page)).find((entry) => entry.message?.type === "missing")?.message.text).toContain("1 position was recorded");
  await emit(page, { type: "device-message", deviceId: "phone", message: { type: "missing-answer", add: true } });
  await expect(page.locator("#missing-dialog")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.track?.length ?? 0)).toBe(5);
  await expect.poll(async () => (await sync(page)).filter((entry) => entry.message?.type === "missing").at(-1).message.text).toBe(null);
});

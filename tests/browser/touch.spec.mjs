// Phones and tablets: the chart fills the screen, the menus open as a sheet, the inspector slides up when
// something is selected, and fingers tap, pinch and long-press on the chart.
import { test, expect } from "./harness.mjs";
import { createFeature, createWorkspace } from "../../src/model.mjs";

const phone = { viewport: { width: 390, height: 844 }, hasTouch: true };

// A finger on the chart, as the browser reports it: pointer events of type "touch".
async function finger(page, type, id, x, y) {
  await page.evaluate(({ type, id, x, y }) => {
    const canvas = document.getElementById("chart-canvas");
    const box = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: box.left + x, clientY: box.top + y, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true }));
  }, { type, id, x, y });
}

const tap = async (page, x, y) => {
  await finger(page, "pointerdown", 1, x, y);
  await finger(page, "pointerup", 1, x, y);
};

test.describe("on a phone", () => {
  test.use(phone);

  test("the chart fills the screen between the top bar and the tool bar, and the menus open as a sheet", async ({ chartroom, page }) => {
    await chartroom.open();
    await expect(page.locator("body")).toHaveClass(/phone/);
    const chart = await chartroom.canvas.boundingBox();
    expect(chart.width).toBe(390);
    expect(chart.height).toBeGreaterThan(650);
    await expect(page.locator(".tool[data-mode='wind']")).toBeAttached();
    await expect(page.locator("#export-json")).toBeHidden();
    await page.locator("#touch-menu").click();
    await expect(page.locator("#export-json")).toBeVisible();
    expect((await page.locator(".menu-bar").boundingBox()).width).toBe(390);
    await expect(page.locator("#about")).toBeVisible();
    await page.locator("#about").click();
    await expect(page.locator("#about-dialog")).toBeVisible();
    await expect(page.locator("#export-json")).toBeHidden();
  });

  test("a tap with Add location places one and the inspector slides up; Close puts it away", async ({ chartroom, page }) => {
    await chartroom.open();
    await page.locator(".tool[data-mode='location']").click();
    await tap(page, 200, 200);
    await expect.poll(async () => (await chartroom.chart()).features.length).toBe(1);
    const sheet = page.locator(".right-panel");
    await expect.poll(async () => (await sheet.boundingBox()).y).toBeLessThan(844);
    await expect(page.locator("#feature-name")).toBeVisible();
    await page.locator("#sheet-close").click();
    await expect.poll(async () => (await sheet.boundingBox()).y).toBeGreaterThanOrEqual(844);
  });

  test("two fingers zoom the chart without placing anything, whatever the tool", async ({ chartroom, page }) => {
    await chartroom.open();
    await page.locator(".tool[data-mode='route']").click();
    const zoom = () => page.evaluate(() => window.__host.workspace?.charts?.[0]?.view?.zoom ?? 0);
    await finger(page, "pointerdown", 1, 150, 300);
    await finger(page, "pointerdown", 2, 250, 300);
    await finger(page, "pointermove", 1, 100, 300);
    await finger(page, "pointermove", 2, 300, 300);
    await finger(page, "pointerup", 1, 100, 300);
    await finger(page, "pointerup", 2, 300, 300);
    await expect.poll(zoom).toBeGreaterThan(0);
    const chart = await chartroom.chart();
    expect(chart.route).toEqual([]);
    expect(chart.view.zoom).toBeGreaterThan(5 * 1.8);
  });

  test("Done ends a tool that keeps adding, as Escape does", async ({ chartroom, page }) => {
    await chartroom.open();
    await expect(page.locator("#tool-done")).toBeHidden();
    await page.locator(".tool[data-mode='route']").click();
    await tap(page, 150, 200);
    await tap(page, 250, 300);
    await expect.poll(async () => (await chartroom.chart()).route.length).toBe(2);
    await page.locator("#tool-done").click();
    await expect(page.locator(".tool[data-mode='select']")).toHaveClass(/active/);
    await expect(page.locator("#tool-done")).toBeHidden();
  });

  test("a long press still places, and a double tap adds nothing", async ({ chartroom, page }) => {
    await chartroom.open(createWorkspace());
    await finger(page, "pointerdown", 1, 200, 200);
    await finger(page, "pointerup", 1, 200, 200);
    await finger(page, "pointerdown", 1, 200, 200);
    await finger(page, "pointerup", 1, 200, 200);
    await page.locator("#chart-canvas").dispatchEvent("dblclick", { clientX: 200, clientY: 250 });
    await page.locator(".tool[data-mode='location']").click();
    await finger(page, "pointerdown", 1, 200, 300);
    await page.waitForTimeout(650);
    await finger(page, "pointerup", 1, 200, 300);
    await expect.poll(async () => (await chartroom.chart()).features.length).toBe(1);
  });

  test("Items opens the chart items as a sheet, and the route card is a chip until tapped", async ({ chartroom, page }) => {
    const workspace = createWorkspace();
    workspace.charts[0].features.push(createFeature({ lat: 20, lon: 5, name: "Gold Rock City" }));
    await chartroom.open(workspace);
    await page.locator("#touch-items").click();
    await expect(chartroom.items().filter({ hasText: "Gold Rock City" })).toBeVisible();
    await page.locator("#sheet-close").click();
    await page.locator(".tool[data-mode='route']").click();
    await tap(page, 150, 300);
    await tap(page, 250, 400);
    await expect(page.locator("#route-distance")).toBeVisible();
    await expect(page.locator("#save-route")).toBeHidden();
    await page.locator("#route-summary-heading").click();
    await expect(page.locator("#save-route")).toBeVisible();
  });
});

test.describe("on a phone, after the unusual", () => {
  test.use(phone);

  test("a pinch begun after the first finger started drawing leaves nothing behind", async ({ chartroom, page }) => {
    await chartroom.open();
    await page.locator(".tool[data-mode='area']").click();
    await finger(page, "pointerdown", 1, 150, 300);
    await finger(page, "pointermove", 1, 190, 300);
    await finger(page, "pointerdown", 2, 250, 300);
    await finger(page, "pointermove", 2, 300, 300);
    await finger(page, "pointerup", 1, 190, 300);
    await finger(page, "pointerup", 2, 300, 300);
    await page.locator("#tool-done").click();
    await expect.poll(() => page.evaluate(() => window.__host.workspace?.charts?.[0]?.features?.length ?? 0)).toBe(0);
  });

  test("a finger whose lift was never seen doesn't turn the next tap into a pinch", async ({ chartroom, page }) => {
    await chartroom.open();
    await finger(page, "pointerdown", 7, 100, 100);
    await page.locator(".tool[data-mode='location']").click();
    await tap(page, 200, 200);
    await expect.poll(async () => (await chartroom.chart()).features.length).toBe(1);
  });

  test("the menu sheet closes when a menu item or the top bar is used", async ({ chartroom, page }) => {
    await chartroom.open();
    await page.locator("#touch-menu").click();
    await expect(page.locator("body")).toHaveClass(/menu-open/);
    await page.locator("#touch-undo").click({ force: true });
    await expect(page.locator("body")).not.toHaveClass(/menu-open/);
    await page.locator("#touch-menu").click();
    await page.locator("#touch-menu").click();
    await expect(page.locator("body")).not.toHaveClass(/menu-open/);
  });
});

test.describe("on a tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

  test("the menus stay, the tools are a rail, and the inspector is a drawer", async ({ chartroom, page }) => {
    await chartroom.open();
    await expect(page.locator("body")).toHaveClass(/tablet/);
    await expect(page.locator('.app-menu[data-menu="file"] > summary')).toBeVisible();
    expect((await page.locator(".left-panel").boundingBox()).width).toBeLessThan(80);
    await page.locator(".tool[data-mode='location']").click();
    await tap(page, 300, 300);
    await expect(page.locator("#feature-name")).toBeInViewport();
  });
});

test("a desktop window, however narrow, keeps the desktop layout", async ({ chartroom, page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await chartroom.open();
  await expect(page.locator("body")).not.toHaveClass(/touch/);
  await expect(page.locator("#touch-menu")).toBeHidden();
});

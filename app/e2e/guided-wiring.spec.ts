/**
 * Guided wiring (ADR 0017): shape a wire with guide points and reshape a route in the rear
 * view, all undoable; then take the instruments' grounds to a bus bar.
 */
import { expect, test, type Page } from '@playwright/test';

type W = { id: string; label: string; route: string | null; tubeBoreMm: number | null; via?: { x: number; y: number; z: number }[]; from: { part: string; pin?: string }; to: { part: string; pin?: string } };
type G = {
  gpd: {
    docs: { doc: { wires: W[]; routes: { id: string; points: { x: number; y: number; z: number }[] }[]; parts: { id: string; part: { id: string } }[]; nets: { id: string; type: string; members: { part: string }[] }[] } };
    ui: { state: { zoom: number; centre: { x: number; y: number }; selection: string[] }; set: (p: object) => void };
    analyse: (d: unknown) => { wires: Map<string, { currentA: number; length: { estimated: boolean } | null }>; loads: { partId: string; grounded: boolean }[] };
  };
};
const doc = (page: Page) => page.evaluate(() => (window as unknown as G).gpd.docs.doc);
const select = (page: Page, id: string) => page.evaluate((i) => (window as unknown as G).gpd.ui.set({ selection: [i] }), id);

async function runCommand(page: Page, name: string) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
}

/** Screen point of a world point in the rear view (x mirrored). */
async function rearScreen(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator('svg.canvas').boundingBox())!;
  const st = await page.evaluate(() => (window as unknown as G).gpd.ui.state);
  return { x: box.x + box.width / 2 - (p.x - st.centre.x) * st.zoom, y: box.y + box.height / 2 - (p.y - st.centre.y) * st.zoom };
}

async function centreOf(page: Page, selector: string) {
  const b = (await page.locator(selector).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function dragFrom(page: Page, from: { x: number; y: number }, by: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x / 2, from.y + by.y / 2, { steps: 4 });
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 4 });
  await page.mouse.up();
}

test('guide a wire and reshape a route in the rear view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await runCommand(page, 'open wiring sample');
  await page.getByRole('button', { name: 'Rear', exact: true }).click();
  await page.keyboard.press('f');

  // Click a wire that is not on a route: its inspector says how to shape it, and it shows one handle.
  const w = (await doc(page)).wires.find((x) => !x.route && !x.tubeBoreMm && x.from.part === 'flarm' && x.to.part === 'vario')!;
  const on = await page.evaluate((id) => {
    const path = document.querySelector(`.rear-wiring [data-wire="${id}"]`) as SVGPathElement;
    const p = path.getPointAtLength(path.getTotalLength() * 0.3);
    const r = path.ownerSVGElement!.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, w.id);
  await page.mouse.click(on.x, on.y);
  await expect(page.getByTestId('insp-wire-guide')).toContainText('drag the + in the middle of a leg');
  const handles = page.locator(`[data-guide="${w.id}"]`);
  await expect(handles.locator('[data-handle="insert-1"]')).toBeVisible();
  await expect(handles.locator('.guide-point')).toHaveCount(0);

  // Drag the middle handle down: the wire gets a guide point, and its length is no longer an estimate.
  const zoom = await page.evaluate(() => (window as unknown as G).gpd.ui.state.zoom);
  await dragFrom(page, await centreOf(page, `[data-guide="${w.id}"] [data-handle="insert-1"]`), { x: 0, y: 40 * zoom });
  let wire = (await doc(page)).wires.find((x) => x.id === w.id)!;
  expect(wire.via).toHaveLength(1);
  await expect(page.getByTestId('insp-wire-guide')).toContainText('Led through 1 guide point');
  const estimated = await page.evaluate((id) => {
    const g = (window as unknown as G).gpd;
    return g.analyse(g.docs.doc).wires.get(id)!.length!.estimated;
  }, w.id);
  expect(estimated).toBe(false);
  await expect(handles.locator('.guide-point')).toHaveCount(1);
  await expect(handles.locator('.guide-insert')).toHaveCount(2);

  // Add a second bend on the new leg, then move the first point across.
  await dragFrom(page, await centreOf(page, `[data-guide="${w.id}"] [data-handle="insert-2"]`), { x: 30 * zoom, y: 0 });
  wire = (await doc(page)).wires.find((x) => x.id === w.id)!;
  expect(wire.via).toHaveLength(2);
  const before = wire.via![0]!;
  await dragFrom(page, await centreOf(page, `[data-guide="${w.id}"] [data-handle="point-1"]`), { x: -20 * zoom, y: 0 });
  wire = (await doc(page)).wires.find((x) => x.id === w.id)!;
  // The rear view mirrors x: dragging left on screen moves the point to +x.
  expect(wire.via![0]!.x).toBeGreaterThan(before.x + 15);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/guided-wire.png' });

  // Double-click a point to remove it; undo puts it back; Straighten clears them all.
  await page.locator(`[data-guide="${w.id}"] [data-handle="point-2"]`).dblclick();
  expect((await doc(page)).wires.find((x) => x.id === w.id)!.via).toHaveLength(1);
  await page.keyboard.press('Control+z');
  expect((await doc(page)).wires.find((x) => x.id === w.id)!.via).toHaveLength(2);
  await page.getByTestId('insp-wire-straighten').click();
  expect((await doc(page)).wires.find((x) => x.id === w.id)!.via).toBeUndefined();
  await page.keyboard.press('Control+z');

  // A wire on a route follows the route: no handles, and the inspector says so.
  const routed = (await doc(page)).wires.find((x) => x.route)!;
  await select(page, routed.id);
  await expect(page.getByTestId('insp-wire-guide')).toContainText('Follows its route');
  await expect(page.locator(`[data-guide="${routed.id}"]`)).toHaveCount(0);

  // Routes reshape the same way: drag out a new point in the middle of the first leg.
  const route = (await doc(page)).routes[0]!;
  await select(page, route.id);
  await dragFrom(page, await centreOf(page, `[data-guide="${route.id}"] [data-handle="insert-1"]`), { x: -25 * zoom, y: 0 });
  const after = (await doc(page)).routes[0]!;
  expect(after.points).toHaveLength(route.points.length + 1);
  expect(after.points[1]!.z).toBe(route.points[0]!.z);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/guided-route.png' });
  expect(errors).toEqual([]);
});

test('a bus bar joins the instruments’ grounds into one net', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await runCommand(page, 'open wiring sample');
  await page.getByRole('button', { name: 'Rear', exact: true }).click();
  await page.keyboard.press('f');

  // Take the vario's and the flight computer's grounds off the battery.
  const direct = (await doc(page)).wires.filter((x) => (x.from.part === 'vario' || x.from.part === 'fc') && x.from.pin === 'GND' && x.to.part === 'bat');
  expect(direct).toHaveLength(2);
  await page.evaluate((ids) => (window as unknown as G).gpd.ui.set({ selection: ids }), direct.map((x) => x.id));
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-check="ungrounded:vario/PWR/GND"]')).toBeVisible();

  // Place a bus bar behind the panel, clear of the instruments.
  await page.getByTestId('library-search').fill('bus bar');
  await page.getByTestId('lib-generic.bus-bar').click();
  const at = await rearScreen(page, { x: -10, y: 0 });
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('Escape');
  const bus = (await doc(page)).parts.find((p) => p.part.id === 'generic.bus-bar')!;

  // Wire the battery − to stud 1, and each instrument's ground to its own stud.
  await page.keyboard.press('w');
  const fan = page.locator('.terminal-fan [data-terminal="bat/T/-"]');
  await fan.click();
  await page.locator(`[data-terminal="${bus.id}/BUS/1"]`).click();
  for (const [k, stud] of [
    ['vario/PWR/GND', 2],
    ['fc/PWR/GND', 3],
  ] as const) {
    await page.locator(`[data-terminal="${k}"]`).click();
    await page.locator(`[data-terminal="${bus.id}/BUS/${stud}"]`).click();
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-check^="ungrounded:"]')).toHaveCount(0);

  const d = await doc(page);
  const nets = d.nets.filter((n) => n.members.some((m) => m.part === bus.id));
  expect(nets).toHaveLength(1);
  expect(nets[0]!.type).toBe('ground');
  const loads = await page.evaluate(() => {
    const g = (window as unknown as G).gpd;
    return g.analyse(g.docs.doc).loads.filter((l) => l.partId === 'vario' || l.partId === 'fc').map((l) => l.grounded);
  });
  expect(loads).toEqual([true, true]);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/bus-bar.png' });
  // The schematic draws the bar as a block with its studs.
  await page.getByRole('button', { name: 'Schematic', exact: true }).click();
  await expect(page.getByTestId(`schem-${bus.id}`)).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/bus-bar-schematic.png' });
  expect(errors).toEqual([]);
});

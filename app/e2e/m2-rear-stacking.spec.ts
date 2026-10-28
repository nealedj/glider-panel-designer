/**
 * M2 acceptance: a unit mounted behind a long radio shows no clash; moving the radio moves
 * it; a deliberate clash is flagged and zooms on click. Also covers the stack inspector,
 * Tab cycling, the depth slider and delete-with-children.
 */
import { expect, test, type Page } from '@playwright/test';

type Part = { id: string; x: number; y: number; label: string; mountedTo: { parent: string; dx: number; dy: number; dz: number } | null };
type Gpd = { gpd: { docs: { doc: { parts: Part[] } }; ui: { state: { view: string; zoom: number; selection: string[]; centre: { x: number; y: number } } } } };

const getDoc = (page: Page) => page.evaluate(() => (window as unknown as Gpd).gpd.docs.doc);
const getUi = (page: Page) => page.evaluate(() => (window as unknown as Gpd).gpd.ui.state);

async function runCommand(page: Page, name: string) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
}

async function canvasPoint(page: Page, fx: number, fy: number) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  return { x: box.x + 24 + (box.width - 24) * fx, y: box.y + 24 + (box.height - 24) * fy };
}

async function setField(page: Page, testId: string, value: string) {
  const f = page.getByTestId(testId);
  await f.fill(value);
  await f.press('Enter');
  await f.press('Escape');
}

async function place(page: Page, partId: string, fx: number, fy: number, label: string): Promise<string> {
  await page.getByTestId(`lib-${partId}`).click();
  const p = await canvasPoint(page, fx, fy);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Escape');
  const doc = await getDoc(page);
  const id = doc.parts.at(-1)!.id;
  await setField(page, 'insp-label', label);
  return id;
}

test('unit mounted behind a long radio: no clash, moves with it; a clash is flagged and zooms', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await runCommand(page, 'new project');
  await page.getByTestId('new-create').click();
  await page.keyboard.press('f');

  // A long radio, 57 mm round and 120 mm deep, at the panel centre.
  const radio = await place(page, 'generic.round-57', 0.5, 0.45, 'Radio');
  await setField(page, 'insp-x', '0');
  await setField(page, 'insp-y', '0');
  await page.getByTestId('inspector').getByLabel('Body depth').fill('120');
  await page.getByTestId('inspector').getByLabel('Body depth').press('Enter');
  await expect(page.getByTestId('insp-band')).toHaveText('0 to 120 mm behind panel');

  // A FLARM-sized box on the panel back face, right over the radio: a deliberate clash.
  const unit = await place(page, 'generic.remote-unit', 0.3, 0.7, 'Unit');
  await setField(page, 'insp-x', '0');
  await setField(page, 'insp-y', '0');
  const clash = page.locator('[data-check^="clash:"]');
  await expect(clash).toHaveCount(1);
  await expect(clash).toHaveText(/(Radio and Unit|Unit and Radio) clash behind the panel \(depth 0.0 mm to 40.0 mm\)/);
  await expect(clash).toHaveClass(/sev-error/);

  // Clicking the check switches to the rear view, selects both and zooms to them.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const before = await getUi(page);
  await clash.click();
  const after = await getUi(page);
  expect(after.view).toBe('rear');
  expect([...after.selection].sort()).toEqual([radio, unit].sort());
  expect(after.zoom).toBeGreaterThan(before.zoom);
  expect(Math.hypot(after.centre.x, after.centre.y)).toBeLessThan(1);
  await expect(page.locator(`[data-rear-part="${radio}"]`)).toHaveClass(/is-clash/);
  await expect(page.getByText('Rear · viewed from behind')).toBeVisible();
  await page.screenshot({ path: 'test-results/m2-clash.png' });

  // Stack inspector: clicking the shared point lists both, deepest first; Tab cycles.
  const c = await canvasPoint(page, 0.5, 0.5);
  await page.mouse.click(c.x, c.y);
  const items = page.getByTestId('stack-panel').locator('li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Radio');
  await expect(items.nth(0)).toContainText('0–120 mm');
  await expect(items.nth(1)).toContainText('Unit');
  expect((await getUi(page)).selection).toEqual([radio]);
  await page.keyboard.press('Tab');
  expect((await getUi(page)).selection).toEqual([unit]);
  await page.keyboard.press('Tab');
  expect((await getUi(page)).selection).toEqual([radio]);

  // Mount the unit behind the radio from the stack: no clash, and nothing cut for it.
  await page.getByTestId(`stack-${unit}`).click();
  await page.getByTestId('insp-mount').selectOption(radio);
  await expect(page.getByTestId('insp-dz')).toHaveValue('120');
  await expect(page.getByTestId('insp-band')).toHaveText('120 to 160 mm behind panel');
  await expect(clash).toHaveCount(0);
  await expect(page.locator('[data-check^="depth:"]')).toHaveCount(0);
  await page.mouse.click(c.x, c.y);
  await expect(items.nth(0)).toContainText('Unit');
  await expect(items.nth(0)).toContainText('120–160 mm');
  await page.screenshot({ path: 'test-results/m2-mounted.png' });

  // Moving the radio moves the unit: by typed position, then by a nudge, then by drag.
  await page.getByTestId(`stack-${radio}`).click();
  await setField(page, 'insp-x', '30');
  await page.keyboard.press('ArrowRight');
  let doc = await getDoc(page);
  expect(doc.parts.find((p) => p.id === radio)).toMatchObject({ x: 31, y: 0 });
  expect(doc.parts.find((p) => p.id === unit)!.mountedTo).toMatchObject({ parent: radio, dx: 0, dy: 0, dz: 120 });
  await page.getByTestId(`stack-${unit}`).click().catch(() => {});
  await page.getByTestId(`tree-${unit}`).click();
  await expect(page.getByTestId('insp-x')).toHaveValue('31');

  // Drag the radio in the rear view: x is mirrored on screen, so dragging right moves it to -x.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const zoom = (await getUi(page)).zoom;
  const r0 = await page.locator(`[data-rear-part="${radio}"] .body`).boundingBox();
  // Grab the radio's top edge, clear of the unit, which sits on top of it.
  const grab = { x: r0!.x + r0!.width / 2, y: r0!.y + 1.5 * zoom };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 10 * zoom, grab.y, { steps: 5 });
  await page.mouse.move(grab.x + 20 * zoom, grab.y, { steps: 5 });
  await page.mouse.up();
  doc = await getDoc(page);
  const rx = doc.parts.find((p) => p.id === radio)!.x;
  expect(rx).toBeLessThan(31 - 15);
  await page.getByTestId(`tree-${unit}`).click();
  await expect(page.getByTestId('insp-x')).toHaveValue(String(Math.round(rx * 1000) / 1000));
  await expect(clash).toHaveCount(0);

  // Front view: the mounted unit cuts nothing and shows as a hidden outline.
  await page.keyboard.press('v');
  expect((await getUi(page)).view).toBe('front');
  await expect(page.locator(`[data-part="${unit}"] .cutout`)).toHaveCount(0);
  await expect(page.locator(`[data-part="${unit}"] .behind`)).toHaveCount(1);
  await page.keyboard.press('v');

  // Depth slider: show only 125 mm and deeper; the radio is clipped, the unit is not.
  await page.getByTestId('depth-near').fill('125');
  await expect(page.locator(`[data-rear-part="${radio}"]`)).toHaveClass(/is-clipped/);
  await expect(page.locator(`[data-rear-part="${unit}"]`)).not.toHaveClass(/is-clipped/);
  await page.screenshot({ path: 'test-results/m2-depth-clip.png' });
  await runCommand(page, 'show all depths');
  await expect(page.locator(`[data-rear-part="${radio}"]`)).not.toHaveClass(/is-clipped/);

  // A deliberate clash again: pull the unit forward into the radio.
  await page.getByTestId(`tree-${unit}`).click();
  await setField(page, 'insp-dz', '100');
  await expect(clash).toHaveCount(1);
  await expect(clash).toHaveText(/depth 100\.0 mm to 120\.0 mm/);
  await setField(page, 'insp-dz', '120');
  await expect(clash).toHaveCount(0);

  // Deleting the radio deletes the unit too, with a warning; undo brings both back.
  await page.getByTestId(`tree-${radio}`).click();
  await page.keyboard.press('Delete');
  doc = await getDoc(page);
  expect(doc.parts).toHaveLength(0);
  await expect(page.getByText('Also deleted 1 mounted part(s)')).toBeVisible();
  await page.keyboard.press('Control+z');
  doc = await getDoc(page);
  expect(doc.parts.map((p) => p.id).sort()).toEqual([radio, unit].sort());

  expect(errors).toEqual([]);
});

test('performance: rear view with 200 parts, half of them mounted behind the others', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'new project');
  await page.getByTestId('new-create').click();
  await page.evaluate(() => {
    const g = (window as unknown as { gpd: { docs: { dispatch: (l: string, o: unknown[]) => void } } }).gpd.docs;
    const kinds = ['generic.round-57', 'generic.round-80', 'generic.toggle-switch', 'generic.fuse-holder', 'generic.rect-display'];
    const list = [];
    for (let i = 0; i < 100; i++) {
      const base = { rotation: 0, depthOffset: 0, locked: false };
      const x = (i % 10) * 60 - 270;
      const y = Math.floor(i / 10) * 60 - 270;
      list.push({ op: 'insert', coll: 'parts', item: { ...base, id: `perf${i}`, part: { id: kinds[i % kinds.length], version: 1 }, x, y, label: `P${i}`, mountedTo: null } });
      list.push({
        op: 'insert',
        coll: 'parts',
        item: { ...base, id: `box${i}`, part: { id: 'generic.remote-unit', version: 1 }, x, y, label: `B${i}`, mountedTo: { parent: `perf${i}`, dx: 5, dy: 5, dz: 130 } },
      });
    }
    g.dispatch('perf', list);
  });
  await page.keyboard.press('v');
  await page.keyboard.press('f');
  await expect(page.locator('[data-rear-part]')).toHaveCount(200);

  const box = (await page.getByTestId('canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  const startFrames = () =>
    page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __rec: boolean };
      w.__frames = [];
      w.__rec = true;
      let last = performance.now();
      const tick = (t: number) => {
        w.__frames.push(t - last);
        last = t;
        if (w.__rec) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  const stopFrames = () =>
    page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __rec: boolean };
      w.__rec = false;
      const f = w.__frames.slice(1).sort((a, b) => a - b);
      return f[Math.floor(f.length / 2)]!;
    });
  const measure = async (fn: (i: number) => Promise<void>) => {
    await startFrames();
    for (let i = 0; i < 40; i++) await fn(i);
    return stopFrames();
  };
  const zoom = await measure((i) => page.mouse.wheel(0, i % 2 ? 40 : -40));
  await page.keyboard.down('Space');
  await page.mouse.down();
  const pan = await measure((i) => page.mouse.move(cx + 3 * i, cy + 2 * i));
  await page.mouse.up();
  await page.keyboard.up('Space');
  await page.keyboard.press('f');
  const target = await page.evaluate(() => {
    const el = document.querySelector('[data-rear-part="box55"] .body')!.getBoundingClientRect();
    return { x: el.left + el.width / 2, y: el.top + el.height / 2 };
  });
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  const drag = await measure((i) => page.mouse.move(target.x + 10 + 2 * i, target.y + i));
  await page.mouse.up();
  // Time one full check run after an edit (nudge), as the checks panel sees it.
  const checkMs = await page.evaluate(async () => {
    (window as unknown as { gpd: { ui: { set: (p: unknown) => void } } }).gpd.ui.set({ selection: ['perf55'] });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    return performance.now() - t0;
  });
  console.log(`rear, 200 parts — median frame: zoom ${zoom.toFixed(1)} ms, pan ${pan.toFixed(1)} ms, drag ${drag.toFixed(1)} ms; nudge to next frame ${checkMs.toFixed(1)} ms`);
  await page.screenshot({ path: 'test-results/m2-200-parts-rear.png' });
  expect(zoom).toBeLessThan(20);
  expect(pan).toBeLessThan(20);
  expect(drag).toBeLessThan(20);
});

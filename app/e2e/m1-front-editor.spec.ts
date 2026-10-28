/**
 * M1 acceptance: ten parts placed by mouse and keyboard; positions match typed values to
 * 0.01 mm; undo restores every step; performance target met at 200 parts.
 */
import { expect, test, type Page } from '@playwright/test';

type Doc = { parts: { id: string; x: number; y: number; rotation: number; label: string; part: { id: string } }[] };

const getDoc = (page: Page) => page.evaluate(() => (window as unknown as { gpd: { docs: { doc: unknown } } }).gpd.docs.doc) as Promise<Doc>;

async function runCommand(page: Page, name: string) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
}

async function canvasPoint(page: Page, fx: number, fy: number) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  return { x: box.x + 24 + (box.width - 24) * fx, y: box.y + 24 + (box.height - 24) * fy };
}

test('ten parts by mouse and keyboard, exact typed positions, full undo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await runCommand(page, 'new project');
  await page.getByTestId('new-create').click();
  await expect(page.locator('[data-part]')).toHaveCount(0);

  const snapshots: Doc[] = [await getDoc(page)];
  const snap = async () => snapshots.push(await getDoc(page));

  // Eight parts by mouse: pick from the library, click on the panel.
  const picks: [string, number, number][] = [
    ['generic.round-80', 0.3, 0.32],
    ['generic.round-57', 0.5, 0.3],
    ['generic.round-80', 0.7, 0.32],
    ['generic.rect-display', 0.5, 0.55],
    ['generic.toggle-switch', 0.38, 0.72],
    ['generic.fuse-holder', 0.46, 0.72],
    ['generic.breaker', 0.54, 0.72],
    ['generic.placard', 0.62, 0.72],
  ];
  for (const [id, fx, fy] of picks) {
    await page.getByTestId(`lib-${id}`).click();
    const p = await canvasPoint(page, fx, fy);
    await page.mouse.click(p.x, p.y);
    await snap();
  }
  await page.keyboard.press('Escape');

  // Two more by keyboard: duplicate the selected placard twice.
  await page.keyboard.press('Control+d');
  await snap();
  await page.keyboard.press('Control+d');
  await snap();
  let doc = await getDoc(page);
  expect(doc.parts).toHaveLength(10);
  await page.screenshot({ path: 'test-results/m1-placed.png' });

  // Typed positions, including an imperial value, land to 0.01 mm.
  const typed: [string, string, number, number][] = doc.parts.map((p, i) => {
    // A 5 × 2 grid, offset by odd hundredths so every value is a real test of precision.
    const x = Math.round((-120 + (i % 5) * 60 + i * 0.37) * 100) / 100;
    const y = Math.round((50 - Math.floor(i / 5) * 80 + i * 0.11) * 100) / 100;
    return [p.id, i === 3 ? '2.25in' : String(x), i === 3 ? 57.15 : x, y];
  });
  for (const [id, xText, , y] of typed) {
    await page.evaluate((pid) => (window as unknown as { gpd: { ui: { set: (s: object) => void } } }).gpd.ui.set({ selection: [pid] }), id);
    await page.getByTestId('insp-x').fill(xText);
    await page.getByTestId('insp-x').press('Enter');
    await snap();
    await page.getByTestId('insp-y').fill(String(y));
    await page.getByTestId('insp-y').press('Enter');
    await snap();
  }
  doc = await getDoc(page);
  for (const [id, , x, y] of typed) {
    const p = doc.parts.find((q) => q.id === id)!;
    expect(Math.abs(p.x - x)).toBeLessThan(0.01);
    expect(Math.abs(p.y - y)).toBeLessThan(0.01);
  }

  // Keyboard nudges: 1 mm, 10 mm, 0.1 mm; rotate.
  const first = typed[0]![0];
  await page.getByTestId('insp-y').press('Escape');
  await page.evaluate((pid) => (window as unknown as { gpd: { ui: { set: (s: object) => void } } }).gpd.ui.set({ selection: [pid] }), first);
  await page.keyboard.press('ArrowRight');
  await snap();
  await page.keyboard.press('Shift+ArrowUp');
  await snap();
  await page.keyboard.press('Alt+ArrowLeft');
  await snap();
  await page.keyboard.press('r');
  await snap();
  doc = await getDoc(page);
  const moved = doc.parts.find((p) => p.id === first)!;
  expect(moved.x).toBeCloseTo(typed[0]![2] + 0.9, 6);
  expect(moved.y).toBeCloseTo(typed[0]![3] + 10, 6);
  expect(moved.rotation).toBe(90);

  // Drag with a typed distance: exact 12.5 mm to the right.
  const before = doc.parts.find((p) => p.id === typed[1]![0])!;
  const centre = await page.evaluate(
    ([px, py]) => {
      const el = document.querySelector('[data-testid="canvas"]')!.getBoundingClientRect();
      const s = (window as unknown as { gpd: { ui: { state: { zoom: number; centre: { x: number; y: number } } } } }).gpd.ui.state;
      const w = el.width - 24;
      const h = el.height - 24;
      return { x: el.left + 24 + w / 2 + (px! - s.centre.x) * s.zoom, y: el.top + 24 + h / 2 - (py! - s.centre.y) * s.zoom };
    },
    [before.x, before.y],
  );
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 30, centre.y + 1, { steps: 5 });
  await page.keyboard.type('12.5');
  await page.keyboard.press('Enter');
  await page.mouse.up();
  await snap();
  doc = await getDoc(page);
  const dragged = doc.parts.find((p) => p.id === before.id)!;
  expect(dragged.x - before.x).toBeCloseTo(12.5, 6);
  expect(dragged.y).toBeCloseTo(before.y, 6);
  await page.screenshot({ path: 'test-results/m1-positioned.png' });

  // Undo restores every step, back to the empty project.
  for (let i = snapshots.length - 2; i >= 0; i--) {
    await page.keyboard.press('Control+z');
    expect(await getDoc(page)).toEqual(snapshots[i]);
  }
  // And redo replays them.
  for (let i = 1; i < snapshots.length; i++) {
    await page.keyboard.press('Control+Shift+z');
    expect(await getDoc(page)).toEqual(snapshots[i]);
  }
  expect(errors).toEqual([]);
});

test('autosave restores work after a reload', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'new project');
  await page.getByTestId('new-create').click();
  await page.getByTestId('lib-generic.round-57').click();
  const p = await canvasPoint(page, 0.5, 0.5);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('[data-part]')).toHaveCount(1);
  await expect(page.locator('.statusbar .hint')).toContainText('Restored');
});

test('window selection and measure tool', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'open sample project');
  // Right to left crossing window over the top row selects all three instruments.
  const a = await canvasPoint(page, 0.9, 0.2);
  const b = await canvasPoint(page, 0.1, 0.35);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  const sel = await page.evaluate(() => (window as unknown as { gpd: { ui: { state: { selection: string[] } } } }).gpd.ui.state.selection);
  expect(sel).toEqual(expect.arrayContaining(['p1', 'p2', 'p3']));

  await page.keyboard.press('Shift+M');
  // Measure between the ASI and altimeter centres; snapping lands on the centres.
  const pts = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="canvas"]')!.getBoundingClientRect();
    const s = (window as unknown as { gpd: { ui: { state: { zoom: number; centre: { x: number; y: number } } } } }).gpd.ui.state;
    const w = el.width - 24;
    const h = el.height - 24;
    const sc = (x: number, y: number) => ({ x: el.left + 24 + w / 2 + (x - s.centre.x) * s.zoom, y: el.top + 24 + h / 2 - (y - s.centre.y) * s.zoom });
    return [sc(-94.5, 40.4), sc(95.3, 39.8)];
  });
  await page.mouse.move(pts[0]!.x, pts[0]!.y);
  await page.mouse.click(pts[0]!.x, pts[0]!.y);
  await page.mouse.move(pts[1]!.x, pts[1]!.y);
  await page.mouse.click(pts[1]!.x, pts[1]!.y);
  await expect(page.getByTestId('measure')).toContainText('190.00 mm');
  await page.screenshot({ path: 'test-results/m1-measure.png' });
});

test('performance: pan, zoom and drag with 200 parts', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'new project');
  await page.getByTestId('new-create').click();
  await page.evaluate(() => {
    const g = (window as unknown as { gpd: { docs: { dispatch: (l: string, o: unknown[]) => void } } }).gpd.docs;
    const kinds = ['generic.round-57', 'generic.round-80', 'generic.toggle-switch', 'generic.fuse-holder', 'generic.rect-display'];
    const list = [];
    for (let i = 0; i < 200; i++) {
      list.push({
        op: 'insert',
        coll: 'parts',
        item: { id: `perf${i}`, part: { id: kinds[i % kinds.length], version: 1 }, x: (i % 20) * 30 - 285, y: Math.floor(i / 20) * 30 - 135, rotation: 0, label: `P${i}`, mountedTo: null, depthOffset: 0, locked: false },
      });
    }
    g.dispatch('perf', list);
  });
  await page.keyboard.press('f');
  await expect(page.locator('[data-part]')).toHaveCount(200);

  const box = (await page.getByTestId('canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);

  // Record frame intervals in the page while real input events stream in.
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
      return { median: f[Math.floor(f.length / 2)]!, p95: f[Math.floor(f.length * 0.95)]!, n: f.length };
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

  // Drag one part among 200.
  const target = await page.evaluate(() => {
    const el = document.querySelector('[data-part="perf105"] .cutout')!.getBoundingClientRect();
    return { x: el.left + el.width / 2, y: el.top + el.height / 2 };
  });
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  const drag = await measure((i) => page.mouse.move(target.x + 10 + 2 * i, target.y + i));
  await page.mouse.up();
  const zoomMs = zoom.median;
  const panMs = pan.median;
  const dragMs = drag.median;
  console.log(JSON.stringify({ zoom, pan, drag }));
  console.log(`200 parts — median frame: zoom ${zoomMs.toFixed(1)} ms, pan ${panMs.toFixed(1)} ms, drag ${dragMs.toFixed(1)} ms`);
  await page.screenshot({ path: 'test-results/m1-200-parts.png' });
  // Smooth means the browser keeps its frame rate: median frame within 60 fps (with slack).
  expect(zoomMs).toBeLessThan(20);
  expect(panMs).toBeLessThan(20);
  expect(dragMs).toBeLessThan(20);
});

test('drag from a ruler makes a guide; undo removes it', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'open sample project');
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 300, { steps: 6 });
  await page.mouse.up();
  const guides = await page.evaluate(() => (window as unknown as { gpd: { docs: { doc: { guides: { axis: string; value: number }[] } } } }).gpd.docs.doc.guides);
  expect(guides).toHaveLength(1);
  expect(guides[0]!.axis).toBe('y');
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => (window as unknown as { gpd: { docs: { doc: { guides: unknown[] } } } }).gpd.docs.doc.guides.length)).toBe(0);
});

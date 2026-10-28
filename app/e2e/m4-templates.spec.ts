/**
 * M4: panel templates from photos. The PIK-20D mock-up on its cutting mat becomes a
 * template through the editor: the grid is found and straightens the photo, the wand
 * suggests the outline, the datum levels it, the fold is traced, and the
 * result is saved to the library and used in a project. The photo of the fitted panel
 * calibrates from its round instruments.
 */
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

type V = { x: number; y: number };
type Gpd = {
  gpd: {
    tplUi: { state: { mode: string; photoView: { zoom: number; centre: V }; planeView: { zoom: number; centre: V }; message: string; busy: string }; set: (p: object) => void };
    drafts: { draft: { outline: (V & { bulge?: number })[]; bendLines: { a: V; b: V }[]; calibration: { kind: string; rmsMm: number; crossings?: number; model?: string } | null; photo: object | null } | null };
    draftMap: (d: unknown) => { toTemplate: (p: V) => V };
    docs: { doc: { template: { embedded?: { name: string } } } };
  };
};

const tpl = (page: Page) => page.evaluate(() => (window as unknown as Gpd).gpd.drafts.draft!);
const idle = (page: Page) => page.waitForFunction(() => !(window as unknown as Gpd).gpd.tplUi.state.busy);

/** Screen position of a photo pixel (photo view) or a template-mm point (straightened view). */
async function toScreen(page: Page, p: V, space: 'photo' | 'template'): Promise<V> {
  const box = (await page.getByTestId('tpl-canvas').boundingBox())!;
  const st = await page.evaluate(() => (window as unknown as Gpd).gpd.tplUi.state);
  const v = st.mode === 'photo' ? st.photoView : st.planeView;
  const w = space === 'photo' ? { x: p.x, y: -p.y } : p;
  return { x: box.x + box.width / 2 + (w.x - v.centre.x) * v.zoom, y: box.y + box.height / 2 - (w.y - v.centre.y) * v.zoom };
}

/** A photo pixel in template mm, through the current calibration and datum. */
const photoToTpl = (page: Page, p: V) => page.evaluate((q) => {
  const g = (window as unknown as Gpd).gpd;
  return g.draftMap(g.drafts.draft).toTemplate(q);
}, p);

async function clickAt(page: Page, p: V, space: 'photo' | 'template', mods: ('Shift' | 'Alt')[] = []) {
  const s = await toScreen(page, p, space);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.click(s.x, s.y);
  for (const m of mods) await page.keyboard.up(m);
}

async function setField(page: Page, testId: string, value: string) {
  const f = page.getByTestId(testId);
  await f.fill(value);
  await f.press('Enter');
}

// The mock-up's fold, as photo pixels (the photo is 1200 × 1600).
const FOLD = [
  { x: 368, y: 1190 },
  { x: 790, y: 1212 },
];

test('the PIK-20D mock-up photo becomes a template', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Template', exact: true }).click();
  await page.getByTestId('tpl-new').click();
  await setField(page, 'tpl-name', 'PIK-20D new layout (mock-up)');
  await page.getByTestId('tpl-input-type').selectOption('gridded-mockup');
  await page.getByTestId('tpl-photo-input').setInputFiles('../fixtures/pik20d/cardboard-mockup.jpg');
  await idle(page);
  await expect(page.getByTestId('tpl-message')).toContainText('Imported cardboard-mockup.jpg');

  // Calibrate from the mat: half-inch squares (solid inch lines, dashed halves).
  await page.getByTestId('tpl-grid-spacing').selectOption('12.7');
  await page.getByTestId('tpl-detect-grid').click();
  await expect(page.getByTestId('tpl-calibration')).toContainText('cutting-mat grid', { timeout: 30_000 });
  const cal = (await tpl(page)).calibration!;
  expect(cal.kind).toBe('grid');
  expect(cal.crossings).toBeGreaterThan(150);
  expect(cal.rmsMm).toBeLessThan(0.3);
  await page.screenshot({ path: 'test-results/m4-grid.png' });
  // Corrugated card stands about 3.5 mm proud of the mat.
  await setField(page, 'tpl-raised', '3.5');
  await expect(page.getByTestId('tpl-calibration')).toContainText('3.5 mm above the grid');

  // Straightened view: the wand suggests the outline from a click on the card.
  await page.getByTestId('tpl-to-outline').click();
  await idle(page);
  await clickAt(page, await photoToTpl(page, { x: 400, y: 1000 }), 'template');
  await idle(page);
  await expect(page.getByTestId('tpl-message')).toContainText('Outline suggested');
  let d = await tpl(page);
  expect(d.outline.length).toBeGreaterThan(8);
  expect(d.outline.length).toBeLessThan(80);
  expect(d.outline.some((p) => p.bulge)).toBe(true);

  // Datum: the two bottom corners of the stem; origin midway, levelled along them.
  // The bottom edge may carry extra vertices along it; its corners are its outermost ones.
  const minY = Math.min(...d.outline.map((p) => p.y));
  const onBottom = d.outline.filter((p) => p.y < minY + 4).sort((a, b) => a.x - b.x);
  const bottom = [onBottom[0]!, onBottom[onBottom.length - 1]!];
  await page.getByTestId('tpl-tool-datum').click();
  await clickAt(page, bottom[0]!, 'template');
  await clickAt(page, bottom[1]!, 'template');
  await idle(page);
  d = await tpl(page);
  const corners = d.outline.filter((p) => Math.abs(p.y) < 0.01).sort((a, b) => a.x - b.x);
  const low = [corners[0]!, corners[corners.length - 1]!];
  expect(low[0]!.x + low[1]!.x).toBeCloseTo(0, 2);
  const xs = d.outline.map((p) => p.x);
  const ys = d.outline.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  // Sanity against the mat's printed ruler: the card is about 16 inches wide and 14 tall
  // (its stem overhangs the desk edge, off the mat, so it may read short).
  expect(width).toBeGreaterThan(370);
  expect(width).toBeLessThan(440);
  expect(height).toBeGreaterThan(320);
  expect(height).toBeLessThan(440);
  writeFileSync('test-results/m4-size.txt', `width ${width.toFixed(1)} height ${height.toFixed(1)}\n`);
  await page.screenshot({ path: 'test-results/m4-outline.png' });

  // Features: the fold line. The instrument spaces drawn on the card are not traced: parts
  // belong in the project, not the template.
  await page.getByTestId('tpl-step-features').click();
  await page.getByTestId('tpl-tool-bend').click();
  for (const p of FOLD) await clickAt(page, await photoToTpl(page, p), 'template', ['Alt']);
  d = await tpl(page);
  expect(d.bendLines).toHaveLength(1);
  await setField(page, 'tpl-depth', '150');
  await page.screenshot({ path: 'test-results/m4-features.png' });

  // Accuracy, and the check-span tool (a dummy span, removed again).
  await page.getByTestId('tpl-step-accuracy').click();
  await expect(page.getByTestId('tpl-accuracy')).toContainText('Estimated error on any distance');
  const acc = Number(/±([\d.]+) mm/.exec((await page.getByTestId('tpl-accuracy').textContent())!)![1]);
  expect(acc).toBeGreaterThan(0.5);
  expect(acc).toBeLessThan(5);
  await page.getByTestId('tpl-tool-check').click();
  await clickAt(page, low.sort((a, b) => a.x - b.x)[0]!, 'template');
  await clickAt(page, low[1]!, 'template');
  const stem = Math.abs(low[1]!.x - low[0]!.x);
  await setField(page, 'tpl-check-label', 'Stem, bottom edge');
  await setField(page, 'tpl-check-measured', (stem + 0.4).toFixed(1));
  await page.getByTestId('tpl-check-add').click();
  await expect(page.getByTestId('tpl-checks')).toContainText('Stem, bottom edge');
  await expect(page.getByTestId('tpl-checks').locator('tr.ok')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/m4-accuracy.png' });
  await page.keyboard.press('Control+z');
  expect((await page.evaluate(() => (window as unknown as { gpd: { drafts: { draft: { checks: unknown[] } } } }).gpd.drafts.draft.checks))).toHaveLength(0);

  // Save to the library and use it in the project; the project carries it whole.
  await page.getByTestId('tpl-step-save').click();
  const [json] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON' }).click(),
  ]);
  writeFileSync('test-results/m4-pik20d-mockup.template.json', await (await json.createReadStream()).toArray().then((c) => Buffer.concat(c)));
  await page.getByTestId('tpl-use').click();
  await expect(page.getByTestId('lib-tpl-local.pik-20d-new-layout-mock-up')).toBeVisible();
  const embedded = await page.evaluate(() => (window as unknown as Gpd).gpd.docs.doc.template.embedded!);
  expect(embedded.name).toBe('PIK-20D new layout (mock-up)');
  expect(embedded).not.toHaveProperty('reservedAreas');
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  await page.keyboard.press('f');
  await page.screenshot({ path: 'test-results/m4-in-project.png' });
  expect(errors).toEqual([]);

  // The draft survives a reload, with its photo.
  await page.reload();
  await page.getByRole('button', { name: 'Template', exact: true }).click();
  await page.getByRole('region', { name: 'Template drafts' }).getByText('PIK-20D new layout (mock-up)').click();
  await page.waitForFunction(() => (window as unknown as Gpd).gpd.drafts.draft !== null);
  await idle(page);
  expect((await tpl(page)).bendLines).toHaveLength(1);
  expect((await tpl(page)).photo).not.toBeNull();
});

// Instrument rims in the fitted-panel photo: a rough centre and rim click each.
const INSTRUMENTS = [
  { label: 'ASI', c: { x: 232, y: 772 }, rim: { x: 345, y: 772 }, d: 80 },
  { label: 'XCVario', c: { x: 487, y: 706 }, rim: { x: 590, y: 706 }, d: 80 },
  { label: 'Mechanical vario', c: { x: 727, y: 718 }, rim: { x: 829, y: 718 }, d: 80 },
  { label: 'Altimeter', c: { x: 948, y: 803 }, rim: { x: 1047, y: 803 }, d: 80 },
  { label: 'Slip ball', c: { x: 500, y: 937 }, rim: { x: 572, y: 937 }, d: 57 },
  { label: 'Compass', c: { x: 686, y: 932 }, rim: { x: 756, y: 932 }, d: 57 },
  { label: 'KRT2', c: { x: 580, y: 1108 }, rim: { x: 652, y: 1108 }, d: 57 },
];

test('the current-panel photo calibrates from its round instruments', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Template', exact: true }).click();
  await page.getByTestId('tpl-new').click();
  await setField(page, 'tpl-name', 'PIK-20D as fitted');
  await page.getByTestId('tpl-input-type').selectOption('angled-photo');
  await page.getByTestId('tpl-photo-input').setInputFiles('../fixtures/pik20d/current-panel.jpg');
  await idle(page);
  await page.getByTestId('tpl-method-circles').click();
  for (const ins of INSTRUMENTS) {
    await clickAt(page, ins.c, 'photo');
    await clickAt(page, ins.rim, 'photo');
    await expect(page.getByTestId('tpl-rim-add')).toBeVisible();
    await setField(page, 'tpl-rim-label', ins.label);
    await setField(page, 'tpl-rim-d', String(ins.d));
    await page.getByTestId('tpl-rim-add').click();
  }
  await page.getByTestId('tpl-calibrate-circles').click();
  await expect(page.getByTestId('tpl-calibration')).toContainText('7 round instruments (projective)');
  const cal = (await tpl(page)).calibration!;
  expect(cal.model).toBe('projective');
  expect(cal.rmsMm).toBeLessThan(1);
  await page.screenshot({ path: 'test-results/m4-instruments.png' });
  await page.getByTestId('tpl-to-outline').click();
  await idle(page);
  await page.screenshot({ path: 'test-results/m4-instruments-straightened.png' });
});

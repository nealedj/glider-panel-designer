/**
 * M7: the reference panel and polish.
 *
 * - The whole PIK-20D example is made from scratch through the interface, with no JSON: a new
 *   project on the mock-up template; each instrument placed at a typed position; switch, fuses
 *   and exits typed in; placeholder sizes set in the inspector; the FLARM unit mounted on the
 *   XCTouchNav; every wire and tube connected pin to pin in the schematic; both looms drawn
 *   with the Route tool. The result equals the committed fixtures/projects/pik20d.json.
 * - That project produces every output through the export dialog (cut file with the bend
 *   line, rear layout, wiring diagram, wire list, bill of materials) and shares by link into
 *   a fresh browser unchanged.
 * - Onboarding: welcome and the three-step walkthrough; the shortcut map with rebinding;
 *   themes; crash recovery.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

type Part = { id: string; x: number; y: number; label: string; part: { id: string }; params?: Record<string, number>; mountedTo: { parent: string; dx: number; dy: number; dz: number } | null; depthOffset: number; offPanelRunMm: number | null };
type End = { part: string; connector?: string; pin?: string; port?: string };
type Wire = { id: string; from: End; to: End; label: string; colour: string; route: string | null; tubeBoreMm: number | null; sizeAuto: boolean; net: string };
type Doc = { name: string; template: unknown; parts: Part[]; wires: Wire[]; nets: { id: string; name: string; type: string }[]; routes: { id: string; label: string; points: { x: number; y: number; z: number }[] }[] };
type Gpd = {
  gpd: {
    docs: { doc: Doc; dispatch: (label: string, ops: unknown[]) => boolean };
    ui: { state: { zoom: number; centre: { x: number; y: number }; selection: string[]; message: string; theme: string } };
    prefs: { state: { theme: string; onboarded: boolean; keymap: Record<string, string> } };
    crash: (area: string) => void;
  };
};
const getDoc = (page: Page) => page.evaluate(() => (window as unknown as Gpd).gpd.docs.doc);
const fixture = JSON.parse(readFileSync(new URL('../../fixtures/projects/pik20d.json', import.meta.url), 'utf8')) as Doc;

const termKey = (e: End, id: (x: string) => string) => (e.port ? `${id(e.part)}//${e.port}` : `${id(e.part)}/${e.connector}/${e.pin}`);

/** A project with its ids replaced by names, so a rebuilt project compares with the original. */
function normal(d: Doc, id: (x: string) => string = (x) => x) {
  const route = (r: string | null) => (r ? d.routes.find((x) => x.id === r)!.label : null);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    parts: d.parts
      .map((p) => ({ id: id(p.id), part: p.part.id, label: p.label, at: p.mountedTo ? null : [r2(p.x), r2(p.y)], mountedTo: p.mountedTo && { ...p.mountedTo, parent: id(p.mountedTo.parent) }, depthOffset: p.depthOffset, offPanelRunMm: p.offPanelRunMm }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    wires: d.wires.map((w) => ({ from: termKey(w.from, id), to: termKey(w.to, id), label: w.label, colour: w.colour, route: route(w.route), tube: w.tubeBoreMm, auto: w.sizeAuto, net: d.nets.find((n) => n.id === w.net)!.name })),
    nets: d.nets.map((n) => `${n.type} ${n.name}`).sort(),
    routes: d.routes.map((r) => ({ label: r.label, points: r.points.map((p) => [r2(p.x), r2(p.y), r2(p.z)]) })),
  };
}

async function runCommand(page: Page, name: string) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
}

async function setField(page: Page, testId: string, value: string) {
  const f = page.getByTestId(testId);
  await f.fill(value);
  await f.press('Enter');
}

async function download(page: Page, click: () => Promise<void>) {
  // Chromium drops a download that starts while the last one is still being handed over.
  await page.waitForTimeout(400);
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), bytes: readFileSync(await dl.path()) };
}

/** Screen position of a world point; the rear view mirrors x. */
async function worldToScreen(page: Page, x: number, y: number, rear = false) {
  const box = (await page.locator('svg.canvas').boundingBox())!;
  const st = await page.evaluate(() => (window as unknown as Gpd).gpd.ui.state);
  return { x: box.x + box.width / 2 + (rear ? -1 : 1) * (x - st.centre.x) * st.zoom, y: box.y + box.height / 2 - (y - st.centre.y) * st.zoom };
}

/** Pick a part from the library and click it onto the panel at a world point. */
async function place(page: Page, lib: string, x: number, y: number, rear = false) {
  await page.getByTestId(`lib-${lib}`).click();
  const s = await worldToScreen(page, x, y, rear);
  await page.mouse.click(s.x, s.y);
  await page.keyboard.press('Escape');
  const doc = await getDoc(page);
  return doc.parts.at(-1)!;
}

test('the PIK-20D example from scratch through the interface: template, parts, rear, wiring, tubing and looms', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');

  // A new project on the PIK-20D mock-up template.
  await runCommand(page, 'new project');
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByRole('radio', { name: /PIK-20D T-panel/ }).click();
  await dialog.getByTestId('new-name').fill('PIK-20D T-panel');
  await page.screenshot({ path: 'test-results/m7-new-project.png' });
  await dialog.getByTestId('new-create').click();
  await expect(page.locator('.doc-title')).toContainText('PIK-20D T-panel');
  const doc0 = await getDoc(page);
  expect(doc0.template).toEqual({ ref: { id: 'pik20d.t-panel-mockup', version: 1 } });
  await expect(page.locator('[data-part]')).toHaveCount(0);

  // Each instrument from the library, clicked onto the panel and its position typed in.
  const byId = new Map(fixture.parts.map((p) => [p.id, p]));
  const instruments: [string, string, string][] = [
    ['asi', 'generic.asi-80', 'ASI'],
    ['xctn', 'generic.flight-computer', 'XCTouchNav 5.7"'],
    ['xcv', 'generic.vario-electric-80', 'XCVario'],
    ['fdisp', 'generic.flarm-display', 'FLARM display'],
    ['compass', 'generic.round-57', 'Compass'],
    ['radio', 'generic.radio-57', 'Radio'],
    ['phone', 'generic.phone-mount-base', 'Phone mount'],
    ['alt', 'generic.altimeter-80', 'Altimeter'],
  ];
  const placed = new Map<string, string>();
  for (const [fid, lib, label] of instruments) {
    const want = byId.get(fid)!;
    const p = await place(page, lib, want.x, want.y);
    await page.getByTestId(`tree-${p.id}`).click();
    await setField(page, 'insp-x', String(want.x));
    await setField(page, 'insp-y', String(want.y));
    await setField(page, 'insp-label', label);
    placed.set(fid, p.id);
  }

  // Switch and fuses beside the altimeter on the stem, at typed positions.
  for (const [fid, lib] of [
    ['ms', 'generic.toggle-switch'],
    ['f1', 'generic.fuse-holder'],
    ['f2', 'generic.fuse-holder'],
    ['f3', 'generic.fuse-holder'],
    ['f4', 'generic.fuse-holder'],
  ] as const) {
    const want = byId.get(fid)!;
    const p = await place(page, lib, want.x, want.y);
    await page.getByTestId(`tree-${p.id}`).click();
    await setField(page, 'insp-x', String(want.x));
    await setField(page, 'insp-y', String(want.y));
    await setField(page, 'insp-label', want.label);
    if (want.params?.ratingA) await setField(page, 'param-ratingA', String(want.params.ratingA));
    placed.set(fid, p.id);
  }

  // Placeholder sizes from the mock-up, typed in the inspector.
  for (const fid of ['xctn', 'fdisp', 'phone']) {
    await page.getByTestId(`tree-${placed.get(fid)}`).click();
    for (const [k, v] of Object.entries(byId.get(fid)!.params ?? {})) await setField(page, `param-${k}`, String(v));
  }

  // Same front layout as the committed example, to 0.01 mm.
  const doc = await getDoc(page);
  for (const [fid, id] of placed) {
    const got = doc.parts.find((p) => p.id === id)!;
    const want = byId.get(fid)!;
    expect(got.part.id, fid).toBe(want.part.id);
    expect(got.x, fid).toBeCloseTo(want.x, 2);
    expect(got.y, fid).toBeCloseTo(want.y, 2);
    expect(got.label, fid).toBe(want.label);
    // A typed value equal to the part's default is not stored, so compare what was stored.
    for (const [k, v] of Object.entries(want.params ?? {})) expect(got.params?.[k] ?? v, `${fid}.${k}`).toBe(v);
  }
  // No errors: everything fits the panel, clear of the fold line and each other. Wiring and
  // tubing not yet started are one note each, not an error per pin.
  const checks = page.getByTestId('checks');
  await expect(checks.locator('.check.sev-error')).toHaveCount(0);
  await expect(checks.locator('[data-check="wiring:todo"]')).toContainText('Wiring not started: 4 parts');
  await expect(checks.locator('[data-check="tubing:todo"]')).toContainText('Tubing not started: 3 parts');
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/m7-front-from-scratch.png' });

  // ---- Behind the panel: the FLARM unit on the back of the XCTouchNav, and the tees.
  const flarm = await place(page, 'generic.flarm-unit', byId.get('xctn')!.x + 0.5, byId.get('xctn')!.y - 0.5);
  await page.getByTestId(`tree-${flarm.id}`).click();
  await setField(page, 'insp-label', 'FLARM unit');
  await page.getByTestId('insp-mount').selectOption(placed.get('xctn')!);
  await setField(page, 'insp-dz', String(byId.get('flarm')!.mountedTo!.dz));
  await setField(page, 'insp-dx', '0');
  await setField(page, 'insp-dy', '0');
  placed.set('flarm', flarm.id);
  for (const fid of ['tee1', 'tee2', 'tee3']) {
    const want = byId.get(fid)!;
    const p = await place(page, 'generic.tee', want.x, want.y);
    await page.getByTestId(`tree-${p.id}`).click();
    await setField(page, 'insp-label', want.label);
    placed.set(fid, p.id);
  }

  // ---- Off the panel, in the rear view: each placed where its wiring leaves the panel.
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  for (const want of fixture.parts.filter((p) => p.depthOffset === 130)) {
    const p = await place(page, want.part.id, want.x, want.y, true);
    expect(p.depthOffset, want.id).toBe(130);
    await page.getByTestId(`tree-${p.id}`).click();
    // Snapping may catch a nearby edge; the exit point is typed exactly.
    await setField(page, 'insp-x', String(want.x));
    await setField(page, 'insp-y', String(want.y));
    await setField(page, 'insp-label', want.label);
    placed.set(want.id, p.id);
  }
  await page.keyboard.press('Escape');

  // ---- Every wire and tube, pin to pin in the schematic, in the same order as the project.
  await page.getByRole('button', { name: 'Schematic', exact: true }).click();
  const schem = page.getByTestId('schematic');
  await schem.getByRole('button', { name: 'Fit' }).click();
  await page.keyboard.press('w');
  const id = (fid: string) => placed.get(fid)!;
  for (const w of fixture.wires) {
    // The layout grows as blocks gain wires; fit it to the view before each wire.
    await schem.getByRole('button', { name: 'Fit' }).click();
    await schem.getByTestId(`pin-${termKey(w.from, id)}`).locator('circle').click();
    await schem.getByTestId(`pin-${termKey(w.to, id)}`).locator('circle').click();
  }
  await expect.poll(async () => (await getDoc(page)).wires.length).toBe(fixture.wires.length);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/m7-schematic-from-scratch.png' });

  // ---- The two looms, drawn with the Route tool in the rear view; wires ticked onto each.
  // Nothing selected (selected wires would go onto a new route), and grid snap only.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Rear', exact: true }).click();
  await page.locator('.statusbar').getByRole('button', { name: 'objects' }).click();
  const built = await getDoc(page);
  for (const r of fixture.routes) {
    await page.keyboard.press('l');
    for (const pt of r.points) {
      const sp = await worldToScreen(page, pt.x, pt.y, true);
      await page.mouse.click(sp.x, sp.y);
    }
    await page.keyboard.press('Enter');
    await setField(page, 'insp-route-label', r.label);
    for (const [i, w] of fixture.wires.entries()) if (w.route === r.id) await page.getByTestId(`route-wire-${built.wires[i]!.id}`).check();
  }
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/m7-rear-from-scratch.png' });

  // The project made through the interface is the committed example.
  const fromId = new Map([...placed].map(([fid, nid]) => [nid, fid]));
  expect(normal(await getDoc(page), (x) => fromId.get(x) ?? x)).toEqual(normal(fixture));
  await expect(checks.locator('.check.sev-error')).toHaveCount(0);

  // The cut file carries the fold as a bend line on its own layer.
  await page.getByRole('menubar').getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Export…' }).click();
  const dxf = await download(page, () => page.getByTestId('export-cut-dxf').click());
  expect(dxf.bytes.toString('latin1')).toMatch(/\n\s*8\r?\nBEND_LINES\r?\n/);
  expect(errors).toEqual([]);
});

test('PIK-20D example: every output through the export dialog, and a share link', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('menubar').getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /Open PIK-20D example project/ }).click();
  await expect(page.locator('.doc-title')).toContainText('PIK-20D T-panel');
  const doc = await getDoc(page);
  expect(doc.parts).toHaveLength(fixture.parts.length);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/m7-pik20d-front.png' });
  // No errors in any check: front, rear, electrical or pneumatic.
  await expect(page.getByTestId('checks').locator('.check.sev-error')).toHaveCount(0);

  await page.keyboard.press('v');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/m7-pik20d-rear.png' });
  await page.getByRole('button', { name: 'Schematic', exact: true }).click();
  await expect(page.getByTestId('schematic').getByTestId('schem-bat')).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/m7-pik20d-schematic.png' });
  await page.getByRole('button', { name: 'Front', exact: true }).click();

  await page.keyboard.press('Control+e');
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog.getByTestId('export-errors')).toHaveCount(0);

  // Cut file: outline, cutouts, holes and the flange bend line, 1:1.
  const svg = await download(page, () => dialog.getByTestId('export-cut-svg').click());
  expect(svg.name).toBe('PIK-20D-T-panel-cut.svg');
  const svgText = svg.bytes.toString('utf8');
  expect(svgText).toContain('inkscape:label="BEND_LINES"');
  expect(svgText).toContain('inkscape:label="OUTLINE"');
  const dxf = await download(page, () => dialog.getByTestId('export-cut-dxf').click());
  expect(dxf.bytes.toString('latin1')).toMatch(/\n\s*8\r?\nBEND_LINES\r?\n/);
  const tpl = await download(page, () => dialog.getByTestId('export-template-pdf').click());
  expect(tpl.bytes.toString('latin1')).toContain('/PrintScaling /None');

  // Rear layout: one A3 page with the depth table.
  const rear = await download(page, () => dialog.getByTestId('export-rear-pdf').click());
  expect(rear.name).toBe('PIK-20D-T-panel-rear-A3.pdf');
  const rearText = rear.bytes.toString('latin1');
  expect(rearText).toContain('(Depth behind the panel)');
  expect(rearText).toContain('(FLARM unit)');
  expect(rearText).toContain('(45-75 mm)'.replace('-', '\x96'));
  writeFileSync('test-results/m7-rear.pdf', rear.bytes);
  const rearSvg = await download(page, () => dialog.getByTestId('export-rear-svg').click());
  expect(rearSvg.bytes.toString('utf8')).toContain('inkscape:label="Looms and exits"');

  // Wiring and pneumatic diagram.
  const wiring = await download(page, () => dialog.getByTestId('export-wiring-pdf').click());
  expect(wiring.name).toBe('PIK-20D-T-panel-wiring-A3.pdf');
  writeFileSync('test-results/m7-wiring.pdf', wiring.bytes);
  const wsvg = await download(page, () => dialog.getByTestId('export-wiring-svg').click());
  expect(wsvg.bytes.toString('utf8')).toContain('Pitot');

  // Wire list: one row per wire and tube.
  const wires = await download(page, () => dialog.getByTestId('export-wires-csv').click());
  const rows = wires.bytes.toString('utf8').replace(/^﻿/, '').trim().split('\r\n');
  expect(rows).toHaveLength(doc.wires.length + 1);
  const wpdf = await download(page, () => dialog.getByTestId('export-wires-pdf').click());
  writeFileSync('test-results/m7-wire-list.pdf', wpdf.bytes);
  const labels = await download(page, () => dialog.getByTestId('export-labels-pdf').click());
  expect(labels.bytes.toString('latin1')).toMatch(/\/Count \d+/);

  // Bill of materials.
  const bom = await download(page, () => dialog.getByTestId('export-bom-csv').click());
  const bomText = bom.bytes.toString('utf8');
  expect(bomText).toContain('Item,Quantity,Maker,Model');
  for (const name of ['XCVario', 'XCTouchNav 5.7"', 'FLARM display', 'Compass', 'Altimeter']) expect(bomText).toContain(name.replace('"', '""'));
  await page.keyboard.press('Escape');

  // Share by link into a fresh browser: the same project.
  await runCommand(page, 'share link');
  const url = await page.getByTestId('share-url').inputValue();
  expect(url).toMatch(/#p=1\./);
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto(url);
  await expect(page2.getByText(/Opened the shared design “PIK-20D T-panel”/)).toBeVisible();
  expect(await getDoc(page2)).toEqual(await getDoc(page));
  await other.close();
  expect(errors).toEqual([]);
});

test.describe('first run', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('welcome and the three-step first-panel walkthrough', async ({ page }) => {
    await page.goto('/');
    const welcome = page.getByRole('dialog', { name: 'Welcome' });
    await expect(welcome).toBeVisible();
    await page.screenshot({ path: 'test-results/m7-welcome.png' });
    await welcome.getByTestId('welcome-walkthrough').click();
    const walk = page.getByTestId('walkthrough');
    await expect(walk).toContainText('step 1 of 3');

    // 1. Pick a template.
    await walk.getByRole('button', { name: 'Choose a template…' }).click();
    await page.getByRole('dialog', { name: 'New project' }).getByRole('radio', { name: /PIK-20D T-panel/ }).click();
    await page.getByTestId('new-create').click();
    await expect(walk).toContainText('step 2 of 3');
    await page.screenshot({ path: 'test-results/m7-walkthrough.png' });

    // 2. Place an instrument.
    await place(page, 'generic.asi-80', -102, 277);
    await expect(walk).toContainText('step 3 of 3');

    // 3. Export.
    await walk.getByRole('button', { name: 'Export…' }).click();
    await download(page, () => page.getByTestId('export-cut-svg').click());
    await expect(walk).toContainText('done');
    await page.keyboard.press('Escape');

    // The welcome is not shown again.
    await page.reload();
    await expect(page.getByTestId('canvas')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Welcome' })).toHaveCount(0);
  });

  test('theme follows the system until chosen, and the choice is kept', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.getByRole('dialog', { name: 'Welcome' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await runCommand(page, 'open PIK-20D');
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'test-results/m7-dark-front.png' });
    await page.keyboard.press('v');
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'test-results/m7-dark-rear.png' });
    await page.getByRole('button', { name: 'Schematic', exact: true }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'test-results/m7-dark-schematic.png' });
    await page.getByRole('button', { name: 'Template', exact: true }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'test-results/m7-dark-template.png' });
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'test-results/m7-dark-review.png' });
    await page.getByRole('button', { name: 'Front', exact: true }).click();

    // The system turns light: "system" follows it.
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // An explicit choice sticks, through a reload and whatever the system says.
    await page.keyboard.press('Shift+T');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await runCommand(page, 'theme follow system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

test('shortcut map: grouped, searchable, and every key can be changed', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('?');
  const map = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(map).toBeVisible();
  await expect(map.locator('h3')).toContainText(['Mouse', 'File', 'Edit', 'Tools']);
  await page.screenshot({ path: 'test-results/m7-shortcuts.png' });
  await map.getByTestId('shortcut-search').fill('zoom to fit');
  await expect(map.getByTestId('key-view.fit')).toHaveText('F');

  // A key already in use is refused; a free one is taken and works at once.
  await map.getByTestId('key-view.fit').click();
  await page.keyboard.press('s');
  await expect(map).toContainText('S is already used by “Select tool”');
  await page.keyboard.press('j');
  await expect(map.getByTestId('key-view.fit')).toHaveText('J');
  await page.keyboard.press('Escape');
  await expect(map).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Gpd).gpd.ui.state.zoom);
  await page.evaluate(() => {
    const g = (window as unknown as { gpd: { ui: { set: (p: unknown) => void } } }).gpd;
    g.ui.set({ zoom: 20 });
  });
  await page.keyboard.press('j');
  await expect.poll(() => page.evaluate(() => (window as unknown as Gpd).gpd.ui.state.zoom)).not.toBe(20);
  await page.getByRole('menubar').getByRole('button', { name: 'View' }).click();
  await expect(page.getByRole('menuitem', { name: /Zoom to fit/ })).toContainText('J');
  await page.keyboard.press('Escape');

  // Kept in this browser; Reset all brings the defaults back.
  await page.reload();
  expect(await page.evaluate(() => (window as unknown as Gpd).gpd.prefs.state.keymap)).toEqual({ 'view.fit': 'J' });
  await page.keyboard.press('?');
  await page.getByRole('button', { name: 'Reset all' }).click();
  await expect(page.getByTestId('key-view.fit')).toHaveText('F');
});

test('crash recovery: a crash keeps the work; edits survive a quick reload; earlier work can be recovered', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'open sample project');
  await page.getByTestId('tree-p1').click();
  await setField(page, 'insp-x', '-91.5');

  // A crash in the canvas: the rest of the app keeps working, and the work is untouched.
  await page.evaluate(() => (window as unknown as Gpd).gpd.crash('centre'));
  const crash = page.getByTestId('crash-centre');
  await expect(crash).toBeVisible();
  await expect(page.getByTestId('inspector')).toBeVisible();
  await page.screenshot({ path: 'test-results/m7-crash.png' });
  await crash.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect((await getDoc(page)).parts.find((p) => p.id === 'p1')!.x).toBe(-91.5);

  // An edit right before closing the tab is saved on the way out, not lost to the autosave delay.
  await setField(page, 'insp-x', '-92.5');
  await page.reload();
  await expect.poll(async () => (await getDoc(page)).parts.find((p) => p.id === 'p1')?.x).toBe(-92.5);

  // Opening another project keeps a snapshot of this one; Recover earlier work brings it back.
  await runCommand(page, 'open PIK-20D');
  await expect(page.locator('.doc-title')).toContainText('PIK-20D T-panel');
  await page.getByRole('menubar').getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Recover earlier work…' }).click();
  const list = page.getByTestId('snapshots');
  const before = list.locator('li', { hasText: 'Before opening the PIK-20D example' });
  await expect(before).toContainText('Sample panel');
  await page.screenshot({ path: 'test-results/m7-recover.png' });
  await before.getByRole('button', { name: 'Open' }).click();
  await expect.poll(async () => (await getDoc(page)).name).toBe('Sample panel');
  expect((await getDoc(page)).parts.find((p) => p.id === 'p1')!.x).toBe(-92.5);
});

test('an autosave that no longer opens is kept and can be downloaded', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  // Damage the stored working copy, as a bad write or a newer version might.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('glider-panel-designer', 2);
        req.onsuccess = () => {
          const tx = req.result.transaction('autosave', 'readwrite');
          tx.objectStore('autosave').put({ savedAt: new Date().toISOString(), project: { schemaVersion: 1, name: 'Damaged panel', parts: 'not a list' } }, 'current');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await expect(page.getByText(/Your last autosave could not be opened/)).toBeVisible();
  await runCommand(page, 'recover earlier work');
  const entry = page.getByTestId('snapshots').locator('li', { hasText: 'Damaged panel' });
  await expect(entry).toContainText('could not be opened');
  const file = await download(page, () => entry.getByRole('button', { name: 'Download' }).click());
  expect(JSON.parse(file.bytes.toString('utf8')).name).toBe('Damaged panel');
});

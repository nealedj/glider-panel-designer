/**
 * M3: every export downloads and holds what it should; open errors block fabrication
 * exports until overridden, and the override is stamped; a design round-trips through a
 * share link and through a dropped project file; an oversize link falls back to a file;
 * text labels and dimensions are placed, follow parts and reach the cut file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

type Doc = {
  name: string;
  parts: { id: string; x: number; y: number; label: string }[];
  texts: { id: string; text: string; x: number; y: number; layer: string }[];
  dimensions: { id: string; a: unknown; b: unknown; kind: string }[];
  template: unknown;
};
type Gpd = { gpd: { docs: { doc: Doc; dispatch: (label: string, ops: unknown[]) => boolean }; ui: { state: { selection: string[]; message: string } } } };

const getDoc = (page: Page) => page.evaluate(() => (window as unknown as Gpd).gpd.docs.doc);

async function runCommand(page: Page, name: string) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
}

async function setField(page: Page, testId: string, value: string) {
  const f = page.getByTestId(testId);
  await f.fill(value);
  await f.press('Enter');
  await f.press('Escape');
}

async function download(page: Page, click: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: readFileSync(path) };
}

/** Screen position of a world point, using the canvas's own transform. */
async function worldToScreen(page: Page, x: number, y: number) {
  const box = (await page.locator('svg.canvas').boundingBox())!;
  const st = await page.evaluate(() => (window as unknown as { gpd: { ui: { state: { zoom: number; centre: { x: number; y: number } } } } }).gpd.ui.state);
  return { x: box.x + box.width / 2 + (x - st.centre.x) * st.zoom, y: box.y + box.height / 2 - (y - st.centre.y) * st.zoom };
}

test('every export downloads with the right content', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await runCommand(page, 'open sample project');
  await page.keyboard.press('Control+e');
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('export-errors')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/m3-export-dialog.png' });

  const svg = await download(page, () => dialog.getByTestId('export-cut-svg').click());
  expect(svg.name).toBe('Sample-panel-cut.svg');
  const svgText = svg.bytes.toString('utf8');
  expect(svgText).toMatch(/width="[\d.]+mm"/);
  expect(svgText).toContain('inkscape:label="CUTOUTS"');
  // The 80 mm instruments: radius 40 at (−95, 40) and (95, 40); SVG y is negated.
  expect(svgText).toContain('<circle cx="-95" cy="-40" r="40"');
  expect(svgText).toContain('PLANNING AID - VERIFY BEFORE CUTTING');

  const dxf = await download(page, () => dialog.getByTestId('export-cut-dxf').click());
  expect(dxf.name).toBe('Sample-panel-cut.dxf');
  expect(dxf.bytes.toString('latin1')).toContain('AC1009');

  const pdf = await download(page, () => dialog.getByTestId('export-template-pdf').click());
  expect(pdf.name).toBe('Sample-panel-template-A4.pdf');
  expect(pdf.bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
  expect(pdf.bytes.toString('latin1')).toContain('/PrintScaling /None');

  const png = await download(page, () => dialog.getByTestId('export-render-png').click());
  expect(png.name).toBe('Sample-panel-front.png');
  expect(png.bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  const width = png.bytes.readUInt32BE(16);
  const height = png.bytes.readUInt32BE(20);
  expect(Math.max(width, height)).toBe(2400);
  writeFileSync('test-results/m3-front-render.png', png.bytes);

  const rpdf = await download(page, () => dialog.getByTestId('export-render-pdf').click());
  expect(rpdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

  const bom = await download(page, () => dialog.getByTestId('export-bom-csv').click());
  const bomText = bom.bytes.toString('utf8').replace(/^﻿/, '');
  expect(bomText.split('\r\n')[0]).toContain('Item,Quantity,Maker,Model');
  expect(bomText).toContain('ASI; Altimeter');

  const json = await download(page, () => dialog.getByTestId('export-project-json').click());
  expect(json.name).toBe('Sample-panel.panel.json');
  const saved = JSON.parse(json.bytes.toString('utf8'));
  const doc = await getDoc(page);
  expect({ ...saved, modified: '' }).toEqual({ ...doc, modified: '' });
  expect(errors).toEqual([]);
});

test('open errors block cut exports until overridden, and the override is stamped', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'open sample project');
  // Move the vario onto the ASI: overlapping cutouts are an error.
  await page.getByTestId('tree-p2').click();
  await setField(page, 'insp-x', '-80');
  await expect(page.locator('[data-check^="overlap:"]').first()).toBeVisible();

  // The palette command routes to the dialog instead of exporting.
  await runCommand(page, 'export cut file svg');
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('export-errors')).toContainText('error');
  await expect(dialog.getByTestId('export-cut-svg')).toBeDisabled();
  await expect(dialog.getByTestId('export-template-pdf')).toBeDisabled();
  // Non-fabrication exports stay available.
  await expect(dialog.getByTestId('export-render-png')).toBeEnabled();
  await page.screenshot({ path: 'test-results/m3-export-blocked.png' });

  await dialog.getByTestId('export-override').check();
  const svg = await download(page, () => dialog.getByTestId('export-cut-svg').click());
  expect(svg.bytes.toString('utf8')).toContain('ERRORS OVERRIDDEN AT EXPORT');
  const pdf = await download(page, () => dialog.getByTestId('export-template-pdf').click());
  const pdfText = pdf.bytes.toString('latin1');
  expect(pdfText).toContain('ERRORS OVERRIDDEN AT EXPORT');
  expect(pdfText).toContain('EXPORTED WITH ERRORS OVERRIDDEN');

  // Reopening starts with the override off again.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('export-override')).not.toBeChecked();
});

test('a design round-trips through a share link into a fresh browser', async ({ page, browser }) => {
  await page.goto('/');
  await runCommand(page, 'open sample project');
  await page.getByTestId('tree-p1').click();
  await setField(page, 'insp-x', '-97.25');
  await runCommand(page, 'share link');
  const dialog = page.getByTestId('share-dialog');
  const url = await dialog.getByTestId('share-url').inputValue();
  expect(url).toMatch(/#p=1\.[A-Za-z0-9_-]+$/);
  expect(url.length).toBeLessThan(8000);
  await expect(dialog.getByTestId('share-length')).toContainText('characters');
  await page.screenshot({ path: 'test-results/m3-share.png' });
  const sent = await getDoc(page);

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto(url);
  await expect(page2.getByText(/Opened the shared design “Sample panel” as your own copy/)).toBeVisible();
  expect(await getDoc(page2)).toEqual(sent);
  // The link leaves the address bar, so a reload does not reopen it over later edits.
  expect(new URL(page2.url()).hash).toBe('');
  await other.close();
});

test('opening a link keeps the work it replaces, and that work can be restored', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'open sample project');
  await runCommand(page, 'share link');
  const url = await page.getByTestId('share-url').inputValue();
  await page.keyboard.press('Escape');
  // Own work that differs from the shared design.
  await runCommand(page, 'new project');
  await page.getByTestId('new-create').click();
  await page.waitForTimeout(900); // autosave
  await page.goto(url);
  await expect(page.getByText(/Your previous work is kept/)).toBeVisible();
  expect((await getDoc(page)).name).toBe('Sample panel');
  await runCommand(page, 'restore work from before');
  await expect.poll(async () => (await getDoc(page)).name).toBe('Untitled panel');
});

test('an oversize link falls back to a project file', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'open sample project');
  // A finely traced custom template, embedded whole, makes the link too long.
  await page.evaluate(() => {
    const g = (window as unknown as Gpd).gpd;
    const points = Array.from({ length: 1500 }, (_, i) => {
      const a = (i / 1500) * 2 * Math.PI;
      return { x: Math.round((150 * Math.cos(a) + Math.sin(i * 12.9898) * 0.4) * 1000) / 1000, y: Math.round((100 * Math.sin(a) + Math.cos(i * 78.233) * 0.4) * 1000) / 1000 };
    });
    const embedded = {
      id: 'traced.test',
      version: 1,
      name: 'Traced panel',
      outline: { kind: 'poly', closed: true, points },
      bendLines: [],
      thickness: 2,
      material: 'Glass fibre (GRP)',
      keepOuts: [],
      canopyClearance: null,
      availableDepth: { default: 180, regions: [] },
      fixings: [],
      gliderTypes: [],
      provenance: { inputType: 'tracing', source: 'test', accuracyMm: 1 },
      status: 'draft',
    };
    g.docs.dispatch('Trace template', [{ op: 'set', key: 'template', value: { embedded } }]);
  });
  await runCommand(page, 'share link');
  const dialog = page.getByTestId('share-dialog');
  await expect(dialog.getByTestId('share-too-long')).toContainText('Send a project file instead');
  await expect(dialog.getByTestId('share-url')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/m3-share-too-long.png' });
  const file = await download(page, () => dialog.getByTestId('share-save-file').click());
  expect(file.name).toBe('Sample-panel.panel.json');
  expect(JSON.parse(file.bytes.toString('utf8')).template.embedded.outline.points).toHaveLength(1500);
});

test('a dropped project file opens', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'new project');
  await page.getByTestId('new-create').click();
  const json = readFileSync(new URL('../../fixtures/projects/export-golden.json', import.meta.url), 'utf8');
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'golden.panel.json', { type: 'application/json' }));
    document.querySelector('.app')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, json);
  await expect.poll(async () => (await getDoc(page)).name).toBe('Export golden panel');
  await expect(page.getByText('Opened golden.panel.json')).toBeVisible();
});

test('text labels and dimensions: placed, follow parts, and reach the cut file', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'open sample project');
  await page.keyboard.press('f');

  // Text: T, click, type.
  await page.keyboard.press('t');
  const at = await worldToScreen(page, -40, -89); // snaps to the 5 mm grid
  await page.mouse.click(at.x, at.y);
  const textField = page.getByTestId('insp-text');
  await expect(textField).toBeFocused();
  await textField.fill('MASTER');
  await textField.press('Enter');
  let doc = await getDoc(page);
  expect(doc.texts).toHaveLength(1);
  expect(doc.texts[0]).toMatchObject({ text: 'MASTER', x: -40, y: -90, layer: 'engrave' });

  // Dimension: D, click the ASI centre then the altimeter centre (both snap).
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  for (const x of [-95, 95]) {
    const p = await worldToScreen(page, x + 0.3, 40.2);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
  }
  doc = await getDoc(page);
  expect(doc.dimensions).toHaveLength(1);
  expect(doc.dimensions[0]).toMatchObject({ a: { part: 'p1' }, b: { part: 'p3' }, kind: 'horizontal' });
  await expect(page.getByTestId('insp-dim-value')).toHaveText('190.00 mm');
  await page.screenshot({ path: 'test-results/m3-annotations.png' });

  // Move the altimeter: the dimension follows.
  await page.keyboard.press('Escape');
  await page.getByTestId('tree-p3').click();
  await setField(page, 'insp-x', '100');
  await page.getByTestId(`tree-${doc.dimensions[0]!.id}`).click();
  await expect(page.getByTestId('insp-dim-value')).toHaveText('195.00 mm');

  // Both reach the cut file, on their own layers.
  await page.keyboard.press('Control+e');
  const svg = await download(page, () => page.getByTestId('export-cut-svg').click());
  const text = svg.bytes.toString('utf8');
  expect(text).toMatch(/inkscape:label="ENGRAVING">\n<text[^>]*>MASTER<\/text>/);
  expect(text).toMatch(/inkscape:label="DIMENSIONS_REFERENCE">[\s\S]*195.0 mm/);

  // Deleting a part removes the dimensions attached to it, and undo brings both back.
  await page.keyboard.press('Escape');
  await page.getByTestId('tree-p3').click();
  await page.keyboard.press('Delete');
  expect((await getDoc(page)).dimensions).toHaveLength(0);
  await page.keyboard.press('Control+z');
  expect((await getDoc(page)).dimensions).toHaveLength(1);
});

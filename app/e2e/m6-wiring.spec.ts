/**
 * M6: wiring and pneumatics. On the sample panel (battery, main fuse, master switch, fuses,
 * instruments, FLARM–vario–flight computer data links, radio, and pitot, static and TE through
 * tees): wire with the wire tool in the schematic and in the rear view, draw a route and put
 * wires on it, see the checks react, and export the wire list, labels and diagram.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

type V3 = { x: number; y: number; z: number };
type G = {
  gpd: {
    docs: { doc: { wires: { id: string; label: string; colour: string; route: string | null; from: { part: string; connector?: string; pin?: string }; to: { part: string; connector?: string; pin?: string } }[]; routes: { id: string }[]; parts: { id: string; schematic?: unknown }[] } };
    ui: { state: { zoom: number; centre: { x: number; y: number }; selection: string[]; view: string } };
    analyse: (d: unknown) => { terms: Map<string, { pos: V3 }>; wires: Map<string, { length: { mm: number; estimated: boolean } | null }> };
  };
};
const doc = (page: Page) => page.evaluate(() => (window as unknown as G).gpd.docs.doc);

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
const termPos = (page: Page, key: string) =>
  page.evaluate((k) => {
    const g = (window as unknown as G).gpd;
    return g.analyse(g.docs.doc).terms.get(k)!.pos;
  }, key);

test('wire in the schematic: a deleted feed shows up in the checks, and is put back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await runCommand(page, 'open wiring sample');
  await page.getByRole('button', { name: 'Schematic', exact: true }).click();
  const schem = page.getByTestId('schematic');
  await expect(schem.getByTestId('schem-bat')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/m6-schematic.png' });
  // The sample is clean: no electrical or pneumatic errors or warnings.
  await expect(page.locator('[data-check^="nofuse:"], [data-check^="unpowered:"], [data-check^="drop:"], [data-check^="port:"]')).toHaveCount(0);

  // Select the vario's feed wire (F1 → vario) and delete it.
  const feed = (await doc(page)).wires.find((w) => w.from.part === 'f1' && w.to.part === 'vario')!;
  // Click a point on the wire itself, near its start.
  const at = await page.evaluate((id) => {
    const path = document.querySelector(`[data-wire="${id}"] .line`) as SVGPathElement;
    const p = path.getPointAtLength(Math.min(6, path.getTotalLength() / 4));
    const r = path.ownerSVGElement!.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, feed.id);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('inspector')).toContainText('F1 Vario T LOAD');
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-check="unpowered:vario/PWR/+"]')).toBeVisible();

  // Wire it again: W, then the fuse's LOAD pin, then the vario's + pin.
  await page.keyboard.press('w');
  await schem.getByTestId('pin-f1/T/LOAD').locator('circle').click();
  await schem.getByTestId('pin-vario/PWR/+').locator('circle').click();
  await expect(page.locator('[data-check="unpowered:vario/PWR/+"]')).toHaveCount(0);
  const again = (await doc(page)).wires.find((w) => w.from.part === 'f1' && w.to.part === 'vario')!;
  expect(again.colour).toBe('red');
  await expect(page.getByTestId('insp-wire-facts')).toContainText('0.15 A');
  await expect(page.getByTestId('insp-wire-size')).toContainText('Automatic: 0.38 mm² (AWG 22)');

  // A wrong connection is caught: the radio's speaker output to the vario's data input.
  await schem.getByTestId('pin-radio/AUD/SPK+').locator('circle').click();
  await schem.getByTestId('pin-vario/DATA/RX').locator('circle').click();
  await expect(page.locator('[data-check^="mix:"]').first()).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-check^="mix:"]')).toHaveCount(0);

  // Filters hide tubes; dragging a block keeps it where it is put; reset lays out again.
  const tubes = schem.locator('.schem-wire.net-static');
  expect(await tubes.count()).toBeGreaterThan(0);
  await page.getByTestId('schem-filter-pneumatic').uncheck();
  await expect(tubes).toHaveCount(0);
  await page.getByTestId('schem-filter-pneumatic').check();
  await page.keyboard.press('Escape');
  const block = schem.getByTestId('schem-spk').locator('rect').first();
  const b = (await block.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + 128, { steps: 5 });
  await page.mouse.up();
  expect((await doc(page)).parts.find((p) => p.id === 'spk')!.schematic).toBeTruthy();
  await runCommand(page, 'reset schematic layout');
  expect((await doc(page)).parts.find((p) => p.id === 'spk')!.schematic).toBeUndefined();
  expect(errors).toEqual([]);
});

test('wire and route in the rear view; the route sets the length', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'open wiring sample');
  await page.getByRole('button', { name: 'Rear', exact: true }).click();
  await page.keyboard.press('f');
  // A new data link: the flight computer's DATA TX to the vario's DATA RX (a second listener).
  await page.keyboard.press('w');
  for (const k of ['fc/DATA/TX', 'vario/DATA/RX']) await page.locator(`[data-terminal="${k}"]`).click();
  let d = await doc(page);
  const link = d.wires.find((w) => w.from.part === 'fc' && w.to.part === 'vario')!;
  expect(link).toMatchObject({ from: { connector: 'DATA', pin: 'TX' }, to: { connector: 'DATA', pin: 'RX' } });
  // Two outputs (FLARM TX and FC TX) now drive the vario's RX: an error.
  await expect(page.locator('[data-check^="txtx:"]').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/m6-rear.png' });

  // Draw a route behind the panel, 140 mm back, and put the new wire on it.
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  const pts = [
    { x: 40, y: -20 },
    { x: 40, y: 20 },
    { x: 0, y: 20 },
  ];
  await page.evaluate(() => (window as unknown as { gpd: { ui: { set: (p: object) => void } } }).gpd.ui.set({ routeDepth: 140 }));
  for (const p of pts) {
    const s = await rearScreen(page, p);
    await page.mouse.click(s.x, s.y);
  }
  await page.keyboard.press('Enter');
  d = await doc(page);
  const route = d.routes.at(-1)!;
  await page.keyboard.press('Escape');
  await page.evaluate((id) => (window as unknown as { gpd: { ui: { set: (p: object) => void } } }).gpd.ui.set({ selection: [id] }), link.id);
  await page.getByTestId('insp-wire-route').selectOption(route.id);
  d = await doc(page);
  expect(d.wires.find((w) => w.id === link.id)!.route).toBe(route.id);
  // By hand: each end goes straight to the nearest route point; along the route between them.
  const a = await termPos(page, 'fc/DATA/TX');
  const b = await termPos(page, 'vario/DATA/RX');
  const R = pts.map((p) => ({ ...p, z: 140 }));
  const near = (p: V3) => {
    let best = { s: 0, d: Infinity };
    let s0 = 0;
    for (let i = 1; i < R.length; i++) {
      const [p0, p1] = [R[i - 1]!, R[i]!];
      const L = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const t = Math.max(0, Math.min(1, ((p.x - p0.x) * (p1.x - p0.x) + (p.y - p0.y) * (p1.y - p0.y)) / (L * L)));
      const q = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, z: 140 };
      const dd = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      if (dd < best.d) best = { s: s0 + L * t, d: dd };
      s0 += L;
    }
    return best;
  };
  const na = near(a);
  const nb = near(b);
  const byHand = na.d + Math.abs(nb.s - na.s) + nb.d + 2 * 50;
  const computed = await page.evaluate((id) => {
    const g = (window as unknown as G).gpd;
    return g.analyse(g.docs.doc).wires.get(id)!.length!;
  }, link.id);
  expect(computed.estimated).toBe(false);
  // Route clicks snap to the 5 mm grid; the hand figure uses the same points.
  expect(Math.abs(computed.mm - byHand)).toBeLessThan(5);
  await expect(page.getByTestId('insp-wire-facts')).toContainText(`${Math.round(computed.mm)} mm`);
  await page.screenshot({ path: 'test-results/m6-route.png' });
});

test('wiring exports: wire list, labels and diagram', async ({ page }) => {
  await page.goto('/');
  await runCommand(page, 'open wiring sample');
  await page.keyboard.press('Control+e');
  const dl = async (kind: string) => {
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`export-${kind}`).click()]);
    return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
  };
  const csv = await dl('wires-csv');
  expect(csv.name).toBe('Wiring-sample-panel-wire-list.csv');
  expect(csv.bytes.toString('utf8')).toContain('W002,PWR 2,power,F0 Main,T,LOAD,Master,T,1');
  const labels = await dl('labels-pdf');
  expect(labels.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const svg = await dl('wiring-svg');
  expect(svg.bytes.toString('utf8')).toContain('>Battery<');
  const pdf = await dl('wiring-pdf');
  expect(pdf.name).toBe('Wiring-sample-panel-wiring-A3.pdf');
  const list = await dl('wires-pdf');
  expect(list.bytes.toString('latin1')).toContain('(W001)');
});

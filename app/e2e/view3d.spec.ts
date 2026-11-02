/**
 * The 3D view: it opens on the PIK-20D example, draws the panel, bodies, wires and looms,
 * turns to the front and rear, selects a part by clicking it in step with the inspector,
 * and follows an edit made in the inspector.
 */
import { expect, test, type Page } from '@playwright/test';

type Part = { id: string; x: number; y: number; label: string; mountedTo: unknown };
type Gpd = {
  gpd: {
    docs: { doc: { parts: Part[]; wires: unknown[] } };
    ui: { state: { selection: string[]; view: string } };
    view3d?: { project: (x: number, y: number, z: number) => { x: number; y: number }; counts: () => { solids: number; wires: number; looms: number }; labels: () => number };
  };
};

async function runCommand(page: Page, name: string) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
}

/** How many distinct colours the WebGL canvas shows on a coarse grid: the background alone is one. */
function colours(page: Page) {
  return page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>('[data-testid="view3d-canvas"]')!;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(gl, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    const seen = new Set<string>();
    for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]! >> 4},${d[i + 1]! >> 4},${d[i + 2]! >> 4}`);
    return seen.size;
  });
}

test('3D view: draws the PIK-20D example, turns, and selects in step with the inspector', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await runCommand(page, 'open PIK-20D example');
  await expect.poll(() => page.evaluate(() => (window as unknown as Gpd).gpd.docs.doc.parts.length)).toBeGreaterThan(10);

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('view3d-canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as Gpd).gpd.view3d?.counts())).toMatchObject({ looms: 2 });
  const counts = (await page.evaluate(() => (window as unknown as Gpd).gpd.view3d!.counts()))!;
  const doc = await page.evaluate(() => (window as unknown as Gpd).gpd.docs.doc);
  expect(counts.wires).toBe(doc.wires.length);
  expect(counts.solids).toBeGreaterThan(doc.parts.length);
  await expect.poll(() => colours(page)).toBeGreaterThan(8);
  // Faces with room for it carry the part's label.
  expect(await page.evaluate(() => (window as unknown as Gpd).gpd.view3d!.labels())).toBeGreaterThan(5);
  await expect(page.getByTestId('view3d-notes')).toContainText('not to scale for cutting');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/3d-iso.png' });

  // From the front, the ASI's bezel is where the front view puts it; clicking it selects it.
  await page.keyboard.press('1');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/3d-front.png' });
  const asi = doc.parts.find((p) => /ASI/i.test(p.label) && !p.mountedTo)!;
  const at = await page.evaluate(([x, y]) => (window as unknown as Gpd).gpd.view3d!.project(x!, y!, -20), [asi.x, asi.y]);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as Gpd).gpd.ui.state.selection)).toEqual([asi.id]);
  await expect(page.getByTestId('insp-label')).toHaveValue(asi.label);

  // An inspector edit shows at once: move the ASI 30 mm and pick it again at its new place.
  const f = page.getByTestId('insp-x');
  await f.fill(String(asi.x + 30));
  await f.press('Enter');
  await f.press('Escape');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as unknown as Gpd).gpd.ui.state.selection)).toEqual([]);
  const moved = await page.evaluate(([x, y]) => (window as unknown as Gpd).gpd.view3d!.project(x!, y!, -20), [asi.x + 30, asi.y]);
  await page.waitForTimeout(100);
  await page.mouse.click(moved.x, moved.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as Gpd).gpd.ui.state.selection)).toEqual([asi.id]);

  // From behind, with the panel see-through, the stacked bodies and looms show.
  await page.keyboard.press('2');
  await page.getByTestId('view3d-see-through').check();
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/3d-rear.png' });
  // The move made the ASI clash with the bodies beside it, and they show red; undo works here too.
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(([id]) => (window as unknown as Gpd).gpd.docs.doc.parts.find((p) => p.id === id)!.x, [asi.id])).toBe(asi.x);

  await page.keyboard.press('3');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/3d-iso-see-through.png' });

  // Dark theme follows.
  await page.keyboard.press('Shift+T');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/3d-dark.png' });

  // Back to 2D and again to 3D: the view loads again cleanly.
  await page.locator('.view-tab', { hasText: 'Front' }).click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect.poll(() => colours(page)).toBeGreaterThan(8);
  expect(errors).toEqual([]);
});

test('3D view: a remote box mounted on top of the radio is drawn as fitted', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await runCommand(page, 'new project');
  await page.getByTestId('new-create').click();
  await page.keyboard.press('f');
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const placeAt = async (partId: string, fx: number, fy: number) => {
    await page.getByTestId(`lib-${partId}`).click();
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.keyboard.press('Escape');
    return (await page.evaluate(() => (window as unknown as Gpd).gpd.docs.doc.parts.at(-1)!.id))!;
  };
  const radio = await placeAt('generic.radio-57', 0.5, 0.55);
  await placeAt('lx-navigation.flarm-red-box', 0.5, 0.3);

  // Mounted to the radio, lying flat: 53 mm runs rearward, so the panel sees 84 × 30.
  await page.getByTestId('insp-mount').selectOption(radio);
  await page.getByTestId('insp-box-depth').selectOption('1');
  const dz = page.getByTestId('insp-dz');
  await dz.fill('0');
  await dz.press('Enter');
  await expect(page.getByTestId('insp-band')).toHaveText('0 to 53 mm behind panel');
  await expect(page.getByTestId('inspector')).toContainText('84 × 30 mm');

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('view3d-canvas')).toBeVisible();
  // Panel, radio bezel and body, and the box body.
  await expect.poll(() => page.evaluate(() => (window as unknown as Gpd).gpd.view3d?.counts().solids)).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId('view3d-notes')).not.toContainText('off-panel');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/3d-remote-box.png' });
  expect(errors).toEqual([]);
});

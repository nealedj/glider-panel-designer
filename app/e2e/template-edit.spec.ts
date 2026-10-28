/**
 * Editing existing templates: a shipped template is edited as your own copy (the shipped one
 * is unchanged), keeps its provenance and accuracy, and can be used in the project; your own
 * template is then edited in place. Also from the project inspector.
 */
import { expect, test, type Page } from '@playwright/test';

type V = { x: number; y: number };
type Tpl = { id: string; version: number; name: string; thickness: number; fixings: (V & { d: number })[]; bendLines: unknown[]; provenance: { accuracyMm: number | null; method?: string; inputType: string } };
type Gpd = {
  gpd: {
    tplUi: { state: { mode: string; step: string; planeView: { zoom: number; centre: V }; busy: string } };
    drafts: { draft: { name: string; outline: V[]; fixings: unknown[] } | null };
    docs: { doc: { template: { ref?: { id: string }; embedded?: Tpl } } };
  };
};
const g = (page: Page) => page.evaluate(() => {
  const x = (window as unknown as Gpd).gpd;
  return { draft: x.drafts.draft, ui: x.tplUi.state, template: x.docs.doc.template };
});

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

async function clickMm(page: Page, p: V) {
  const box = (await page.getByTestId('tpl-canvas').boundingBox())!;
  const v = (await g(page)).ui.planeView;
  await page.mouse.click(box.x + box.width / 2 + (p.x - v.centre.x) * v.zoom, box.y + box.height / 2 - (p.y - v.centre.y) * v.zoom);
}

test('edit a shipped template as a copy, use it, then edit your copy in place', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await runCommand(page, 'open PIK-20D');
  await expect(page.locator('.doc-title')).toContainText('PIK-20D T-panel');

  // From the project inspector: the project uses the shipped template, so this edits a copy.
  await page.getByTestId('edit-template').click();
  await page.waitForFunction(() => !(window as unknown as Gpd).gpd.tplUi.state.busy && !!(window as unknown as Gpd).gpd.drafts.draft);
  let s = await g(page);
  expect(s.draft!.name).toBe('PIK-20D T-panel (cardboard mock-up) (my copy)');
  expect(s.ui.mode).toBe('plane');
  expect(s.ui.step).toBe('features');
  expect(s.draft!.outline.length).toBeGreaterThan(10);
  await expect(page.getByTestId('tpl-message')).toContainText('the shipped template stays as it is');

  // Add two fixing holes at the foot of the stem, and set the real thickness.
  await page.getByTestId('tpl-tool-fixing').click();
  await clickMm(page, { x: -45, y: 20 });
  await clickMm(page, { x: 45, y: 20 });
  await expect.poll(async () => (await g(page)).draft!.fixings.length).toBe(2);
  await setField(page, 'tpl-thickness', '2.5');
  await page.screenshot({ path: 'test-results/template-edit.png' });

  // The accuracy carries over from the original calibration.
  await page.getByTestId('tpl-step-accuracy').click();
  await expect(page.getByTestId('tpl-accuracy')).toContainText('1.5');

  await page.getByTestId('tpl-step-save').click();
  await page.getByTestId('tpl-use').click();
  await expect.poll(async () => (await g(page)).template.embedded?.thickness).toBe(2.5);
  const t = (await g(page)).template.embedded!;
  expect(t.id).toBe('local.pik-20d-t-panel-cardboard-mock-up-my-copy');
  expect(t.thickness).toBe(2.5);
  expect(t.fixings).toHaveLength(2);
  expect(t).not.toHaveProperty('reservedAreas');
  expect(t.bendLines).toHaveLength(1);
  expect(t.provenance).toMatchObject({ accuracyMm: 1.48, inputType: 'gridded-mockup' });
  expect(t.provenance.method).toMatch(/cutting-mat grid.*; edited in the template editor$/);
  // The shipped template is still in the library, unchanged.
  await expect(page.getByTestId('lib-tpl-pik20d.t-panel-mockup')).toBeVisible();
  await expect(page.getByTestId(`lib-tpl-${t.id}`)).toBeVisible();

  // Your own copy edits in place: same id and version, no new library entry.
  await page.getByTestId(`tpl-edit-${t.id}`).click();
  await page.waitForFunction(() => !(window as unknown as Gpd).gpd.tplUi.state.busy);
  expect((await g(page)).draft!.name).toBe(t.name);
  await setField(page, 'tpl-thickness', '3');
  await page.getByTestId('tpl-step-save').click();
  await page.getByTestId('tpl-use').click();
  await expect.poll(async () => (await g(page)).template.embedded?.thickness).toBe(3);
  const t2 = (await g(page)).template.embedded!;
  expect([t2.id, t2.version, t2.thickness, t2.fixings.length]).toEqual([t.id, t.version, 3, 2]);
  await expect(page.locator(`[data-testid="lib-tpl-${t.id}"]`)).toHaveCount(1);

  // Back in the panel editor, the checks see the new fixing holes.
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  await expect(page.locator('.doc-title')).toContainText('PIK-20D T-panel');
  expect(errors).toEqual([]);
});

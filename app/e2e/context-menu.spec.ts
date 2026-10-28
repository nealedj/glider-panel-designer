/**
 * The canvas right-click menu: it selects what was clicked, offers commands for it, and
 * closes on Escape or a click elsewhere.
 */
import { expect, test, type Page } from '@playwright/test';

type Doc = { parts: { id: string; x: number; y: number; rotation: number }[] };
type Gpd = { gpd: { docs: { doc: Doc }; ui: { set: (s: object) => void; state: { selection: string[] } } } };

const getDoc = (page: Page) => page.evaluate(() => (window as unknown as Gpd).gpd.docs.doc);
const selection = (page: Page) => page.evaluate(() => (window as unknown as Gpd).gpd.ui.state.selection);

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('open sample project');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-part="p1"]')).toBeVisible();
  await page.evaluate(() => (window as unknown as Gpd).gpd.ui.set({ zoom: 3, centre: { x: 0, y: 0 }, selection: [] }));
});

test.afterEach(() => expect(errors).toEqual([]));

test('right-click a part selects it and rotates it from the menu', async ({ page }) => {
  await page.locator('[data-part="p1"]').click({ button: 'right' });
  expect(await selection(page)).toEqual(['p1']);
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Delete/ })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Centre on panel' }).hover();
  await expect(menu.getByRole('menuitem', { name: /^Centre across/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/context-menu-part.png' });
  await menu.getByRole('menuitem', { name: /^Rotate 90°/ }).click();
  await expect(menu).toHaveCount(0);
  expect((await getDoc(page)).parts.find((p) => p.id === 'p1')!.rotation).toBe(90);
});

test('right-click inside a selection keeps it and offers align', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Gpd).gpd.ui.set({ selection: ['p1', 'p3'] }));
  await page.locator('[data-part="p3"]').click({ button: 'right' });
  expect(await selection(page)).toEqual(['p1', 'p3']);
  const menu = page.getByTestId('context-menu');
  await menu.getByRole('menuitem', { name: 'Align' }).hover();
  await menu.getByRole('menuitem', { name: /^Align top edges/ }).click();
  await expect(menu).toHaveCount(0);
});

test('right-click empty canvas offers view actions; Escape closes it', async ({ page }) => {
  const c = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.click(c.x + 40, c.y + c.height - 40, { button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu.getByRole('menuitem', { name: /^Zoom to fit/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Delete/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.mouse.click(c.x + 40, c.y + c.height - 40, { button: 'right' });
  await expect(menu).toBeVisible();
  await page.mouse.click(c.x + 80, c.y + c.height - 80);
  await expect(menu).toHaveCount(0);
});

/**
 * Arranging: equal-gap snapping while dragging, centring on the panel and auto-arrange,
 * each from the menus or palette and each one undoable step.
 */
import { expect, test, type Page } from '@playwright/test';

type Doc = { parts: { id: string; x: number; y: number }[] };
type Gpd = { gpd: { docs: { doc: Doc; undo: () => void }; ui: { set: (s: object) => void; state: { message: string } } } };

const getDoc = (page: Page) => page.evaluate(() => (window as unknown as Gpd).gpd.docs.doc);
const part = async (page: Page, id: string) => (await getDoc(page)).parts.find((p) => p.id === id)!;
const select = (page: Page, ids: string[]) => page.evaluate((s) => (window as unknown as Gpd).gpd.ui.set({ selection: s }), ids);

async function runCommand(page: Page, name: string) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
}

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await runCommand(page, 'open sample project');
  await expect(page.locator('[data-part="p1"]')).toBeVisible();
  await page.evaluate(() => (window as unknown as Gpd).gpd.ui.set({ zoom: 3, centre: { x: 0, y: 0 } }));
});

test.afterEach(() => expect(errors).toEqual([]));

test('dragging a switch snaps to the gap between the instruments', async ({ page }) => {
  await select(page, ['p5']);
  const b = (await page.locator('[data-part="p5"]').boundingBox())!;
  const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  // 12.6 mm right at 3 px/mm: the 24 mm gap between the instruments is 0.6 mm away.
  await page.mouse.move(at.x + 20, at.y, { steps: 4 });
  await page.mouse.move(at.x + 12.6 * 3, at.y, { steps: 4 });
  await expect(page.getByTestId('snap-gap')).toHaveCount(2);
  await expect(page.getByTestId('snap-gap').first()).toContainText('24.00 mm');
  await page.screenshot({ path: 'test-results/arrange-gap-snap.png' });
  await page.mouse.up();
  expect((await part(page, 'p5')).x).toBeCloseTo(2, 6);
  await expect(page.getByTestId('snap-gap')).toHaveCount(0);
});

test('centre on panel from the Arrange menu, then undo', async ({ page }) => {
  await select(page, ['p1']);
  await page.getByRole('menubar').getByText('Arrange', { exact: true }).click();
  await page.getByRole('menuitem', { name: /^Centre on panel/ }).click();
  expect(await part(page, 'p1')).toMatchObject({ x: 0, y: 0 });
  await page.keyboard.press('Control+z');
  expect(await part(page, 'p1')).toMatchObject({ x: -95, y: 40 });
});

test('auto-arrange tidies the selection into rows', async ({ page }) => {
  await select(page, ['p1', 'p2', 'p3', 'p4', 'p5']);
  await runCommand(page, 'auto-arrange');
  const dialog = page.getByRole('dialog', { name: 'Auto-arrange' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Arrange' }).click();
  await expect(dialog).toBeHidden();
  const doc = await getDoc(page);
  const x = (id: string) => doc.parts.find((p) => p.id === id)!.x;
  expect(x('p1')).toBeCloseTo(-85.5, 6);
  expect(x('p2')).toBeCloseTo(0, 6);
  expect(x('p3')).toBeCloseTo(85.5, 6);
  expect(x('p4')).toBeCloseTo(-11.5, 6);
  expect(x('p5')).toBeCloseTo(11.5, 6);
  await expect(page.getByText(/Arranged 5 parts in 2 rows/)).toBeVisible();
  await page.screenshot({ path: 'test-results/arrange-auto.png' });
});

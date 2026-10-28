/**
 * M5: the Review tab. Open a candidates file from the discovery tools, see the S100 trap
 * flagged, accept the maker's figures, reject the shop's wrong ones, enter a value read
 * from a manual page, and export the reviewed set: every value with its source and
 * snippet, and nothing that only the shop said.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const FIXTURE = '../fixtures/discovery/candidates.synthetic.json';
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  sources: { id: string; kind: string }[];
  products: { key: string; candidates: { path: string; value: unknown; source: string }[] }[];
};
const kind = (id: string) => fixture.sources.find((s) => s.id === id)!.kind;
const s100 = fixture.products.find((p) => p.key === 'lxnav.s100-vario.57-mm')!;
const find = (pred: (c: (typeof s100.candidates)[number]) => boolean) => s100.candidates.findIndex(pred);

test('review a product against its sources and export it for the catalogue', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByTestId('review-open').setInputFiles(FIXTURE);
  await expect(page.getByTestId('review-summary')).toContainText('0 of 3 reviewed');
  await expect(page.getByTestId('review-summary')).toContainText('Reference panel 0/1');
  await page.getByTestId('review-p-lxnav.s100-vario.57-mm').click();
  const product = page.getByTestId('review-product');
  await expect(product.locator('h2')).toContainText('LXNAV S100 Vario (57 mm)');

  // The trap: the shop's current-draw lines are for other models, and say so.
  const current = page.getByTestId('review-f-power.currentA');
  const trap = find((c) => c.path === 'power.currentA' && c.value === 0.14);
  await expect(current.getByTestId(`review-c-${trap}`)).toContainText('This line names S10, not S100');
  await expect(current.getByTestId(`review-c-${trap}`).locator('.conf')).toHaveClass(/conf-low/);
  await page.screenshot({ path: 'test-results/m5-review-trap.png' });

  // Accept the maker's figures; reject the shop's.
  const acceptFirst = async (path: string, pred: (c: (typeof s100.candidates)[number]) => boolean) => {
    const i = find((c) => c.path === path && pred(c));
    await page.getByTestId(`review-f-${path}`).getByTestId(`review-accept-${i}`).click();
  };
  await acceptFirst('front.cutout', (c) => kind(c.source) === 'manual' && (c.value as { d: number }).d === 57);
  await acceptFirst('rear.depth', (c) => kind(c.source) === 'manual' && c.value === 98);
  await acceptFirst('power.currentA', (c) => c.value === 0.165);
  await acceptFirst('power.voltage', (c) => kind(c.source) === 'manual');
  await acceptFirst('weightG', () => true);
  await acceptFirst('connectors.pinout', () => true);
  await acceptFirst('datasheet', () => true);
  await acceptFirst('front.bezel', () => true);
  for (const i of s100.candidates.map((c, k) => [c, k] as const).filter(([c]) => c.path === 'power.currentA' && kind(c.source) === 'retailer').map(([, k]) => k)) {
    await current.getByTestId(`review-reject-${i}`).click();
  }
  // The shop-only weight is accepted for local use but flagged as left out of the export.
  await expect(page.getByTestId('review-f-weightG')).toContainText('left out of the catalogue export');
  await expect(page.getByTestId('review-preview')).toContainText('Left out of the catalogue export');

  // A value read from a drawing: the screw-hole pattern.
  await product.locator('.review-enter summary').click();
  await page.getByTestId('review-enter-front.screwHoles').click();
  const form = page.getByTestId('review-form-front.screwHoles');
  await form.getByTestId('review-form-a').fill('47');
  await form.getByTestId('review-form-b').fill('3.5');
  await form.getByTestId('review-form-snippet').fill('Drawing on page 2: four M4 screws on a 47 mm square');
  await form.getByTestId('review-form-save').click();
  await expect(page.getByTestId('review-sketch').locator('.hole')).toHaveCount(4);

  await page.getByTestId('review-done').check();
  await expect(page.getByTestId('review-summary')).toContainText('1 of 3 reviewed');
  await page.screenshot({ path: 'test-results/m5-review-done.png' });

  // Decisions survive a reload.
  await page.reload();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByTestId('review-summary')).toContainText('1 of 3 reviewed');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('review-export').click()]);
  const bundle = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  writeFileSync('test-results/m5-reviewed-parts.json', JSON.stringify(bundle, null, 2));
  expect(bundle.kind).toBe('gpd-reviewed-parts');
  expect(bundle.parts).toHaveLength(1);
  const part = bundle.parts[0];
  expect(part.id).toBe('lxnav.s100-vario.57-mm');
  expect(part.front.cutouts[0].d).toBe(57);
  expect(part.front.screwHoles).toHaveLength(4);
  expect(part.power.currentA).toBe(0.165);
  expect(part.weightG).toBeNull();
  // The bezel came only from the shop's W × H × D, so it is left out too.
  expect(part.front.bezel).toBeNull();
  expect(bundle.excluded.map((e: { path: string }) => e.path).sort()).toEqual(['front.bezel', 'weightG']);
  for (const [path, src] of Object.entries(part.sources) as [string, { url: string; snippet: string; status: string }][]) {
    expect(src.status, path).toBe('verified');
    expect(src.snippet.length, path).toBeGreaterThan(5);
    expect(src.url, path).not.toContain('shop.test');
  }
  expect(errors).toEqual([]);
});

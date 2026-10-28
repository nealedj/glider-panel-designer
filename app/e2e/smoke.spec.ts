import { expect, test } from '@playwright/test';

test('app loads with sample project', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.locator('[data-part]')).toHaveCount(7);
  await page.screenshot({ path: 'test-results/smoke.png' });
  expect(errors).toEqual([]);
});

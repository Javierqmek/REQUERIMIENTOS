import { test, expect } from "@playwright/test";

for (const [width,height] of [[1440,900],[1366,768],[390,844],[375,812],[320,700]]) test(`Mis requerimientos total responsive ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width,height });
  await page.goto("/requerimientos");
  await expect(page.getByText("Total", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("S/ 40.00", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.qa/requirements-total-${width}x${height}.png`, fullPage: false });
});

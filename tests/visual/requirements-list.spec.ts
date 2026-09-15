import { test, expect } from "@playwright/test";
import { responsiveViewports } from "./viewports";

for (const [width,height] of responsiveViewports) test(`Mis requerimientos total responsive ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width,height });
  await page.goto("/requerimientos");
  await expect(page.getByText("Total", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("S/ 40.00", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.qa/requirements-total-${width}x${height}.png`, fullPage: false });
});

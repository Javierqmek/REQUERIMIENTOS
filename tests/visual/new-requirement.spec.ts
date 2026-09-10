import { test, expect, type Page } from "@playwright/test";
import { editGarments } from "../fixtures/edit";

async function reachGarments(page: Page) {
  await page.goto("/requerimientos/nuevo");
  await page.getByLabel("Buscar agente").fill("María");
  await page.getByRole("button", { name: /MARÍA AGENTE OPERATIVA/ }).click();
  await page.getByLabel("Cliente").selectOption({ label: "RENIEC" });
  await page.getByLabel("Unidad").selectOption({ label: "OFICINA REGISTRAL ATE" });
}

for (const [width,height] of [[1440,900],[1366,768],[390,844],[375,812],[320,700]]) test(`Nuevo requerimiento responsive ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width,height });
  await reachGarments(page);
  await expect(page.getByText("¿Para quién son las prendas?")).toBeVisible();
  await page.getByRole("radio", { name: "Hombre" }).click();
  await expect(page.getByLabel("Prenda", { exact: true })).toBeEnabled();
  await expect(page.getByText("Total del requerimiento")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.qa/new-gender-${width}x${height}.png`, fullPage: true });
});

test("Hombre/Mujer incluye AMBOS y confirma solo al retirar incompatibles", async ({ page }) => {
  await page.setViewportSize({ width: 375,height: 812 });
  await reachGarments(page);
  await page.getByRole("radio", { name: "Hombre" }).click();
  const select = page.getByLabel("Prenda", { exact: true });
  await expect(select.locator(`option[value="${editGarments[0].id}"]`)).toHaveCount(1);
  await expect(select.locator(`option[value="${editGarments[0].id}"]`)).not.toContainText(editGarments[0].codigo_prenda);
  await expect(select.locator(`option[value="${editGarments[1].id}"]`)).toHaveCount(1);
  await expect(select.locator(`option[value="${editGarments[2].id}"]`)).toHaveCount(0);
  await select.selectOption(editGarments[0].id);
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByLabel("Resumen del requerimiento").getByText("S/ 495.00", { exact: true })).toBeVisible();
  await select.selectOption(editGarments[1].id);
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(page.getByLabel("Resumen del requerimiento").getByText("S/ 1,095.00", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Mujer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, continuar" }).click();
  await expect(page.getByText(editGarments[0].nombre_prenda, { exact: true })).toHaveCount(0);
  await expect(page.getByText(editGarments[1].nombre_prenda, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Resumen del requerimiento").getByText("S/ 600.00", { exact: true })).toBeVisible();
  await expect(select.locator(`option[value="${editGarments[2].id}"]`)).toHaveCount(1);
  await page.getByRole("button", { name: "Guardar requerimiento" }).click();
  await expect(page.getByRole("heading", { name: "Requerimiento registrado" })).toBeVisible();
});

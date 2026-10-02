import { test, expect, type Page } from "@playwright/test";
import { editGarments, inviernoGarment, veranoGarment } from "../fixtures/edit";
import { responsiveViewports } from "./viewports";

async function reachGarments(page: Page) {
  await page.goto("/requerimientos/nuevo");
  await page.getByLabel("Buscar agente").fill("María");
  await page.getByRole("button", { name: /MARÍA AGENTE OPERATIVA/ }).click();
  await page.getByLabel("Cliente").selectOption({ label: "RENIEC" });
  await page.getByLabel("Unidad").selectOption({ label: "OFICINA REGISTRAL ATE" });
}

test("la renovación se preselecciona con la de la unidad y el usuario puede cambiarla", async ({ page }) => {
  await reachGarments(page);
  await expect(page.getByRole("radio", { name: "Verano" })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Unidad").selectOption({ label: "SEDE ANDINA INVIERNO" });
  await expect(page.getByRole("radio", { name: "Invierno" })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Unidad").selectOption({ label: "OFICINA REGISTRAL ATE" });
  await expect(page.getByRole("radio", { name: "Verano" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Invierno" }).click();
  await expect(page.getByRole("radio", { name: "Invierno" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Verano" })).toHaveAttribute("aria-checked", "false");
});

test("las prendas se filtran por renovación y género (la prenda Ambos aparece en las dos renovaciones)", async ({ page }) => {
  await reachGarments(page);
  await page.getByRole("radio", { name: "Hombre" }).click();
  const select = page.getByLabel("Prenda", { exact: true });
  await expect(select.locator(`option[value="${veranoGarment.id}"]`)).toHaveCount(1);
  await expect(select.locator(`option[value="${inviernoGarment.id}"]`)).toHaveCount(0);
  await expect(select.locator(`option[value="${editGarments[0].id}"]`)).toHaveCount(1);
  await page.getByRole("radio", { name: "Invierno" }).click();
  await expect(select.locator(`option[value="${veranoGarment.id}"]`)).toHaveCount(0);
  await expect(select.locator(`option[value="${inviernoGarment.id}"]`)).toHaveCount(1);
  await expect(select.locator(`option[value="${editGarments[0].id}"]`)).toHaveCount(1);
});

test("cambiar la renovación avisa y quita solo las prendas que ya no corresponden", async ({ page }) => {
  await reachGarments(page);
  await page.getByRole("radio", { name: "Hombre" }).click();
  const select = page.getByLabel("Prenda", { exact: true });
  for (const garment of [veranoGarment, editGarments[0]]) {
    await select.selectOption(garment.id);
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
  }
  await page.getByRole("radio", { name: "Invierno" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("¿Cambiar el tipo de renovación?")).toBeVisible();
  await expect(dialog.getByText(veranoGarment.nombre_prenda, { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("radio", { name: "Verano" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Invierno" }).click();
  await dialog.getByRole("button", { name: "Sí, continuar" }).click();
  await expect(page.getByText(veranoGarment.nombre_prenda, { exact: true })).toHaveCount(0);
  await expect(page.getByText(editGarments[0].nombre_prenda, { exact: true })).toBeVisible();
});

test("una prenda ya agregada se ve gris, tachada y deshabilitada con la etiqueta 'Ya agregada', y vuelve al quitarla", async ({ page }) => {
  await reachGarments(page);
  await page.getByRole("radio", { name: "Hombre" }).click();
  const option = page.getByLabel("Prenda", { exact: true }).locator(`option[value="${editGarments[0].id}"]`);
  await expect(option).not.toContainText("Ya agregada");
  await page.getByLabel("Prenda", { exact: true }).selectOption(editGarments[0].id);
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(option).toBeDisabled();
  await expect(option).toContainText("Ya agregada");
  expect(await option.evaluate(node => getComputedStyle(node).textDecorationLine)).toBe("line-through");
  await page.getByRole("button", { name: `Eliminar ${editGarments[0].nombre_prenda}` }).click();
  await expect(option).toBeEnabled();
  await expect(option).not.toContainText("Ya agregada");
});

for (const [width,height] of responsiveViewports) test(`Nuevo requerimiento responsive ${width}x${height}`, async ({ page }) => {
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

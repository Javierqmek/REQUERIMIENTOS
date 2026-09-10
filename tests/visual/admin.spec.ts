import { test, expect } from "@playwright/test";
import { IDS } from "../fixtures/admin";
const sizes = [[1440,900], [1366,768], [390,844], [375,812], [320,700]];
for (const [width, height] of sizes) {
  test(`Administración responsive ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/admin/requerimientos");
    await page.getByRole("button", { name: "Filtros · Todos los requerimientos" }).click();
    await expect(page.getByRole("heading", { name: "Requerimientos", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "62 requerimientos encontrados" })).toBeVisible();
    const total = width >= 1280
      ? page.locator("table td").filter({ hasText: /^S\/ 40\.00$/ }).first()
      : page.locator("article dd").filter({ hasText: /^S\/ 40\.00$/ }).first();
    await expect(total).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.qa/admin-${width}x${height}-filters.png`, fullPage: false });
    await page.getByRole("button", { name: "Filtros · Todos los requerimientos" }).click();
    await expect(page.getByLabel("Cliente", { exact: true })).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.qa/admin-${width}x${height}-results.png`, fullPage: false });
    const account = page.locator("header").first().getByRole("button");
    await account.focus(); await account.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Cerrar sesión" })).toBeVisible();
    await account.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Cerrar sesión" })).not.toBeVisible();
    await page.getByRole("button", { name: "Página siguiente" }).click();
    await expect(page.getByText("Página 2 de 2", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
  });
}
test("filtros combinados, dependencia unidad y limpiar", async ({ page }) => {
  await page.goto("/admin/requerimientos");
  await page.getByRole("button", { name: "Filtros · Todos los requerimientos" }).click();
  await page.getByLabel("Cliente", { exact: true }).selectOption(IDS.cliente);
  await expect(page.getByLabel("Unidad / Sede", { exact: true }).locator("option")).toHaveCount(2);
  await page.getByLabel("Unidad / Sede", { exact: true }).selectOption(IDS.unidad);
  await page.getByLabel("Coordinador", { exact: true }).selectOption(IDS.coordinador);
  await page.getByLabel("Estado", { exact: true }).selectOption("Pendiente");
  await expect(page.getByRole("button", { name: "Exportar Excel SIDIGE" })).toBeDisabled();
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.getByRole("heading", { name: "21 requerimientos encontrados" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exportar Excel SIDIGE" })).toBeEnabled();
  await page.getByLabel("Cliente", { exact: true }).selectOption("55000000-0000-4000-8000-000000000002");
  await expect(page.getByLabel("Unidad / Sede", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await expect(page.getByRole("heading", { name: "62 requerimientos encontrados" })).toBeVisible();
});
test("Excel: progreso, bloqueo doble clic, descarga y éxito", async ({ page }) => {
  await page.goto("/admin/requerimientos");
  await page.getByRole("button", { name: "Filtros · Todos los requerimientos" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar Excel SIDIGE" }).click();
  await expect(page.getByRole("button", { name: "Generando Excel..." })).toBeDisabled();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^MIGRADOR_RENOVACION_VERANO_\d{8}_\d{4}\.xlsx$/);
  await expect(page.getByText("Excel generado correctamente", { exact: true })).toBeVisible();
  await expect(page.getByText("Archivo listo:", { exact: false })).toBeVisible();
});
test("vacío, error de consulta y error de validación", async ({ page }) => {
  await page.goto("/admin/requerimientos");
  await page.getByRole("button", { name: "Filtros · Todos los requerimientos" }).click();
  const search = page.getByLabel("Buscar en todos los requerimientos");
  await search.fill("sin resultados");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.getByRole("heading", { name: "0 requerimientos encontrados" })).toBeVisible();
  await page.getByRole("button", { name: "Exportar Excel SIDIGE" }).click();
  await expect(page.getByText("No hay requerimientos para exportar con los filtros seleccionados.")).toBeVisible();
  await page.screenshot({ path: ".qa/admin-empty.png" });
  await search.fill("error"); await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.getByText("Error simulado de consulta. Intenta nuevamente.")).toBeVisible();
  await search.fill("incompleto"); await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.getByRole("heading", { name: "1 requerimiento encontrado" })).toBeVisible();
  await page.getByRole("button", { name: "Exportar Excel SIDIGE" }).click();
  await expect(page.getByText("Hay requerimientos con información incompleta.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: /44000000-0000-4000-8000-000000000001/ })).toBeVisible();
  await page.screenshot({ path: ".qa/admin-incomplete.png" });
});
test("cambio de estado conserva operación y recalcula filtro", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/requerimientos?estado=Pendiente");
  const before = await page.getByRole("heading", { name: /requerimientos encontrados/ }).textContent();
  await page.getByLabel("Estado de RAMÍREZ RIVERA JERY", { exact: true }).filter({ visible: true }).selectOption("Atendido");
  await expect(page.getByText("Estado actualizado correctamente.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /requerimientos encontrados/ })).not.toHaveText(before!);
});

test("sesión caducada no descarga HTML como XLSX", async ({ page }) => {
  await page.goto("/admin/requerimientos?q=sesion");
  let downloads = 0; page.on("download", () => { downloads++; });
  await page.getByRole("button", { name: "Exportar Excel SIDIGE" }).click();
  await expect(page.getByText("Tu sesión pudo haber caducado. Vuelve a iniciar sesión y reintenta.")).toBeVisible();
  expect(downloads).toBe(0);
});

for (const width of [320, 375]) test(`mensajes largos de éxito y error a ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 812 });
  await page.goto("/admin/requerimientos?q=incompleto");
  await page.getByRole("button", { name: "Exportar Excel SIDIGE" }).click();
  await expect(page.getByText("Hay requerimientos con información incompleta.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("alert").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.qa/admin-${width}-error.png` });
  await page.goto("/admin/requerimientos");
  await page.getByRole("button", { name: "Exportar Excel SIDIGE" }).click();
  await expect(page.getByText("Excel generado correctamente", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.qa/admin-${width}-success.png` });
});

test("eliminación múltiple exige confirmación y refresca conteo",async({page})=>{
  await page.setViewportSize({width:1440,height:900});await page.goto("/admin/requerimientos?delete=1");
  const boxes=page.locator("table tbody input[type=checkbox]");await boxes.nth(0).check();await boxes.nth(1).check();
  await page.getByRole("button",{name:"Eliminar seleccionados"}).click();await expect(page.getByRole("dialog")).toContainText("2 requerimientos de prueba");
  await page.getByRole("button",{name:"Sí, eliminar permanentemente"}).click();await expect(page.getByText("2 requerimientos eliminados correctamente")).toBeVisible();
  await expect(page.getByRole("heading",{name:"60 requerimientos encontrados"})).toBeVisible();
});

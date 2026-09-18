import { test, expect, type Page } from "@playwright/test";
import { responsiveViewports } from "./viewports";

async function goToForm(page: Page) {
  await page.goto("/documentos/vacaciones/nueva");
}

for (const [width, height] of responsiveViewports) test(`Registrar papeleta responsive ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await goToForm(page);
  await expect(page.getByText("Registrar papeleta de vacaciones")).toBeVisible();
  await expect(page.getByText("A. Colaborador")).toBeVisible();
  await expect(page.getByText("G. Resumen y registrar")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.qa/vacations-new-${width}x${height}.png`, fullPage: true });
});

for (const [width, height] of responsiveViewports) test(`Mis papeletas de vacaciones responsive ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await page.goto("/documentos/vacaciones");
  await expect(page.getByText("Mis papeletas de vacaciones")).toBeVisible();
  await expect(page.getByText("MARÍA AGENTE OPERATIVA")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.qa/vacations-list-${width}x${height}.png`, fullPage: true });
});

test("listado muestra colaborador, código, físicas, venta, reemplazo, provincia, cliente, unidad y estado", async ({ page }) => {
  await page.goto("/documentos/vacaciones");
  await expect(page.getByText("MARÍA AGENTE OPERATIVA")).toBeVisible();
  await expect(page.getByText("Código PER-001")).toBeVisible();
  await expect(page.getByText(/Físicas:.*15 días/)).toBeVisible();
  await expect(page.getByText(/Venta:.*5 días/)).toBeVisible();
  await expect(page.getByText(/Reemplazo: CARLOS REEMPLAZO OPERATIVO/)).toBeVisible();
  await expect(page.getByText(/Provincia: AREQUIPA/)).toBeVisible();
  await expect(page.getByText("RENIEC · OFICINA REGISTRAL ATE")).toBeVisible();
  // exact: la tarjeta también muestra "Registrado: <fecha>" (fecha de registro), texto distinto.
  await expect(page.getByText("Registrado", { exact: true })).toBeVisible();
});

test("admin ve la columna de coordinador; coordinador no", async ({ page }) => {
  await page.goto("/documentos/vacaciones?role=admin");
  await expect(page.getByText("Papeletas de vacaciones")).toBeVisible();
  await expect(page.getByText(/Coordinador: Javier Quispe/)).toBeVisible();
  await page.goto("/documentos/vacaciones");
  await expect(page.getByText(/Coordinador: Javier Quispe/)).toHaveCount(0);
});

test("catálogo de provincias vacío muestra aviso en vez de un select vacío", async ({ page }) => {
  await page.goto("/documentos/vacaciones/nueva?sinProvincias=1");
  await page.waitForTimeout(200);
  await expect(page.getByText("No hay provincias configuradas. Contacte al administrador.")).toBeVisible();
  await expect(page.locator("#provincia")).toHaveCount(0);
});

test("la venta permanece deshabilitada hasta completar un rango válido de físicas", async ({ page }) => {
  await goToForm(page);
  await expect(page.getByLabel("Registrar venta de vacaciones")).toBeDisabled();
  await page.getByLabel("Fecha inicio").fill("2026-10-05");
  await page.getByLabel("Fecha fin").fill("2026-10-01");
  await expect(page.getByText(/fecha de fin debe ser igual o posterior/)).toBeVisible();
  await expect(page.getByLabel("Registrar venta de vacaciones")).toBeDisabled();
  await page.getByLabel("Fecha fin").fill("2026-10-05");
  await expect(page.getByLabel("Registrar venta de vacaciones")).toBeEnabled();
});

test("el reemplazo se excluye de sus propios resultados (no puede ser el mismo colaborador)", async ({ page }) => {
  await goToForm(page);
  await page.getByLabel("Colaborador").fill("María");
  await page.getByRole("button", { name: /MARÍA AGENTE OPERATIVA/ }).click();
  // El buscador de personal ficticio no filtra por texto (devuelve todo el catálogo): lo que
  // debe demostrarse es que el titular (María) nunca aparece entre los resultados de Reemplazo,
  // aunque otra persona (Carlos) sí siga apareciendo.
  await page.getByLabel("Reemplazo").fill("ag");
  await expect(page.getByRole("button", { name: /CARLOS REEMPLAZO OPERATIVO/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /MARÍA AGENTE OPERATIVA/ })).toHaveCount(0);
});

test("rechaza venta cruzada, misma fecha y antes de físicas; acepta después de físicas", async ({ page }) => {
  await goToForm(page);
  await page.getByLabel("Fecha inicio").fill("2026-10-01");
  await page.getByLabel("Fecha fin").fill("2026-10-15");
  await page.getByLabel("Registrar venta de vacaciones").check();

  await page.getByLabel("Fecha inicio venta").fill("2026-10-10");
  await page.getByLabel("Fecha fin venta").fill("2026-10-20");
  await expect(page.getByText(/después del fin de las vacaciones físicas/)).toBeVisible();

  await page.getByLabel("Fecha inicio venta").fill("2026-10-15");
  await expect(page.getByText(/después del fin de las vacaciones físicas/)).toBeVisible();

  await page.getByLabel("Fecha inicio venta").fill("2026-10-16");
  await expect(page.getByText(/después del fin de las vacaciones físicas/)).toHaveCount(0);
});

test("flujo completo: colaborador, días calendario, venta, reemplazo, ubicación, documento y registro", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await goToForm(page);
  await expect(page.getByRole("button", { name: "Registrar papeleta" })).toBeDisabled();

  // A. Colaborador: buscador sobre personal existente; código automático, no editable.
  await page.getByLabel("Colaborador").fill("María");
  await page.getByRole("button", { name: /MARÍA AGENTE OPERATIVA/ }).click();
  await expect(page.getByText("Código PER-001")).toBeVisible();
  await expect(page.locator('input[value="PER-001"]')).toHaveCount(0);

  // B. Físicas obligatorias + días calendario inclusivos (01→15 oct = 15 días).
  await page.getByLabel("Fecha inicio").fill("2026-10-01");
  await page.getByLabel("Fecha fin").fill("2026-10-15");
  await expect(page.locator("output").first()).toHaveText("15");

  // C. Venta posterior a físicas + días calendario (16→20 oct = 5 días).
  await page.getByLabel("Registrar venta de vacaciones").check();
  await page.getByLabel("Fecha inicio venta").fill("2026-10-16");
  await page.getByLabel("Fecha fin venta").fill("2026-10-20");
  await expect(page.locator("output").nth(1)).toHaveText("5");

  // D. Reemplazo: buscador sobre la misma base, distinto del titular.
  await page.getByLabel("Reemplazo").fill("Carlos");
  await page.getByRole("button", { name: /CARLOS REEMPLAZO OPERATIVO/ }).click();

  // E. Ubicación: cliente → unidad filtrada, y provincia desde catálogo (no hardcodeada).
  await page.getByLabel("Cliente").selectOption({ label: "RENIEC" });
  await page.getByLabel("Unidad / Sede").selectOption({ label: "OFICINA REGISTRAL ATE" });
  await page.getByLabel("Provincia").selectOption({ label: "AREQUIPA" });
  // El nombre del coordinador viene de la sesión (solo lectura): es el último <output> del
  // formulario. No se usa getByText aquí porque el menú de cuenta del header también lo muestra.
  await expect(page.locator("output").last()).toHaveText("Javier Quispe");

  // F. Documento: PDF, vista previa y checkbox obligatorio de legibilidad.
  await page.locator('input[type="file"]').setInputFiles({
    name: "papeleta-vacaciones.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%FAKE_TEST_PDF"),
  });
  await expect(page.getByText(/Vista previa/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar papeleta" })).toBeDisabled();
  await page.getByLabel(/Confirmo que el documento está completo y legible/).check();

  // G. Resumen y registrar.
  await expect(page.getByText("papeleta-vacaciones.pdf")).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar papeleta" })).toBeEnabled();
  await page.getByRole("button", { name: "Registrar papeleta" }).click();
  await expect(page.getByRole("heading", { name: "Papeleta registrada" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mis papeletas de vacaciones" })).toBeVisible();
});

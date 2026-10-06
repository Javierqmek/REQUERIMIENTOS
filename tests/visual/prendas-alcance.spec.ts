import { test, expect, type Page } from "@playwright/test";

// Importación de prendas desde Excel en español y cambio de precio con alcance (impacto antes de aplicar).
async function loadPrendas(page: Page, superadmin: boolean) {
  await page.goto("/admin/importaciones" + (superadmin ? "?superadmin=1" : ""));
  await page.getByLabel("Catálogo").selectOption("prendas");
  await page.getByLabel("Cliente del archivo").selectOption({ label: "RENIEC" });
  await page.locator("input[type=file]").setInputFiles({
    name: "prendas.csv", mimeType: "text/csv",
    buffer: Buffer.from("codigo_prenda;nombre_prenda;codigo_almacen;precio;cantidad;genero;renovacion;activo\r\nCAM001;Camisa;UNF1;S/ 1,250.50;4;Hombre;Verano;sí\r\n;;;;;;;\r\nMED001;Medias;UNF3;S/ 5.00;2;Ambos;Verano;sí\r\n", "latin1"),
  });
  const request = page.waitForRequest(r => r.url().endsWith("/api/admin/importaciones"));
  await page.getByRole("button", { name: "Validar y previsualizar" }).click();
  return (await request).postDataJSON();
}

test("Prendas: CSV de Excel con ; y S/ se lee, ignora filas vacías y conserva el número de fila original", async ({ page }) => {
  const body = await loadPrendas(page, false);
  expect(body.rows).toHaveLength(2);
  expect(body.rows[0].precio).toBe("S/ 1,250.50");
  expect(body.filas).toEqual([2, 4]);
});

test("Prendas: la alerta ofrece alcance (solo desde ahora, en trámite, todos solo superadmin) con el impacto", async ({ page }) => {
  await loadPrendas(page, false);
  const alerts = page.getByTestId("alertas-ficha");
  await expect(alerts.getByText(/3 líneas en trámite \(2 requerimientos\) y 4 en total \(3\)/)).toBeVisible();
  const select = alerts.getByLabel("Qué hacer con CAM001");
  await expect(select.locator("option")).toHaveText(["Mantener actual", "Actualizar: solo desde ahora", "Actualizar y requerimientos en trámite", "Actualizar todos los requerimientos (solo superadmin)"]);
  await expect(select.locator('option[value="todos"]')).toBeDisabled();
  await expect(alerts.getByLabel("Qué hacer con COR001").locator("option")).toHaveText(["Mantener actual", "Actualizar"]);
  await select.selectOption("tramite");
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.getByRole("dialog").getByText(/Además se modificarán 3 líneas de requerimientos existentes \(hasta 2 requerimientos\)/)).toBeVisible();
  const request = page.waitForRequest(r => r.url().endsWith("/api/admin/importaciones"));
  await page.getByRole("dialog").getByRole("button", { name: "Sí, importar" }).click();
  expect((await request).postDataJSON()).toMatchObject({ mode: "apply", actualizar: { CAM001: "tramite" } });
});

test("Prendas: un superadmin sí puede elegir todos los requerimientos", async ({ page }) => {
  await loadPrendas(page, true);
  const select = page.getByTestId("alertas-ficha").getByLabel("Qué hacer con CAM001");
  await expect(select.locator('option[value="todos"]')).toBeEnabled();
  await select.selectOption("todos");
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.getByRole("dialog").getByText(/Además se modificarán 4 líneas de requerimientos existentes/)).toBeVisible();
});

test("Prendas: la vista previa muestra Renovación actualizada y géneros actualizados", async ({ page }) => {
  await loadPrendas(page, false);
  const box = page.getByTestId("renovaciones");
  await expect(box.getByText("Renovación actualizada")).toBeVisible();
  await expect(box.getByText("MED001 · MEDIAS · Ambos → Verano")).toBeVisible();
  await expect(page.getByText("Géneros actualizados", { exact: true })).toBeVisible();
  await expect(page.getByText("Renovaciones actualizadas", { exact: true })).toBeVisible();
});

async function editCamisa(page: Page, superadmin = false) {
  await page.goto("/admin/mantenimiento" + (superadmin ? "?superadmin=1" : ""));
  await page.getByRole("tab", { name: "Prendas" }).click();
  await page.getByLabel("Acciones de CAMISA OPERATIVA MANGA LARGA").click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  return page.getByRole("dialog");
}

test("Prendas: cambiar el precio pide el alcance y muestra el impacto antes de aplicar", async ({ page }) => {
  const dialog = await editCamisa(page);
  await dialog.getByLabel("Precio unitario").fill("123.45");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  const panel = dialog.getByTestId("alcance");
  await expect(panel.getByText("¿Desde cuándo aplica el cambio de el precio?")).toBeVisible();
  await expect(panel.getByText("Solo cambia la ficha. Los requerimientos existentes no cambian.")).toBeVisible();
  await expect(panel.getByText("Actualiza 3 líneas en 2 requerimientos Pendiente u Observado.")).toBeVisible();
  await expect(panel.getByText(/Actualiza 4 líneas en 3 requerimientos, incluidos los Atendidos/)).toBeVisible();
  await expect(panel.getByLabel(/Todos los requerimientos/)).toBeDisabled();
  await panel.getByLabel(/También requerimientos en trámite/).check();
  await expect(panel.getByText(/Se modificarán 3 líneas en 2 requerimientos/)).toBeVisible();
  const request = page.waitForRequest(r => r.url().endsWith("/api/admin/catalogos") && r.method() === "PUT");
  await dialog.getByRole("button", { name: "Confirmar y guardar" }).click();
  expect((await request).postDataJSON().valores).toMatchObject({ precio: 123.45, alcance: "tramite" });
});

test("Prendas: 'Volver' del alcance regresa al formulario sin guardar", async ({ page }) => {
  const dialog = await editCamisa(page);
  await dialog.getByLabel("Precio unitario").fill("200");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await dialog.getByRole("button", { name: "Volver" }).click();
  await expect(dialog.getByLabel("Precio unitario")).toHaveValue("200");
  await expect(dialog.getByTestId("alcance")).toHaveCount(0);
});

test("Prendas: solo un superadmin puede elegir 'Todos los requerimientos'", async ({ page }) => {
  const dialog = await editCamisa(page, true);
  await dialog.getByLabel("Precio unitario").fill("321.00");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(dialog.getByTestId("alcance").getByLabel(/Todos los requerimientos/)).toBeEnabled();
  await dialog.getByTestId("alcance").getByLabel(/Todos los requerimientos/).check();
  await expect(dialog.getByText(/incluidos los ya atendidos/)).toBeVisible();
  const request = page.waitForRequest(r => r.url().endsWith("/api/admin/catalogos") && r.method() === "PUT");
  await dialog.getByRole("button", { name: "Confirmar y guardar" }).click();
  expect((await request).postDataJSON().valores.alcance).toBe("todos");
});

test("Prendas: si no cambia ni el precio ni el código de almacén no se pregunta el alcance", async ({ page }) => {
  const dialog = await editCamisa(page);
  await dialog.getByLabel("Nombre de la prenda").fill("CAMISA OPERATIVA MANGA CORTA");
  const request = page.waitForRequest(r => r.url().endsWith("/api/admin/catalogos") && r.method() === "PUT");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  expect((await request).postDataJSON().valores).not.toHaveProperty("alcance");
});

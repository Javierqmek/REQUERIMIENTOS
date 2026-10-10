import { test, expect, type Page } from "@playwright/test";
import { responsiveViewports } from "./viewports";

// Importación de personal desde un CSV guardado por Excel en Perú: ; + BOM + CRLF + DNI sin cero inicial + filas vacías.
const excel = "﻿codigo_personal;nombre;dni;activo\r\nR-1;ANA PEREZ DIAZ;12345678;sí\r\n;;;\r\nS-2;LUIS TORRES;1234567;sí\r\nS-3;NUEVA PERSONA;55555555;sí\r\n;;;\r\n";

async function load(page: Page, content = excel, encoding: "utf8" | "latin1" = "utf8") {
  await page.goto("/admin/importaciones");
  await page.getByLabel("Catálogo").selectOption("personal");
  await page.locator("input[type=file]").setInputFiles({ name: "seguroc.csv", mimeType: "text/csv", buffer: Buffer.from(content, encoding) });
}
async function preview(page: Page) {
  const request = page.waitForRequest(r => r.url().endsWith("/api/admin/importaciones"));
  await page.getByRole("button", { name: "Validar y previsualizar" }).click();
  return (await request).postDataJSON();
}

test("Personal: CSV de Excel con ; y BOM se lee, ignora filas vacías y no completa ceros", async ({ page }) => {
  await load(page);
  await expect(page.getByText("filas listas para validar")).toBeVisible();
  await expect(page.locator("strong", { hasText: /^3$/ })).toBeVisible();
  const body = await preview(page);
  expect(body).toMatchObject({ kind: "personal", mode: "preview", actualizar: [], cargo_defecto: "AGENTE" });
  expect(body.headers).toEqual(["codigo_personal", "nombre", "dni", "activo"]);
  expect(body.rows).toHaveLength(3);
  expect(body.rows[1].dni).toBe("1234567");
  expect(body.filas).toEqual([2, 4, 5]);
  for (const label of ["Nuevos", "Existentes sin cambios", "Existentes con diferencias", "Errores"]) await expect(page.getByText(label, { exact: true })).toBeVisible();
});

test("Personal: Windows-1252 conserva tildes y ñ", async ({ page }) => {
  await load(page, "codigo_personal;nombre;dni;activo\r\nA-1;PÉREZ NÚÑEZ;12345678;sí\r\n", "latin1");
  expect((await preview(page)).rows[0].nombre).toBe("PÉREZ NÚÑEZ");
});

test("Personal: sin columna cargo se pide el cargo de las personas nuevas", async ({ page }) => {
  await load(page);
  const input = page.getByLabel("Cargo de las personas nuevas");
  await expect(input).toHaveValue("AGENTE");
  await input.fill("GUARDIA");
  expect((await preview(page)).cargo_defecto).toBe("GUARDIA");
  await page.goto("/admin/importaciones");
  await page.getByLabel("Catálogo").selectOption("personal");
  await page.locator("input[type=file]").setInputFiles({ name: "con-cargo.csv", mimeType: "text/csv", buffer: Buffer.from("codigo_personal,nombre,dni,cargo,activo\nA,N,12345678,Guardia,true") });
  await expect(page.getByLabel("Cargo de las personas nuevas")).toHaveCount(0);
});

test("Personal: existentes con diferencias muestran valor actual y del archivo, 'Mantener actual' por defecto y marcan al agente vinculado", async ({ page }) => {
  await load(page);
  await preview(page);
  const box = page.getByTestId("diferencias-personal");
  await expect(box.getByText("Personas existentes con datos distintos (2)")).toBeVisible();
  await expect(box.getByText("Vinculado a una cuenta")).toBeVisible();
  await expect(box.getByText(/Nombre actual “ANA PEREZ”, en el archivo “ANA PEREZ DIAZ”/)).toBeVisible();
  await expect(box.getByText(/Estado actual “Activo”, en el archivo “Inactivo”/)).toBeVisible();
  await expect(box.getByLabel("Qué hacer con DNI 12345678")).toHaveValue("mantener");
  await expect(box.getByText(/El perfil, el correo y la vinculación de agentes nunca se modifican/)).toBeVisible();
});

test("Personal: aplicar sin elegir nada no actualiza a nadie; Actualizar envía solo los DNI elegidos", async ({ page }) => {
  await load(page);
  await preview(page);
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.getByRole("dialog").getByText(/Se crearán 2 personas nuevas\. Las demás existentes no cambian, nadie se desactiva y la vinculación de las cuentas de agentes \(perfil y correo\) nunca se modifica/)).toBeVisible();
  let request = page.waitForRequest(r => r.url().endsWith("/api/admin/importaciones"));
  await page.getByRole("dialog").getByRole("button", { name: "Sí, importar" }).click();
  expect((await request).postDataJSON()).toMatchObject({ mode: "apply", actualizar: [] });
  await expect(page.getByText(/Importación completada: 2 personas nuevas/)).toBeVisible();

  await load(page);
  await preview(page);
  await page.getByLabel("Qué hacer con DNI 22222222").selectOption("actualizar");
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.getByRole("dialog").getByText(/se actualizarán los datos de 1 existentes que elegiste/)).toBeVisible();
  request = page.waitForRequest(r => r.url().endsWith("/api/admin/importaciones"));
  await page.getByRole("dialog").getByRole("button", { name: "Sí, importar" }).click();
  expect((await request).postDataJSON()).toMatchObject({ mode: "apply", actualizar: ["22222222"] });
});

test("Personal: 'Actualizar todas' y 'Mantener todas'", async ({ page }) => {
  await load(page);
  await preview(page);
  await page.getByRole("button", { name: "Actualizar todas" }).click();
  await expect(page.getByLabel("Qué hacer con DNI 12345678")).toHaveValue("actualizar");
  await expect(page.getByLabel("Qué hacer con DNI 22222222")).toHaveValue("actualizar");
  await page.getByRole("button", { name: "Mantener todas" }).first().click();
  await expect(page.getByLabel("Qué hacer con DNI 12345678")).toHaveValue("mantener");
});

test("Personal: los errores indican la fila del archivo", async ({ page }) => {
  await load(page, "codigo_personal;nombre;dni;activo\r\nA;N;12345678;sí\r\nB;N;22222222;sí\r\nC;N;33333333;sí\r\nS-9;N;44444444;sí\r\n");
  await preview(page);
  await expect(page.getByText("Fila 9", { exact: true })).toBeVisible();
  await expect(page.getByText(/El código S-9 ya pertenece a otra persona \(DNI 99999999\)/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar errores (CSV)" }).click();
  expect((await download).suggestedFilename()).toBe("errores-importacion.csv");
});

for (const [width, height] of responsiveViewports) test(`Personal: vista previa sin desbordes ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await load(page);
  await preview(page);
  await expect(page.getByTestId("diferencias-personal")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Personal: aconseja el formato 00000000 para los DNI", async ({ page }) => {
  await load(page);
  await expect(page.getByText(/Si Excel borra los ceros iniciales, da formato personalizado/)).toBeVisible();
  await expect(page.getByText(/la plataforma no completa ceros/)).toBeVisible();
});

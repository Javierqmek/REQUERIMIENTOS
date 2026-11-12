import { test, expect, type Page } from "@playwright/test";
import { responsiveViewports } from "./viewports";

// Mantenimiento → Prendas: lista con prendas sin asignar, buscador, filtros, exportación y error "Ya existe".
// Las filas de ejemplo: CAMISA OPERATIVA MANGA LARGA (RENIEC, Ambos, Hombre), PANTALÓN DE TRABAJO (inactiva), BLUSA OPERATIVA (Mujer),
// y 11AS001 CHALECO SIN ASIGNAR (sin asignaciones).
const BCR = "55000000-0000-4000-8000-0000000000b1";
const PUESTO_A = "77000000-0000-4000-8000-0000000000a1";
const article = (page: Page, text: string) => page.getByRole("article").filter({ hasText: text });

async function open(page: Page) {
  await page.goto("/admin/mantenimiento");
  await page.getByRole("tab", { name: "Prendas" }).click();
  await expect(page.getByTestId("filtros-prendas")).toBeVisible();
}
const count = (page: Page) => page.getByRole("heading", { name: /registros$/ });

test("la lista incluye la prenda sin asignar 11AS001 con la etiqueta «Sin asignar»", async ({ page }) => {
  await open(page);
  const row = article(page, "11AS001");
  await expect(row).toBeVisible();
  await expect(row.getByText("Sin asignar", { exact: true })).toBeVisible();
  await expect(article(page, "CAMISA OPERATIVA MANGA LARGA").getByText("Sin asignar", { exact: true })).toHaveCount(0);
});

test("Estado: Activas por defecto; Inactivas y Todas", async ({ page }) => {
  await open(page);
  const estado = page.getByLabel("Filtrar por estado");
  await expect(estado).toHaveValue("activas");
  await expect(article(page, "PANTALÓN DE TRABAJO")).toHaveCount(0);
  await estado.selectOption("inactivas");
  await expect(article(page, "PANTALÓN DE TRABAJO")).toBeVisible();
  await expect(article(page, "11AS001")).toHaveCount(0);
  await estado.selectOption("todas");
  await expect(article(page, "PANTALÓN DE TRABAJO")).toBeVisible();
  await expect(article(page, "11AS001")).toBeVisible();
});

test("Cliente: «Sin asignar» muestra solo las prendas sin asignaciones y bloquea los filtros de asignación", async ({ page }) => {
  await open(page);
  const cliente = page.getByLabel("Filtrar por cliente");
  await expect(cliente.locator("option")).toContainText(["Todos los clientes", "RENIEC", "Sin asignar"]);
  await cliente.selectOption("SIN");
  await expect(article(page, "11AS001")).toBeVisible();
  await expect(article(page, "CAMISA OPERATIVA MANGA LARGA")).toHaveCount(0);
  await expect(count(page)).toHaveText(/^1 registros$/);
  await expect(page.getByLabel("Filtrar por género")).toBeDisabled();
  await expect(page.getByLabel("Filtrar por renovación")).toBeDisabled();
  await expect(page.getByLabel("Filtrar por puesto")).toBeDisabled();
});

test("Cliente RENIEC: sus prendas y no las sin asignar", async ({ page }) => {
  await open(page);
  await page.getByLabel("Filtrar por cliente").selectOption({ label: "RENIEC" });
  // (otras pruebas de la suite pueden haber cambiado asignaciones concretas: se comprueba que haya prendas de RENIEC y ninguna sin asignar)
  await expect(page.getByRole("article").first()).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Sin asignar" })).toHaveCount(0);
  await expect(article(page, "11AS001")).toHaveCount(0);
});

test("Puesto: solo se habilita si el cliente elegido usa puestos", async ({ page }) => {
  await open(page);
  const puesto = page.getByLabel("Filtrar por puesto");
  await expect(puesto).toBeDisabled();
  await page.getByLabel("Filtrar por cliente").selectOption({ label: "RENIEC" });
  await expect(puesto).toBeDisabled();
  await page.getByLabel("Filtrar por cliente").selectOption(BCR);
  await expect(puesto).toBeEnabled();
  await expect(puesto.locator("option")).toContainText(["Todos los puestos", "Vigilante Masculino", "Vigilante Masculino (Terno)"]);
  await puesto.selectOption(PUESTO_A);
  await page.getByLabel("Filtrar por cliente").selectOption({ label: "RENIEC" });
  await expect(puesto).toBeDisabled();
  await expect(puesto).toHaveValue("");
});

test("Género y Renovación se aplican a las asignaciones", async ({ page }) => {
  await open(page);
  await page.getByLabel("Filtrar por género").selectOption("MUJER");
  await expect(article(page, "BLUSA OPERATIVA")).toBeVisible();
  await expect(article(page, "11AS001")).toHaveCount(0);
  await page.getByLabel("Filtrar por género").selectOption("");
  await page.getByLabel("Filtrar por renovación").selectOption("INVIERNO");
  await expect(article(page, "ABRIGO DE INVIERNO")).toHaveCount(0);
  await expect(article(page, "11AS001")).toHaveCount(0);
  await expect(page.getByLabel("Filtrar por renovación").locator("option")).toHaveText(["Todas las renovaciones", "Verano", "Invierno", "Ambos"]);
});

test("Almacén: lista los códigos existentes y filtra por uno", async ({ page }) => {
  await open(page);
  const almacen = page.getByLabel("Filtrar por almacén");
  await expect(almacen.locator("option")).toContainText(["Todos los almacenes", "ACTUAL", "ALM-03", "UNF1"]);
  await almacen.selectOption("UNF1");
  await expect(article(page, "11AS001")).toBeVisible();
  await expect(article(page, "BLUSA OPERATIVA")).toHaveCount(0);
});

test("Buscador: a ancho completo, por código o nombre, sin importar mayúsculas ni tildes, mientras se escribe", async ({ page }) => {
  await open(page);
  const search = page.getByLabel("Buscar en prendas");
  const filtros = (await page.getByTestId("filtros-prendas").boundingBox())!, box = (await search.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(filtros.width - 2);
  await search.pressSequentially("chaleco");
  await expect(article(page, "11AS001")).toBeVisible();
  await expect(article(page, "BLUSA OPERATIVA")).toHaveCount(0);
  await expect(count(page)).toHaveText(/^1 registros$/);
  await search.fill("11as0");
  await expect(article(page, "11AS001")).toBeVisible();
  await page.getByLabel("Filtrar por estado").selectOption("todas");
  await search.fill("PANTALON");
  await expect(article(page, "PANTALÓN DE TRABAJO")).toBeVisible();
  await search.fill("pantalón");
  await expect(article(page, "PANTALÓN DE TRABAJO")).toBeVisible();
  await search.fill("zzz-no-existe");
  await expect(page.getByText("No hay registros con estos filtros.")).toBeVisible();
  await expect(count(page)).toHaveText(/^0 registros$/);
});

test("Limpiar filtros restablece búsqueda y filtros (Estado vuelve a Activas) y el contador", async ({ page }) => {
  await open(page);
  const clear = page.getByRole("button", { name: "Limpiar filtros" });
  await expect(clear).toBeDisabled();
  await page.getByLabel("Buscar en prendas").fill("chaleco");
  await page.getByLabel("Filtrar por estado").selectOption("todas");
  await page.getByLabel("Filtrar por cliente").selectOption("SIN");
  await expect(clear).toBeEnabled();
  await expect(count(page)).toHaveText(/^1 registros$/);
  await clear.click();
  await expect(page.getByLabel("Buscar en prendas")).toHaveValue("");
  await expect(page.getByLabel("Filtrar por estado")).toHaveValue("activas");
  await expect(page.getByLabel("Filtrar por cliente")).toHaveValue("");
  await expect(article(page, "BLUSA OPERATIVA")).toBeVisible();
  await expect(clear).toBeDisabled();
});

test("Exportar: el enlace respeta todos los filtros activos y «Sin asignar» exporta solo esas", async ({ page }) => {
  await open(page);
  const link = page.getByRole("link", { name: "Exportar prendas" });
  await expect(link).toHaveAttribute("href", "/api/admin/prendas/exportar?estado=activas");
  await page.getByLabel("Buscar en prendas").fill("camisa");
  await page.getByLabel("Filtrar por cliente").selectOption(BCR);
  await page.getByLabel("Filtrar por puesto").selectOption(PUESTO_A);
  await page.getByLabel("Filtrar por género").selectOption("HOMBRE");
  await page.getByLabel("Filtrar por renovación").selectOption("AMBOS");
  await page.getByLabel("Filtrar por almacén").selectOption("UNF1");
  await page.getByLabel("Filtrar por estado").selectOption("todas");
  const params = new URL((await link.getAttribute("href"))!, "http://x").searchParams;
  expect(Object.fromEntries(params)).toEqual({ q: "camisa", cliente: BCR, puesto: PUESTO_A, genero: "HOMBRE", renovacion: "AMBOS", almacen: "UNF1", estado: "todas" });
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await page.getByLabel("Filtrar por cliente").selectOption("SIN");
  await page.getByLabel("Filtrar por estado").selectOption("todas");
  await expect(link).toHaveAttribute("href", "/api/admin/prendas/exportar?sinAsignar=1&estado=todas");
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toBe("prendas-sin-asignar-2026-11-05.csv");
  const chunks: Buffer[] = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  expect(text).toContain("SOLA-01");
  expect(text).not.toContain("0012");
});

test("Crear con un código existente: «Ya existe» con enlace «Abrir prenda existente» que abre su ficha", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Nuevo" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Código de prenda").fill("11as001");
  await dialog.getByLabel("Código de almacén").fill("UNF1");
  await dialog.getByLabel("Nombre de la prenda").fill("OTRA COSA");
  await dialog.getByLabel("Precio unitario").fill("5");
  await dialog.getByRole("button", { name: "Crear registro" }).click();
  await expect(dialog.getByText("Ya existe una prenda con ese código")).toBeVisible();
  await dialog.getByRole("button", { name: "Abrir prenda existente" }).click();
  const editing = page.getByRole("dialog");
  await expect(editing.getByRole("heading", { name: "Editar prenda" })).toBeVisible();
  await expect(editing.getByLabel("Código de prenda")).toHaveValue("11AS001");
  await expect(editing.getByLabel("Nombre de la prenda")).toHaveValue("CHALECO SIN ASIGNAR");
  await expect(editing.getByRole("button", { name: "Agregar asignación" })).toBeVisible();
});

test("Crear una prenda sin asignaciones a propósito está permitido y queda visible como «Sin asignar»", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Nuevo" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/aparecerá en la lista como «Sin asignar»/)).toBeVisible();
  await dialog.getByLabel("Código de prenda").fill("NUEVA-1");
  await dialog.getByLabel("Código de almacén").fill("UNF1");
  await dialog.getByLabel("Nombre de la prenda").fill("PRENDA NUEVA SIN ASIGNAR");
  await dialog.getByLabel("Precio unitario").fill("12");
  await dialog.getByRole("button", { name: "Crear registro" }).click();
  await expect(page.getByText("Prenda creada correctamente")).toBeVisible();
  const row = article(page, "NUEVA-1");
  await expect(row).toBeVisible();
  await expect(row.getByText("Sin asignar", { exact: true })).toBeVisible();
});

for (const [width, height] of responsiveViewports) test(`Filtros de prendas sin desbordes ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const search = (await page.getByLabel("Buscar en prendas").boundingBox())!;
  const selects = page.getByTestId("filtros-prendas").locator("select");
  expect(await selects.count()).toBe(6);
  if (width < 640) {
    // en celular: apilados (un filtro por fila) y todos con el ancho de la búsqueda
    const boxes = await selects.evaluateAll(list => list.map(el => { const r = el.getBoundingClientRect(); return { y: r.top, w: r.width }; }));
    expect(new Set(boxes.map(b => Math.round(b.y))).size).toBe(6);
    for (const b of boxes) expect(Math.abs(b.w - search.width)).toBeLessThan(3);
  }
});

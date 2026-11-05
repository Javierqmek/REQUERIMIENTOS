import { test, expect, type Page } from "@playwright/test";
import { responsiveViewports } from "./viewports";

const PUESTO_A = "77000000-0000-4000-8000-0000000000a1";
const PUESTO_B = "77000000-0000-4000-8000-0000000000a2";

async function pickAgent(page: Page) {
  await page.goto("/requerimientos/nuevo");
  await page.getByLabel("Buscar agente").fill("María");
  await page.getByRole("button", { name: /MARÍA AGENTE OPERATIVA/ }).click();
}
const rpcCalls = (page: Page, name: string) => page.evaluate((n) => ((window as unknown as { __rpcCalls?: { name: string; args: Record<string, unknown> }[] }).__rpcCalls ?? []).filter(c => c.name === n), name);

test("BCR (con puestos): el puesto es obligatorio, va antes de Género y define las prendas y la cantidad", async ({ page }) => {
  await pickAgent(page);
  await page.getByLabel("Cliente").selectOption({ label: "BCR" });
  await page.getByLabel("Unidad").selectOption({ label: "BCR SEDE CENTRAL" });
  const puesto = page.getByLabel("Puesto", { exact: true });
  await expect(puesto).toBeVisible();
  await expect(puesto).toHaveAttribute("required", "");
  // orden en pantalla: Renovación, Puesto, Género
  const puestoBox = (await puesto.boundingBox())!, hombreBox = (await page.getByRole("radio", { name: "Hombre" }).boundingBox())!;
  expect(puestoBox.y).toBeLessThan(hombreBox.y);
  await page.getByRole("radio", { name: "Hombre" }).click();
  await expect(page.getByText("Selecciona un puesto para ver las prendas disponibles.")).toBeVisible();
  await expect(page.getByLabel("Prenda", { exact: true })).toBeDisabled();

  await puesto.selectOption(PUESTO_A);
  const prenda = page.getByLabel("Prenda", { exact: true });
  await expect(prenda.locator("option", { hasText: "CAMISA BLANCA MANGA CORTA · Cant. 2" })).toHaveCount(1);
  await prenda.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Agregar" }).click();
  await expect(page.getByText("Cantidad 2")).toBeVisible();

  // cambiar de puesto cambia las cantidades: pide confirmación y vuelve a empezar
  await puesto.selectOption(PUESTO_B);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("¿Cambiar el puesto?")).toBeVisible();
  await dialog.getByRole("button", { name: "Sí, continuar" }).click();
  await expect(page.getByText("Todavía no agregaste prendas.")).toBeVisible();
  await expect(prenda.locator("option", { hasText: "Cant. 3" })).toHaveCount(1);
  await prenda.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Agregar" }).click();
  await expect(page.getByText("Cantidad 3")).toBeVisible();
  await page.getByRole("button", { name: "Guardar requerimiento" }).click();
  await expect(page.getByText("Requerimiento registrado")).toBeVisible();
  const [call] = await rpcCalls(page, "crear_requerimiento");
  expect(call.args).toMatchObject({ p_puesto_id: PUESTO_B, p_genero: "HOMBRE", p_renovacion: "VERANO" });
});

test("RENIEC (sin puestos): el formulario queda como antes, sin campo Puesto y sin puesto en la solicitud", async ({ page }) => {
  await pickAgent(page);
  await page.getByLabel("Cliente").selectOption({ label: "RENIEC" });
  await page.getByLabel("Unidad").selectOption({ label: "OFICINA REGISTRAL ATE" });
  await expect(page.getByLabel("Puesto", { exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: "Hombre" }).click();
  await page.getByLabel("Prenda", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Agregar" }).click();
  await page.getByRole("button", { name: "Guardar requerimiento" }).click();
  await expect(page.getByText("Requerimiento registrado")).toBeVisible();
  const [call] = await rpcCalls(page, "crear_requerimiento");
  expect(call.args.p_puesto_id).toBeNull();
  const lists = await rpcCalls(page, "listar_prendas_cliente");
  expect(lists.every(c => c.args.p_puesto_id === null)).toBe(true);
});

test("BCR: al cambiar de cliente se limpia el puesto elegido", async ({ page }) => {
  await pickAgent(page);
  await page.getByLabel("Cliente").selectOption({ label: "BCR" });
  await page.getByLabel("Unidad").selectOption({ label: "BCR SEDE CENTRAL" });
  await page.getByLabel("Puesto", { exact: true }).selectOption(PUESTO_A);
  await page.getByLabel("Cliente").selectOption({ label: "RENIEC" });
  await expect(page.getByLabel("Puesto", { exact: true })).toHaveCount(0);
  await page.getByLabel("Cliente").selectOption({ label: "BCR" });
  await page.getByLabel("Unidad").selectOption({ label: "BCR SEDE CENTRAL" });
  await expect(page.getByLabel("Puesto", { exact: true })).toHaveValue("");
});

test("Mantenimiento → Clientes: se ve y se edita 'Diferencia prendas por puesto'", async ({ page }) => {
  await page.goto("/admin/mantenimiento");
  const bcr = page.getByRole("article").filter({ hasText: "BCR" });
  await expect(bcr.getByText("Diferencia por puesto")).toBeVisible();
  await expect(bcr.getByText("Sí", { exact: true })).toBeVisible();
  await page.getByLabel("Acciones de RENIEC").click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const dialog = page.getByRole("dialog");
  const box = dialog.getByLabel("Diferencia prendas por puesto");
  await expect(box).not.toBeChecked();
  await box.check();
  const request = page.waitForRequest(r => r.url().endsWith("/api/admin/catalogos") && r.method() === "PUT");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  expect((await request).postDataJSON().valores).toMatchObject({ nombre: "RENIEC", diferencia_puestos: true });
});

test("Mantenimiento → Puestos: solo se ofrecen los clientes con la opción y el puesto se crea y desactiva", async ({ page }) => {
  await page.goto("/admin/mantenimiento");
  await page.getByRole("tab", { name: "Puestos" }).click();
  await expect(page.getByText("Vigilante Masculino (Terno)")).toBeVisible();
  await page.getByRole("button", { name: "Nuevo" }).click();
  const dialog = page.getByRole("dialog");
  const cliente = dialog.locator('select[name="cliente_id"]');
  await expect(cliente.locator("option")).toHaveText(["Selecciona un cliente", "BCR"]);
  await cliente.selectOption({ label: "BCR" });
  await dialog.getByLabel("Nombre del puesto").fill("Supervisor");
  const request = page.waitForRequest(r => r.url().endsWith("/api/admin/catalogos") && r.method() === "POST");
  await dialog.getByRole("button", { name: "Crear registro" }).click();
  expect((await request).postDataJSON()).toMatchObject({ catalogo: "puestos", valores: { nombre: "Supervisor" } });
  await expect(page.getByText("Puesto creado correctamente")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Supervisor" })).toBeVisible();
  await page.getByLabel("Acciones de Supervisor").click();
  await page.getByRole("menuitem", { name: "Desactivar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, desactivar" }).click();
  await expect(page.getByRole("article").filter({ hasText: "Supervisor" }).getByText("Inactivo")).toBeVisible();
});

test("Mantenimiento → Prendas: una asignación de BCR exige el puesto; las de clientes sin puestos no lo muestran", async ({ page }) => {
  await page.goto("/admin/mantenimiento");
  await page.getByRole("tab", { name: "Prendas" }).click();
  await page.getByLabel("Acciones de CAMISA OPERATIVA MANGA LARGA").click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const dialog = page.getByRole("dialog");
  const rows = dialog.getByTestId("asignaciones").getByRole("listitem");
  await expect(rows.first().getByLabel("Puesto de la asignación")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Agregar asignación" }).click();
  const added = rows.last();
  await added.getByLabel("Cliente de la asignación").selectOption({ label: "BCR" });
  const puesto = added.getByLabel("Puesto de la asignación");
  await expect(puesto).toHaveAttribute("required", "");
  await expect(puesto.locator("option")).toHaveText(["Selecciona un puesto", "Vigilante Masculino", "Vigilante Masculino (Terno)"]);
  await puesto.selectOption({ label: "Vigilante Masculino (Terno)" });
  await added.getByLabel("Cantidad de la asignación").fill("3");
  const request = page.waitForRequest(r => r.url().endsWith("/api/admin/catalogos") && r.method() === "PUT");
  await dialog.getByRole("button", { name: "Guardar cambios" }).click();
  const asignaciones = (await request).postDataJSON().valores.asignaciones;
  expect(asignaciones[0]).not.toHaveProperty("puesto_id");
  expect(asignaciones.at(-1)).toMatchObject({ puesto_id: PUESTO_B, cantidad: 3 });
  await expect(page.getByText("Vigilante Masculino (Terno) · Ambos")).toBeVisible();
});

test("Mantenimiento → Prendas: 'Exportar prendas' descarga el CSV (todo, o solo el cliente filtrado) en UTF-8 con BOM", async ({ page }) => {
  await page.goto("/admin/mantenimiento");
  await expect(page.getByRole("link", { name: "Exportar prendas" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Prendas" }).click();
  const link = page.getByRole("link", { name: "Exportar prendas" });
  await expect(link).toHaveAttribute("href", "/api/admin/prendas/exportar");
  let [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toBe("prendas-todos-2026-11-05.csv");
  const read = async (d: typeof download) => { const stream = await d.createReadStream(); const chunks: Buffer[] = []; for await (const c of stream) chunks.push(c as Buffer); return Buffer.concat(chunks); };
  let bytes = await read(download);
  expect([...bytes.subarray(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);
  let text = bytes.toString("utf8").slice(1);
  expect(text.split("\r\n")[0]).toBe('"codigo_prenda";"nombre_prenda";"codigo_almacen";"precio";"cantidad";"cliente";"puesto";"genero";"renovacion";"activo"');
  expect(text).toContain('"=""0012"""');
  expect(text).toContain("SOLA-01");

  await page.getByLabel("Filtrar por cliente").selectOption({ label: "BCR" });
  await expect(link).toHaveAttribute("href", /\/api\/admin\/prendas\/exportar\?cliente=/);
  [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toBe("prendas-bcr-2026-11-05.csv");
  bytes = await read(download); text = bytes.toString("utf8");
  expect(text).not.toContain("SOLA-01");
});

for (const [width, height] of responsiveViewports) test(`Requerimiento con puesto sin desbordes ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await pickAgent(page);
  await page.getByLabel("Cliente").selectOption({ label: "BCR" });
  await page.getByLabel("Unidad").selectOption({ label: "BCR SEDE CENTRAL" });
  await page.getByLabel("Puesto", { exact: true }).selectOption(PUESTO_A);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

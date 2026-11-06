import { test, expect, type Page } from "@playwright/test";
import { editGarments, fixtureEdit } from "../fixtures/edit";
import { responsiveViewports } from "./viewports";

const edit = fixtureEdit().requerimiento;
const path = `/requerimientos/${edit.id}/editar`;
const patchRequests = (page: Page) => {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", r => { if (r.url().endsWith("/cabecera") && r.method() === "PATCH") bodies.push(r.postDataJSON()); });
  return bodies;
};
const rpcCalls = (page: Page, name: string) => page.evaluate((n) => ((window as unknown as { __rpcCalls?: { name: string; args: Record<string, unknown> }[] }).__rpcCalls ?? []).filter(c => c.name === n), name);

test("Editar: se ve el cargo actual del agente y la renovación; sin cambios no se puede guardar", async ({ page }) => {
  await page.goto(path);
  const section = page.getByRole("region", { name: "Renovación y cargo" });
  await expect(section.getByRole("radio", { name: "Verano" })).toHaveAttribute("aria-checked", "true");
  const cargo = section.getByLabel("Cargo del agente");
  await expect(cargo).toHaveValue("AGENTE DE SEGURIDAD");
  await expect(cargo.locator("option")).toHaveText(["AGENTE DE SEGURIDAD", "SUPERVISOR"]);
  await expect(section.getByRole("button", { name: "Guardar renovación y cargo" })).toBeDisabled();
});

test("Editar: cambiar solo el cargo envía únicamente el cargo y actualiza la pantalla", async ({ page }) => {
  const bodies = patchRequests(page);
  await page.goto(path);
  const section = page.getByRole("region", { name: "Renovación y cargo" });
  await section.getByLabel("Cargo del agente").selectOption("SUPERVISOR");
  await section.getByRole("button", { name: "Guardar renovación y cargo" }).click();
  await expect(section.getByText("Datos actualizados correctamente.")).toBeVisible();
  expect(bodies).toEqual([{ cargo: "SUPERVISOR" }]);
  await expect(page.getByText("SUPERVISOR", { exact: true }).first()).toBeVisible();
  await expect(section.getByRole("button", { name: "Guardar renovación y cargo" })).toBeDisabled();
});

test("Editar: una renovación que deja prendas fuera pide confirmar la lista y luego las quita", async ({ page }) => {
  const bodies = patchRequests(page);
  await page.goto(path);
  const section = page.getByRole("region", { name: "Renovación y cargo" });
  await section.getByRole("radio", { name: "Invierno" }).click();
  await section.getByRole("button", { name: "Guardar renovación y cargo" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("¿Quitar las prendas que no corresponden a la nueva renovación?")).toBeVisible();
  await expect(dialog.getByText(new RegExp(editGarments[0].nombre_prenda))).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  expect(bodies).toEqual([{ renovacion: "INVIERNO" }]);
  await section.getByRole("button", { name: "Guardar renovación y cargo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, cambiar y quitar" }).click();
  await expect(section.getByText(/El requerimiento quedó sin prendas/)).toBeVisible();
  expect(bodies.at(-1)).toEqual({ renovacion: "INVIERNO", lineas_confirmadas: [edit.detalle_requerimiento[0].id] });
  await expect(page.getByText("Invierno", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Agrega al menos una prenda para guardar los cambios.")).toBeVisible();
});

test("Editar: un cargo rechazado por el servidor muestra su mensaje", async ({ page }) => {
  await page.goto(path);
  const section = page.getByRole("region", { name: "Renovación y cargo" });
  // el mock solo ofrece cargos activos; se fuerza el valor inactivo para comprobar el mensaje del servidor
  await section.getByLabel("Cargo del agente").evaluate((el: HTMLSelectElement) => { const o = document.createElement("option"); o.value = "DESCANSERO"; o.textContent = "DESCANSERO"; el.appendChild(o); });
  await section.getByLabel("Cargo del agente").selectOption("DESCANSERO");
  await section.getByRole("button", { name: "Guardar renovación y cargo" }).click();
  await expect(section.getByText("El cargo está inactivo: elige un cargo activo")).toBeVisible();
});

test("Editar: los cambios de prendas sin guardar bloquean el cambio de cabecera (no se pierden)", async ({ page }) => {
  await page.goto(path);
  await page.getByRole("button", { name: `Retirar ${editGarments[0].nombre_prenda}` }).click();
  const section = page.getByRole("region", { name: "Renovación y cargo" });
  await section.getByLabel("Cargo del agente").selectOption("SUPERVISOR");
  await expect(section.getByText(/Tienes cambios de prendas sin guardar/)).toBeVisible();
  await expect(section.getByRole("button", { name: "Guardar renovación y cargo" })).toBeDisabled();
});

for (const role of ["coordinador", "admin"]) test(`Atendido: no hay controles de renovación ni cargo (${role})`, async ({ page }) => {
  await page.goto(path + `?estado=Atendido&role=${role}`);
  await expect(page.getByRole("region", { name: "Renovación y cargo" })).toHaveCount(0);
  await expect(page.getByText("Este requerimiento ya fue atendido y no puede modificarse.", { exact: true })).toBeVisible();
});

test("Nuevo requerimiento: el cargo del agente viene precargado, se puede cambiar y viaja al guardar", async ({ page }) => {
  await page.goto("/requerimientos/nuevo");
  await page.getByLabel("Buscar agente").fill("María");
  await page.getByRole("button", { name: /MARÍA AGENTE OPERATIVA/ }).click();
  const cargo = page.getByLabel("Cargo", { exact: true });
  await expect(cargo).toHaveValue("AGENTE");
  await expect(cargo.locator("option")).toHaveText(["AGENTE DE SEGURIDAD", "SUPERVISOR", "AGENTE (inactivo)"]);
  await cargo.selectOption("SUPERVISOR");
  await page.getByLabel("Cliente").selectOption({ label: "RENIEC" });
  await page.getByLabel("Unidad").selectOption({ label: "OFICINA REGISTRAL ATE" });
  await page.getByRole("radio", { name: "Hombre" }).click();
  await page.getByLabel("Prenda", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Agregar" }).click();
  await page.getByRole("button", { name: "Guardar requerimiento" }).click();
  await expect(page.getByText("Requerimiento registrado")).toBeVisible();
  const [call] = await rpcCalls(page, "crear_requerimiento");
  expect(call.args.p_cargo).toBe("SUPERVISOR");
});

test("Mantenimiento → Cargos: se listan, se crean y la persona elige su cargo de la lista", async ({ page }) => {
  await page.goto("/admin/mantenimiento");
  await page.getByRole("tab", { name: "Cargos" }).click();
  await expect(page.getByRole("article").filter({ hasText: "SUPERVISOR" })).toContainText("Personas");
  await page.getByRole("button", { name: "Nuevo" }).click();
  await page.getByRole("dialog").getByLabel("Nombre del cargo").fill("AGENTE NOCHE");
  const request = page.waitForRequest(r => r.url().endsWith("/api/admin/catalogos") && r.method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "Crear registro" }).click();
  expect((await request).postDataJSON()).toMatchObject({ catalogo: "cargos", valores: { nombre: "AGENTE NOCHE" } });
  await expect(page.getByText("Cargo creado correctamente")).toBeVisible();
  await page.getByRole("tab", { name: "Personal" }).click();
  await page.getByLabel(/^Acciones de /).first().click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const select = page.getByRole("dialog").locator('select[name="cargo"]');
  await expect(select).toBeVisible();
  await expect(select.locator("option")).toContainText(["Selecciona un cargo", "AGENTE DE SEGURIDAD", "SUPERVISOR", "AGENTE NOCHE"]);
});

for (const [width, height] of responsiveViewports) test(`Edición con renovación y cargo sin desbordes ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await page.goto(path);
  await expect(page.getByRole("region", { name: "Renovación y cargo" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

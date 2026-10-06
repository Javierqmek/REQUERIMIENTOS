import {test,expect} from "@playwright/test";
import {responsiveViewports} from "./viewports";

for(const [width,height] of responsiveViewports)test(`Mantenimiento responsive ${width}x${height}`,async({page})=>{
  await page.setViewportSize({width,height});await page.goto("/admin/mantenimiento");
  await expect(page.getByRole("heading",{name:"Mantenimiento"})).toBeVisible();await expect(page.getByRole("tab",{name:"Clientes"})).toHaveAttribute("aria-selected","true");
  await expect(page.getByText("RENIEC",{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole("tab",{name:"Prendas"}).click();await expect(page.getByLabel("Filtrar por género")).toBeVisible();await expect(page.getByText("CAMISA OPERATIVA MANGA LARGA",{exact:true})).toBeVisible();
});

test("mantenimiento confirma baja lógica",async({page})=>{await page.goto("/admin/mantenimiento");await page.getByLabel("Acciones de RENIEC").click();await page.getByRole("menuitem",{name:"Desactivar"}).click();await expect(page.getByRole("dialog")).toContainText("requerimientos históricos");await page.getByRole("button",{name:"Sí, desactivar"}).click();await expect(page.getByText("Registro desactivado correctamente")).toBeVisible();});

test("crea, edita y elimina un cliente sin relaciones",async({page})=>{
  await page.goto("/admin/mantenimiento");await page.getByRole("button",{name:"Nuevo"}).click();
  await page.getByLabel("Nombre del cliente").fill("CLIENTE VISUAL QA");await page.getByRole("button",{name:"Crear registro"}).click();
  await expect(page.getByText("Cliente creado correctamente")).toBeVisible();await expect(page.getByText("CLIENTE VISUAL QA",{exact:true})).toBeVisible();
  await page.getByLabel("Acciones de CLIENTE VISUAL QA").click();await page.getByRole("menuitem",{name:"Editar"}).click();
  await page.getByLabel("Nombre del cliente").fill("CLIENTE VISUAL EDITADO");await page.getByRole("button",{name:"Guardar cambios"}).click();
  await expect(page.getByText("CLIENTE VISUAL EDITADO",{exact:true})).toBeVisible();
  await page.getByLabel("Acciones de CLIENTE VISUAL EDITADO").click();await page.getByRole("menuitem",{name:"Eliminar definitivamente"}).click();
  await expect(page.getByRole("dialog")).toContainText("no tiene información asociada");await page.getByRole("button",{name:"Sí, eliminar definitivamente"}).click();
  await expect(page.getByText("Registro eliminado definitivamente")).toBeVisible();
});

test("provincias: admin lista, busca, crea, edita, desactiva y reactiva; sin borrado físico",async({page})=>{
  await page.goto("/admin/mantenimiento");await page.getByRole("tab",{name:"Provincias"}).click();
  await expect(page.getByText("Lima",{exact:true})).toBeVisible();await expect(page.getByText("Arequipa",{exact:true})).toBeVisible();
  await page.getByLabel("Buscar en provincias").fill("Arequipa");
  await expect(page.getByText("Lima",{exact:true})).toHaveCount(0);await expect(page.getByText("Arequipa",{exact:true})).toBeVisible();
  await page.getByLabel("Buscar en provincias").fill("");
  await page.getByRole("button",{name:"Nuevo"}).click();await page.getByLabel("Nombre de la provincia").fill("Puno");
  await page.getByRole("button",{name:"Crear registro"}).click();
  await expect(page.getByText("Provincia creada correctamente")).toBeVisible();await expect(page.getByText("Puno",{exact:true})).toBeVisible();
  await page.getByLabel("Acciones de Puno").click();await page.getByRole("menuitem",{name:"Editar"}).click();
  await page.getByLabel("Nombre de la provincia").fill("Puno Editado");await page.getByRole("button",{name:"Guardar cambios"}).click();
  await expect(page.getByText("Puno Editado",{exact:true})).toBeVisible();
  await page.getByLabel("Acciones de Puno Editado").click();await expect(page.getByRole("menuitem",{name:"Eliminar definitivamente"})).toHaveCount(0);
  await page.getByRole("menuitem",{name:"Desactivar"}).click();await page.getByRole("button",{name:"Sí, desactivar"}).click();
  await expect(page.getByText("Registro desactivado correctamente")).toBeVisible();
  await page.getByLabel("Acciones de Puno Editado").click();await page.getByRole("menuitem",{name:"Activar"}).click();await page.getByRole("button",{name:"Sí, activar"}).click();
  await expect(page.getByText("Registro activado correctamente")).toBeVisible();
});

test("formularios de unidad, personal y prenda son compactos y completos",async({page})=>{
  await page.setViewportSize({width:320,height:700});await page.goto("/admin/mantenimiento");
  await page.getByRole("tab",{name:"Unidades"}).click();await page.getByRole("button",{name:"Nuevo"}).click();await expect(page.getByLabel("Nombre de unidad / sede")).toBeVisible();await page.getByLabel("Cerrar formulario").click();
  await page.getByRole("tab",{name:"Personal"}).click();await page.getByRole("button",{name:"Nuevo"}).click();await expect(page.getByLabel("Código de personal")).toBeVisible();await expect(page.getByLabel("DNI")).toBeVisible();await page.getByLabel("Cerrar formulario").click();
  await page.getByRole("tab",{name:"Prendas"}).click();await page.getByRole("button",{name:"Nuevo"}).click();await expect(page.getByLabel("Precio unitario")).toBeVisible();await expect(page.getByTestId("asignaciones")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("Unidades guardan la renovación por defecto",async({page})=>{
  await page.goto("/admin/mantenimiento");
  await page.getByRole("tab",{name:"Unidades"}).click();
  await expect(page.getByText("Renovación por defecto").first()).toBeVisible();
  await page.getByRole("button",{name:"Nuevo"}).click();
  await expect(page.getByLabel("Renovación por defecto")).toHaveValue("VERANO");
  await expect(page.getByLabel("Renovación por defecto").locator("option")).toHaveText(["Verano","Invierno"]);
  await page.locator(`select[name="cliente_id"]`).selectOption({label:"RENIEC"});
  await page.getByLabel("Nombre de unidad / sede").fill("Sede de invierno");
  await page.getByLabel("Renovación por defecto").selectOption("INVIERNO");
  const request=page.waitForRequest(r=>r.url().endsWith("/api/admin/catalogos")&&r.method()==="POST");
  await page.getByRole("button",{name:"Crear registro"}).click();
  expect((await request).postDataJSON().valores).toMatchObject({nombre:"Sede de invierno",renovacion_defecto:"INVIERNO"});
});

test("Prendas: la ficha muestra y edita sus asignaciones por cliente y renovación",async({page})=>{
  await page.goto("/admin/mantenimiento");
  await page.getByRole("tab",{name:"Prendas"}).click();
  const camisa=page.getByRole("article").filter({hasText:"CAMISA OPERATIVA MANGA LARGA"});
  await expect(camisa.getByLabel("Asignaciones").getByText("RENIEC · Ambos · Hombre · ×5")).toBeVisible();
  await page.getByLabel("Filtrar por cliente").selectOption({label:"RENIEC"});
  await expect(camisa).toBeVisible();
  await page.getByLabel("Filtrar por cliente").selectOption({label:"CLIENTE CON NOMBRE CORPORATIVO EXTENSO"});
  await expect(page.getByText("No hay registros con estos filtros.")).toBeVisible();
  await page.getByLabel("Filtrar por cliente").selectOption("");
  await page.getByLabel("Acciones de CAMISA OPERATIVA MANGA LARGA").click();
  await page.getByRole("menuitem",{name:"Editar"}).click();
  const dialog=page.getByRole("dialog");
  const rows=dialog.getByTestId("asignaciones").getByRole("listitem");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByLabel("Cliente de la asignación")).toBeDisabled();
  await rows.first().getByLabel("Cantidad de la asignación").fill("7");
  await dialog.getByRole("button",{name:"Agregar asignación"}).click();
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByLabel("Cliente de la asignación").selectOption({label:"CLIENTE CON NOMBRE CORPORATIVO EXTENSO"});
  await rows.nth(1).getByLabel("Renovación de la asignación").selectOption("INVIERNO");
  await rows.nth(1).getByLabel("Género de la asignación").selectOption("MUJER");
  await rows.nth(1).getByLabel("Cantidad de la asignación").fill("3");
  const request=page.waitForRequest(r=>r.url().endsWith("/api/admin/catalogos")&&r.method()==="PUT");
  await dialog.getByRole("button",{name:"Guardar cambios"}).click();
  const sent=(await request).postDataJSON().valores;
  expect(sent.asignaciones).toHaveLength(2);
  expect(sent.asignaciones[0]).toMatchObject({cantidad:7,renovacion:"AMBOS",genero:"HOMBRE",activo:true});
  expect(sent.asignaciones[0].id).toBeTruthy();
  expect(sent.asignaciones[1]).toMatchObject({cliente_id:"55000000-0000-4000-8000-000000000002",renovacion:"INVIERNO",genero:"MUJER",cantidad:3,activo:true});
  expect(sent.asignaciones[1].id).toBeUndefined();
  expect(sent).not.toHaveProperty("cantidad");expect(sent).not.toHaveProperty("cliente_id");
  await expect(camisa.getByLabel("Asignaciones").getByText("RENIEC · Ambos · Hombre · ×7")).toBeVisible();
  await expect(camisa.getByLabel("Asignaciones").getByText("CLIENTE CON NOMBRE CORPORATIVO EXTENSO · Invierno · Mujer · ×3")).toBeVisible();
});

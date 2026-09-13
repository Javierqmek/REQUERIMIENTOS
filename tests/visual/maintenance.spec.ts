import {test,expect} from "@playwright/test";

for(const [width,height] of [[1440,900],[1366,768],[390,844],[375,812],[320,700]])test(`Mantenimiento responsive ${width}x${height}`,async({page})=>{
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

test("formularios de unidad, personal y prenda son compactos y completos",async({page})=>{
  await page.setViewportSize({width:320,height:700});await page.goto("/admin/mantenimiento");
  await page.getByRole("tab",{name:"Unidades"}).click();await page.getByRole("button",{name:"Nuevo"}).click();await expect(page.getByLabel("Nombre de unidad / sede")).toBeVisible();await page.getByLabel("Cerrar formulario").click();
  await page.getByRole("tab",{name:"Personal"}).click();await page.getByRole("button",{name:"Nuevo"}).click();await expect(page.getByLabel("Código de personal")).toBeVisible();await expect(page.getByLabel("DNI")).toBeVisible();await page.getByLabel("Cerrar formulario").click();
  await page.getByRole("tab",{name:"Prendas"}).click();await page.getByRole("button",{name:"Nuevo"}).click();await expect(page.getByLabel("Precio unitario")).toBeVisible();await expect(page.getByLabel("Cantidad fija")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

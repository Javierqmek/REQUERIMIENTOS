import {test,expect} from "@playwright/test";

for(const [width,height] of [[1440,900],[1366,768],[390,844],[375,812],[320,700]])test(`Mantenimiento responsive ${width}x${height}`,async({page})=>{
  await page.setViewportSize({width,height});await page.goto("/admin/mantenimiento");
  await expect(page.getByRole("heading",{name:"Mantenimiento"})).toBeVisible();await expect(page.getByRole("tab",{name:"Clientes"})).toHaveAttribute("aria-selected","true");
  await expect(page.getByText("RENIEC",{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole("tab",{name:"Prendas"}).click();await expect(page.getByLabel("Filtrar por género")).toBeVisible();await expect(page.getByText("CAMISA OPERATIVA MANGA LARGA",{exact:true})).toBeVisible();
});

test("mantenimiento confirma baja lógica",async({page})=>{await page.goto("/admin/mantenimiento");await page.getByRole("button",{name:"Desactivar"}).first().click();await expect(page.getByRole("dialog")).toContainText("requerimientos históricos");await page.getByRole("button",{name:"Sí, desactivar"}).click();await expect(page.getByText("Registro desactivado correctamente")).toBeVisible();});

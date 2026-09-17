import { test, expect } from "@playwright/test";
import { responsiveViewports } from "./viewports";

for (const [width,height] of responsiveViewports) test(`Mis requerimientos total responsive ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width,height });
  await page.goto("/requerimientos");
  await page.getByRole("button",{name:"Filtros · Todos los requerimientos"}).click();
  await expect(page.getByLabel("Género de prenda")).toBeVisible();
  await expect(page.getByLabel("Unidades mín.")).toBeVisible();
  await expect(page.getByText("Total", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("S/ 40.00", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.qa/requirements-total-${width}x${height}.png`, fullPage: false });
});

test("coordinador combina cliente, sede, Observado, género, prendas y unidades",async({page})=>{
  await page.goto("/requerimientos");
  await page.getByRole("button",{name:"Filtros · Todos los requerimientos"}).click();
  await page.getByLabel("Cliente",{exact:true}).selectOption("55000000-0000-4000-8000-000000000001");
  await page.getByLabel("Unidad / Sede",{exact:true}).selectOption("66000000-0000-4000-8000-000000000001");
  await page.getByLabel("Estado",{exact:true}).selectOption("Observado");
  await page.getByLabel("Género de prenda").selectOption("AMBOS");
  await page.getByLabel("Prendas mín.").fill("1");await page.getByLabel("Prendas máx.").fill("4");
  await page.getByLabel("Unidades mín.").fill("3");await page.getByLabel("Unidades máx.").fill("6");
  const response=page.waitForResponse(value=>new URL(value.url()).pathname==="/api/requerimientos");
  await page.getByRole("button",{name:"Aplicar filtros"}).click();
  await response;
  await expect(page.getByRole("button",{name:/Observado/}).first()).toBeVisible();
  await expect(page.getByText(/prendas · \d+ unidades/).first()).toBeVisible();
  const cleared=page.waitForResponse(value=>new URL(value.url()).pathname==="/api/requerimientos");
  await page.getByRole("button",{name:"Limpiar filtros"}).click();
  await cleared;
  await expect(page.getByRole("button",{name:"Filtros · Todos los requerimientos"})).toBeVisible();
});

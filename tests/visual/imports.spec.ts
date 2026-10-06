import {test,expect} from "@playwright/test";
import {responsiveViewports} from "./viewports";
const csv="codigo_personal,nombre,dni,cargo,activo\nP-1,Ana Pérez,12345678,Agente,true";

for(const [width,height] of responsiveViewports)test(`Importaciones responsive ${width}x${height}`,async({page})=>{await page.setViewportSize({width,height});await page.goto("/admin/importaciones");await expect(page.getByRole("heading",{name:"Importaciones"})).toBeVisible();await page.locator('input[type=file]').setInputFiles({name:"personal.csv",mimeType:"text/csv",buffer:Buffer.from(csv)});await page.getByRole("button",{name:"Validar y previsualizar"}).click();await expect(page.getByRole("heading",{name:"Vista previa"})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);});

test("importación no guarda antes de confirmar",async({page})=>{await page.goto("/admin/importaciones");let calls=0;page.on("request",request=>{if(request.url().endsWith("/api/admin/importaciones")&&request.method()==="POST")calls++});await page.locator('input[type=file]').setInputFiles({name:"personal.csv",mimeType:"text/csv",buffer:Buffer.from(csv)});await page.getByRole("button",{name:"Validar y previsualizar"}).click();expect(calls).toBe(1);await page.getByRole("button",{name:"Confirmar importación"}).click();await expect(page.getByRole("dialog")).toBeVisible();expect(calls).toBe(1);await page.getByRole("button",{name:"Sí, importar"}).click();await expect(page.getByText(/Importación completada/)).toBeVisible();expect(calls).toBe(2);});

const prendasCsv=(rows:string[])=>["codigo_prenda,nombre_prenda,codigo_almacen,precio,cantidad,genero,Renovación,activo",...rows].join("\r\n");
const RENIEC_ID="55000000-0000-4000-8000-000000000001";
async function loadPrendas(page:import("@playwright/test").Page,rows:string[],encoding:"utf8"|"latin1"="latin1"){
  await page.goto("/admin/importaciones");
  await page.getByLabel("Catálogo").selectOption("prendas");
  await page.getByLabel("Cliente del archivo").selectOption({label:"RENIEC"});
  await page.locator("input[type=file]").setInputFiles({name:"prendas-reniec.csv",mimeType:"text/csv",buffer:Buffer.from(prendasCsv(rows),encoding)});
  const request=page.waitForRequest(r=>r.url().endsWith("/api/admin/importaciones"));
  await page.getByRole("button",{name:"Validar y previsualizar"}).click();
  return (await request).postDataJSON();
}

test("Prendas: archivo de un cliente en Windows-1252 conserva tildes y muestra la alerta de precio",async({page})=>{
  const body=await loadPrendas(page,["CAM001,Camisa Ñandú áéíóú,UNF1 ,45,4,Hombre,Verano,sí","COR001,Corbata,UNF2,15,10,Ambos,AMBOS,sí"]);
  expect(body).toMatchObject({kind:"prendas",cliente_id:RENIEC_ID,mode:"preview",reemplazar:false,actualizar:{}});
  expect(body.rows[0].nombre_prenda).toBe("Camisa Ñandú áéíóú");
  expect(body.headers).toContain("renovación");
  await expect(page.getByRole("heading",{name:/Vista previa · RENIEC/})).toBeVisible();
  const alerts=page.getByTestId("alertas-ficha");
  await expect(alerts.getByText("Precio actual S/ 40.00, en el archivo S/ 45.00")).toBeVisible();
  await expect(alerts.getByLabel("Qué hacer con CAM001")).toHaveValue("mantener");
  for(const label of ["Prendas nuevas","Asignaciones nuevas","Cantidades actualizadas","Alertas de ficha","Errores"])await expect(page.getByText(label,{exact:true})).toBeVisible();
});

test("Prendas: UTF-8 también se lee bien",async({page})=>{
  const body=await loadPrendas(page,["CAM001,Camisa Ñandú áéíóú,UNF1,45,4,Hombre,Verano,sí"],"utf8");
  expect(body.rows[0].nombre_prenda).toBe("Camisa Ñandú áéíóú");
});

test("Prendas: Mantener actual por defecto; Actualizar se envía solo para el código elegido",async({page})=>{
  await loadPrendas(page,["CAM001,Camisa,UNF1,45,4,Hombre,Verano,sí"]);
  await page.getByRole("button",{name:"Confirmar importación"}).click();
  let request=page.waitForRequest(r=>r.url().endsWith("/api/admin/importaciones"));
  await page.getByRole("dialog").getByRole("button",{name:"Sí, importar"}).click();
  expect((await request).postDataJSON()).toMatchObject({mode:"apply",actualizar:{},reemplazar:false});
  await expect(page.getByText(/Importación completada: 2 asignaciones nuevas, 1 actualizadas/)).toBeVisible();
  await loadPrendas(page,["CAM001,Camisa,UNF1,45,4,Hombre,Verano,sí"]);
  await page.getByLabel("Qué hacer con CAM001").selectOption("ahora");
  await page.getByRole("button",{name:"Confirmar importación"}).click();
  request=page.waitForRequest(r=>r.url().endsWith("/api/admin/importaciones"));
  await page.getByRole("dialog").getByRole("button",{name:"Sí, importar"}).click();
  expect((await request).postDataJSON()).toMatchObject({mode:"apply",actualizar:{CAM001:"ahora"}});
});

test("Prendas: Reemplazar catálogo de este cliente muestra antes lo que se desactivaría",async({page})=>{
  await loadPrendas(page,["CAM001,Camisa,UNF1,45,4,Hombre,Verano,sí"]);
  await expect(page.getByTestId("desactivar")).toHaveCount(0);
  const request=page.waitForRequest(r=>r.url().endsWith("/api/admin/importaciones"));
  await page.getByLabel("Reemplazar catálogo de este cliente").check();
  expect((await request).postDataJSON()).toMatchObject({mode:"preview",reemplazar:true});
  const box=page.getByTestId("desactivar");
  await expect(box.getByText("Se desactivarán 2 asignaciones de RENIEC")).toBeVisible();
  await expect(box.getByText("OLD001 · ANTIGUA · Verano · cantidad 2")).toBeVisible();
  await expect(box.getByText("OLD002 · OTRA · Ambos · cantidad 1")).toBeVisible();
  await page.getByRole("button",{name:"Confirmar importación"}).click();
  await expect(page.getByRole("dialog").getByText(/Se desactivarán 2 asignaciones de este cliente que no vienen en el archivo \(no se borra nada\)/)).toBeVisible();
});

test("Prendas: los errores indican la fila y con errores no se puede reemplazar",async({page})=>{
  await loadPrendas(page,["A,A,U,1,1,Ambos,Verano,sí","B,B,U,1,1,Ambos,Verano,sí","C,C,U,1,1,Ambos,Verano,sí","ACS0206,Bloqueador,U,12,6,Ambos,Verano,sí"]);
  await expect(page.getByText("Fila 5",{exact:true})).toBeVisible();
  await expect(page.getByText(/ACS0206 con renovación VERANO está repetido en las filas 5 y 9/)).toBeVisible();
  await page.getByLabel("Reemplazar catálogo de este cliente").check();
  await expect(page.getByRole("button",{name:"Confirmar importación"})).toBeDisabled();
  await expect(page.getByText(/Corrige los errores antes de reemplazar/)).toBeVisible();
});

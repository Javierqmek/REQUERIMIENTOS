import { test, expect, type Page } from "@playwright/test";
import { responsiveViewports } from "./viewports";

async function goToForm(page: Page) {
  await page.goto("/documentos/vacaciones/nueva");
}

for (const [width, height] of responsiveViewports) test(`Registrar papeleta responsive ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await goToForm(page);
  await expect(page.getByText("Registrar papeleta de vacaciones")).toBeVisible();
  await expect(page.getByText("A. Colaborador")).toBeVisible();
  await expect(page.getByText("G. Resumen y registrar")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.qa/vacations-new-${width}x${height}.png`, fullPage: true });
});

for (const [width, height] of responsiveViewports) test(`Mis papeletas de vacaciones responsive ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await page.goto("/documentos/vacaciones");
  await expect(page.getByText("Mis papeletas de vacaciones")).toBeVisible();
  await expect(page.getByText("MARÍA AGENTE OPERATIVA")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.qa/vacations-list-${width}x${height}.png`, fullPage: true });
});

test("listado (tarjeta compacta): colaborador, código, estado, fecha de registro, cliente y unidad -- NUNCA físicas/venta/reemplazo/provincia", async ({ page }) => {
  await page.goto("/documentos/vacaciones");
  await expect(page.getByText("MARÍA AGENTE OPERATIVA")).toBeVisible();
  await expect(page.getByText("(PER-001)")).toBeVisible();
  await expect(page.getByText("RENIEC · OFICINA REGISTRAL ATE")).toBeVisible();
  await expect(page.getByText(/Registrado:/)).toBeVisible();
  // REGISTRADO se muestra como "Pendiente de firma" (etiqueta orientada a firma, ver review.ts).
  await expect(page.getByText("Pendiente de firma", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver detalle" })).toBeVisible();
  await expect(page.getByText(/Físicas:/)).toHaveCount(0);
  await expect(page.getByText(/Venta:/)).toHaveCount(0);
  await expect(page.getByText(/Reemplazo:/)).toHaveCount(0);
  await expect(page.getByText(/Provincia:/)).toHaveCount(0);
});

test("admin ve la columna de coordinador; coordinador no", async ({ page }) => {
  await page.goto("/documentos/vacaciones?role=admin");
  await expect(page.getByText("Papeletas de vacaciones")).toBeVisible();
  await expect(page.getByText(/Coordinador: Javier Quispe/)).toBeVisible();
  await page.goto("/documentos/vacaciones");
  await expect(page.getByText(/Coordinador: Javier Quispe/)).toHaveCount(0);
});
test("admin también ve la tarjeta compacta (misma tarjeta que coordinador/gerente, sin físicas/venta/reemplazo/provincia)", async ({ page }) => {
  await page.goto("/documentos/vacaciones?role=admin");
  await expect(page.getByText("(PER-001)")).toBeVisible();
  await expect(page.getByText(/Físicas:/)).toHaveCount(0);
  await expect(page.getByText(/Venta:/)).toHaveCount(0);
  await expect(page.getByText(/Reemplazo:/)).toHaveCount(0);
  await expect(page.getByText(/Provincia:/)).toHaveCount(0);
});

test("catálogo de provincias vacío muestra aviso en vez de un select vacío", async ({ page }) => {
  await page.goto("/documentos/vacaciones/nueva?sinProvincias=1");
  await page.waitForTimeout(200);
  await expect(page.getByText("No hay provincias configuradas. Contacte al administrador.")).toBeVisible();
  await expect(page.locator("#provincia")).toHaveCount(0);
});

test("la venta permanece deshabilitada hasta completar un rango válido de físicas", async ({ page }) => {
  await goToForm(page);
  await expect(page.getByLabel("Registrar venta de vacaciones")).toBeDisabled();
  await page.getByLabel("Fecha inicio").fill("2026-10-05");
  await page.getByLabel("Fecha fin").fill("2026-10-01");
  await expect(page.getByText(/fecha de fin debe ser igual o posterior/)).toBeVisible();
  await expect(page.getByLabel("Registrar venta de vacaciones")).toBeDisabled();
  await page.getByLabel("Fecha fin").fill("2026-10-05");
  await expect(page.getByLabel("Registrar venta de vacaciones")).toBeEnabled();
});

test("el reemplazo se excluye de sus propios resultados (no puede ser el mismo colaborador)", async ({ page }) => {
  await goToForm(page);
  await page.getByLabel("Colaborador").fill("María");
  await page.getByRole("button", { name: /MARÍA AGENTE OPERATIVA/ }).click();
  // El buscador de personal ficticio no filtra por texto (devuelve todo el catálogo): lo que
  // debe demostrarse es que el titular (María) nunca aparece entre los resultados de Reemplazo,
  // aunque otra persona (Carlos) sí siga apareciendo.
  await page.getByLabel("Reemplazo").fill("ag");
  await expect(page.getByRole("button", { name: /CARLOS REEMPLAZO OPERATIVO/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /MARÍA AGENTE OPERATIVA/ })).toHaveCount(0);
});

test("rechaza venta cruzada, misma fecha y antes de físicas; acepta después de físicas", async ({ page }) => {
  await goToForm(page);
  await page.getByLabel("Fecha inicio").fill("2026-10-01");
  await page.getByLabel("Fecha fin").fill("2026-10-15");
  await page.getByLabel("Registrar venta de vacaciones").check();

  await page.getByLabel("Fecha inicio venta").fill("2026-10-10");
  await page.getByLabel("Fecha fin venta").fill("2026-10-20");
  await expect(page.getByText(/después del fin de las vacaciones físicas/)).toBeVisible();

  await page.getByLabel("Fecha inicio venta").fill("2026-10-15");
  await expect(page.getByText(/después del fin de las vacaciones físicas/)).toBeVisible();

  await page.getByLabel("Fecha inicio venta").fill("2026-10-16");
  await expect(page.getByText(/después del fin de las vacaciones físicas/)).toHaveCount(0);
});

test("flujo completo: colaborador, días calendario, venta, reemplazo, ubicación, documento y registro", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await goToForm(page);
  await expect(page.getByRole("button", { name: "Registrar papeleta" })).toBeDisabled();

  // A. Colaborador: buscador sobre personal existente; código automático, no editable.
  await page.getByLabel("Colaborador").fill("María");
  await page.getByRole("button", { name: /MARÍA AGENTE OPERATIVA/ }).click();
  await expect(page.getByText("Código PER-001")).toBeVisible();
  await expect(page.locator('input[value="PER-001"]')).toHaveCount(0);

  // B. Físicas obligatorias + días calendario inclusivos (01→15 oct = 15 días).
  await page.getByLabel("Fecha inicio").fill("2026-10-01");
  await page.getByLabel("Fecha fin").fill("2026-10-15");
  await expect(page.locator("output").first()).toHaveText("15");

  // C. Venta posterior a físicas + días calendario (16→20 oct = 5 días).
  await page.getByLabel("Registrar venta de vacaciones").check();
  await page.getByLabel("Fecha inicio venta").fill("2026-10-16");
  await page.getByLabel("Fecha fin venta").fill("2026-10-20");
  await expect(page.locator("output").nth(1)).toHaveText("5");

  // D. Reemplazo: buscador sobre la misma base, distinto del titular.
  await page.getByLabel("Reemplazo").fill("Carlos");
  await page.getByRole("button", { name: /CARLOS REEMPLAZO OPERATIVO/ }).click();

  // E. Ubicación: cliente → unidad filtrada, y provincia desde catálogo (no hardcodeada).
  await page.getByLabel("Cliente").selectOption({ label: "RENIEC" });
  await page.getByLabel("Unidad / Sede").selectOption({ label: "OFICINA REGISTRAL ATE" });
  await page.getByLabel("Provincia").selectOption({ label: "AREQUIPA" });
  // El nombre del coordinador viene de la sesión (solo lectura): es el último <output> del
  // formulario. No se usa getByText aquí porque el menú de cuenta del header también lo muestra.
  await expect(page.locator("output").last()).toHaveText("Javier Quispe");

  // F. Documento: PDF, vista previa y checkbox obligatorio de legibilidad.
  await page.locator('input[type="file"]').setInputFiles({
    name: "papeleta-vacaciones.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%FAKE_TEST_PDF"),
  });
  await expect(page.getByText(/Vista previa/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar papeleta" })).toBeDisabled();
  await page.getByLabel(/Confirmo que el documento está completo y legible/).check();

  // G. Resumen y registrar.
  await expect(page.getByText("papeleta-vacaciones.pdf")).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar papeleta" })).toBeEnabled();
  await page.getByRole("button", { name: "Registrar papeleta" }).click();
  await expect(page.getByRole("heading", { name: "Papeleta registrada" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mis papeletas de vacaciones" })).toBeVisible();
});

// --- Bug 1 corregido: la vista previa realmente pinta contenido, no solo un contenedor vacío ---
test("la vista previa del PDF renderiza contenido real en el canvas (no queda en blanco)", async ({ page }) => {
  await goToForm(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "papeleta.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%FAKE_TEST_PDF"),
  });
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(async () => canvas.evaluate((el: HTMLCanvasElement) => el.width > 0 && el.height > 0)).toBe(true);
  await expect.poll(async () => canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d");
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true; // algún píxel no transparente
    return false;
  })).toBe(true);
});

// --- Bug 2 corregido: A4 deja de bloquear el registro ---
test("PDF sin dimensiones A4 muestra advertencia pero NO bloquea el registro", async ({ page }) => {
  await page.goto("/documentos/vacaciones/nueva?nonA4=1");
  await page.getByLabel("Colaborador").fill("María");
  await page.getByRole("button", { name: /MARÍA AGENTE OPERATIVA/ }).click();
  await page.getByLabel("Fecha inicio").fill("2026-10-01");
  await page.getByLabel("Fecha fin").fill("2026-10-05");
  await page.getByLabel("Reemplazo").fill("Carlos");
  await page.getByRole("button", { name: /CARLOS REEMPLAZO OPERATIVO/ }).click();
  await page.getByLabel("Cliente").selectOption({ label: "RENIEC" });
  await page.getByLabel("Unidad / Sede").selectOption({ label: "OFICINA REGISTRAL ATE" });
  await page.getByLabel("Provincia").selectOption({ label: "AREQUIPA" });
  await page.locator('input[type="file"]').setInputFiles({
    name: "papeleta-carta.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%FAKE_TEST_PDF"),
  });
  await expect(page.getByText("El documento no tiene dimensiones A4 estándar. Verifique que sea legible antes de continuar.")).toBeVisible();
  // La advertencia no impide continuar: el checkbox sigue disponible y el registro se habilita.
  await page.getByLabel(/Confirmo que el documento está completo y legible/).check();
  await expect(page.getByRole("button", { name: "Registrar papeleta" })).toBeEnabled();
  await page.getByRole("button", { name: "Registrar papeleta" }).click();
  await expect(page.getByRole("heading", { name: "Papeleta registrada" })).toBeVisible();
});

// --- Flujo de revisión: detalle, observar, corrección (la firma final ya no es "marcar
// conforme": ver flujo de firma real del gerente en la suite dedicada más abajo) ---
test("detalle REGISTRADO: admin ve revisión y el motivo de observación es obligatorio", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?role=admin");
  await expect(page.getByText("Pendiente de firma", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Observar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Observar" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Motivo de observación").fill("El rango de venta se cruza con vacaciones físicas.");
  await expect(confirm).toBeEnabled();
});

test("detalle REGISTRADO: el coordinador no ve acciones de revisión (ni sobre su propia papeleta)", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture");
  await expect(page.getByRole("button", { name: "Marcar conforme" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Observar" })).toHaveCount(0);
});

test("detalle OBSERVADO: muestra el motivo y solo el coordinador dueño puede corregir", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?pstate=OBSERVADO");
  await expect(page.getByText("Observado", { exact: true })).toBeVisible();
  await expect(page.getByText("El rango de venta se cruza con vacaciones físicas.")).toBeVisible();
  await expect(page.getByText("Corregir papeleta observada")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar corrección" })).toBeDisabled();

  await page.goto("/documentos/vacaciones/fixture?pstate=OBSERVADO&role=admin");
  await expect(page.getByText("Corregir papeleta observada")).toHaveCount(0);
  // OBSERVADO ya no admite una segunda observación/conforme directa: no hay botones de revisión.
  await expect(page.getByRole("button", { name: "Marcar conforme" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Observar" })).toHaveCount(0);
});

// ============================================================================
// A. VISOR: coordinador/gerente/admin ven el PDF vigente, otro coordinador no accede, la
// versión corregida/firmada reemplaza al original como documento principal, y el historial
// sigue permitiendo ver versiones anteriores sin cambiar cuál es la vigente.
// ============================================================================
test("visor A: el coordinador dueño abre su papeleta y ve el PDF vigente", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByText(/Página \d+ de \d+/)).toBeVisible();
});
test("visor A: el gerente abre el detalle y ve el PDF (fuera del flujo de firma, p.ej. ya observado)", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?role=gerente&pstate=OBSERVADO");
  await expect(page.locator("canvas")).toBeVisible();
});
test("visor A: el admin abre el detalle y ve el PDF", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?role=admin");
  await expect(page.locator("canvas")).toBeVisible();
});
test("visor A: otro coordinador no accede al PDF (el visor muestra el error de acceso denegado)", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?role=coordinador2");
  await expect(page.getByText("No se pudo cargar el documento.")).toBeVisible();
});
test("visor A: una papeleta corregida muestra la última corrección como documento actual, no el original", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?corrected=1");
  await expect(page.getByText("Documento actual: última corrección · papeleta-corregida.pdf")).toBeVisible();
  await expect(page.getByText("Versión 2 · Corrección")).toBeVisible();
});
test("visor A: una papeleta FIRMADO muestra la versión firmada como documento actual", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?pstate=FIRMADO");
  await expect(page.getByText("Documento actual: versión firmada · papeleta-firmada.pdf")).toBeVisible();
  await expect(page.getByText("Versión 2 · Firmado")).toBeVisible();
});
test("visor A: sin correcciones, el documento actual es el original", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture");
  await expect(page.getByText("Documento actual: versión original (sin correcciones) · papeleta-maria.pdf")).toBeVisible();
});
test("visor A: las versiones históricas siguen accesibles desde el historial sin cambiar cuál es la vigente", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?corrected=1");
  const historyLink = page.getByRole("link", { name: "Ver esta versión" }).last(); // versión 1 (la más antigua)
  await expect(historyLink).toHaveAttribute("href", /\/archivo\?version=1$/);
  await expect(page.getByText("Vigente")).toBeVisible(); // marca la versión 2, no la 1
});

// ============================================================================
// B. FIRMA: solo el gerente firma, solo en estado firmable, el PDF real renderiza, la firma se
// puede posicionar, la vista previa refleja esa posición y confirmar genera FIRMADO.
// ============================================================================
test("firma B: el botón/editor de firma solo aparece para el gerente sobre una papeleta pendiente de firma, nunca para otro coordinador", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?role=coordinador2");
  await expect(page.getByText("Arrastra el sello sobre el documento")).toHaveCount(0);
  await page.goto("/documentos/vacaciones/fixture?role=admin");
  await expect(page.getByText("Arrastra el sello sobre el documento")).toHaveCount(0); // admin no firma por defecto
  await page.goto("/documentos/vacaciones/fixture?role=gerente");
  await expect(page.getByText("Arrastra el sello sobre el documento")).toBeVisible();
});
test("firma B: OBSERVADO y FIRMADO no permiten abrir el editor de firma", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?role=gerente&pstate=OBSERVADO");
  await expect(page.getByText("Arrastra el sello sobre el documento")).toHaveCount(0);
  await page.goto("/documentos/vacaciones/fixture?role=gerente&pstate=FIRMADO");
  await expect(page.getByText("Arrastra el sello sobre el documento")).toHaveCount(0);
});
test("firma B: el gerente abre el editor, el PDF renderiza con contenido real y el sello es visible", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?role=gerente");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(async () => canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext("2d"); if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
    return false;
  })).toBe(true);
  await expect(page.getByAltText("Sello del gerente")).toBeVisible();
});
test("firma B: la posición del sello puede arrastrarse sobre el documento", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?role=gerente");
  const sello = page.getByAltText("Sello del gerente").locator("xpath=..");
  const before = await sello.evaluate((el: HTMLElement) => el.style.left);
  // Se dispara la secuencia de PointerEvent manualmente (pointerdown sobre el elemento, luego
  // pointermove/pointerup sobre window, igual que escucha el propio componente) para no depender
  // de cómo cada navegador traduce eventos de mouse simulados a Pointer Events.
  await sello.evaluate((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent("pointerdown", { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }));
  });
  const box = await sello.boundingBox();
  if (!box) throw new Error("sello sin bounding box");
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, buttons: 0 }));
  }, { x: box.x + box.width / 2 + 120, y: box.y + box.height / 2 + 60 });
  await page.waitForTimeout(150);
  const after = await sello.evaluate((el: HTMLElement) => el.style.left);
  expect(after).not.toBe(before);
});
test("firma B: la vista previa compone el PDF con la posición elegida y habilita confirmar solo tras revisarla", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?role=gerente");
  const confirmSign = page.getByRole("button", { name: "Confirmar firma" });
  await expect(confirmSign).toBeDisabled();
  await page.getByRole("button", { name: "Vista previa" }).click();
  await expect(page.getByRole("button", { name: "He revisado la vista previa" })).toBeVisible();
  await page.getByRole("button", { name: "He revisado la vista previa" }).click();
  await expect(page.getByText("Vista previa revisada. Ya puedes confirmar la firma.")).toBeVisible();
  await expect(confirmSign).toBeEnabled();
});
test("firma B: confirmar la firma completa el flujo sin errores (el backend registra FIRMADO)", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture?role=gerente");
  await page.getByRole("button", { name: "Vista previa" }).click();
  await page.getByRole("button", { name: "He revisado la vista previa" }).click();
  await page.getByRole("button", { name: "Confirmar firma" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Vas a incorporar tu sello")).toBeVisible();
  await dialog.getByRole("button", { name: "Firmar" }).click();
  await expect(page.getByText("No se pudo firmar la papeleta.")).toHaveCount(0);
});
test("firma B: tras la firma, el coordinador ve el estado FIRMADO y el documento final", async ({ page }) => {
  // El arnés de pruebas es estático (sin backend real ni router.refresh() funcional): se navega
  // directo al estado resultante para verificar lo que vería el coordinador tras la firma, ya
  // que la transición de estado real ya está probada contra PostgreSQL (firmar_papeleta_vacaciones).
  await page.goto("/documentos/vacaciones/fixture?pstate=FIRMADO");
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
});

// ============================================================================
// C. BANDEJA GERENTE: solo colaborador/estado/fecha/coordinador/cliente/unidad + acciones.
// ============================================================================
test("bandeja C: la tarjeta del gerente muestra solo los campos permitidos y las acciones correctas", async ({ page }) => {
  await page.goto("/documentos/vacaciones?role=gerente");
  await expect(page.getByText("MARÍA AGENTE OPERATIVA")).toBeVisible();
  await expect(page.getByText("Pendiente de firma", { exact: true })).toBeVisible();
  await expect(page.getByText(/Registrado:/)).toBeVisible();
  await expect(page.getByText(/Coordinador: Javier Quispe/)).toBeVisible();
  await expect(page.getByText("RENIEC · OFICINA REGISTRAL ATE")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver detalle" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Firmar" })).toBeVisible();
});
test("bandeja C: la tarjeta del gerente NUNCA muestra físicas, venta, días, reemplazo ni provincia", async ({ page }) => {
  await page.goto("/documentos/vacaciones?role=gerente");
  await expect(page.getByText(/Físicas:/)).toHaveCount(0);
  await expect(page.getByText(/Venta:/)).toHaveCount(0);
  await expect(page.getByText(/Reemplazo:/)).toHaveCount(0);
  await expect(page.getByText(/Provincia:/)).toHaveCount(0);
});
test("bandeja C: sin papeletas por revisar (estado no firmable), no se ofrece el botón Firmar", async ({ page }) => {
  await page.goto("/documentos/vacaciones?role=gerente&pstate=FIRMADO");
  await expect(page.getByRole("link", { name: "Ver detalle" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Firmar" })).toHaveCount(0);
});

// ============================================================================
// D. ELIMINACIÓN DE PRUEBAS: solo admin, marcado explícito, nunca FIRMADO, doble flag,
// confirmación obligatoria.
// ============================================================================
test("prueba D: solo admin puede abrir Mantenimiento de pruebas", async ({ page }) => {
  await page.goto("/documentos/vacaciones/mantenimiento");
  await expect(page.getByText("No autorizado.")).toBeVisible();
  await page.goto("/documentos/vacaciones/mantenimiento?role=admin");
  await expect(page.getByText("MARÍA AGENTE OPERATIVA (PER-001)")).toBeVisible();
});
test("prueba D: el marcado como prueba es explícito y solo lo ofrece el admin; una FIRMADO no puede marcarse", async ({ page }) => {
  await page.goto("/documentos/vacaciones/fixture");
  await expect(page.getByText("Marcar como prueba")).toHaveCount(0); // coordinador no lo ve
  await page.goto("/documentos/vacaciones/fixture?role=admin");
  await expect(page.getByRole("button", { name: "Marcar como prueba" })).toBeEnabled();
  await page.goto("/documentos/vacaciones/fixture?role=admin&pstate=FIRMADO");
  await expect(page.getByRole("button", { name: "Marcar como prueba" })).toBeDisabled();
  await expect(page.getByText("Una papeleta firmada no puede marcarse como prueba.")).toBeVisible();
});
test("prueba D: sin el flag habilitado, el mantenimiento muestra el aviso de deshabilitado y no ofrece borrar", async ({ page }) => {
  await page.goto("/documentos/vacaciones/mantenimiento?role=admin&flag=0");
  await expect(page.getByText(/borrado de papeletas de prueba está deshabilitado/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Eliminar/ })).toHaveCount(0);
});
test("prueba D: eliminar exige selección y escribir ELIMINAR (no basta un clic) antes de borrar", async ({ page }) => {
  await page.goto("/documentos/vacaciones/mantenimiento?role=admin");
  const deleteButton = page.getByRole("button", { name: /Eliminar .*papeleta/ });
  await expect(deleteButton).toBeDisabled();
  await page.getByText("MARÍA AGENTE OPERATIVA (PER-001)").locator("..").getByRole("checkbox").check();
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Eliminar papeletas de prueba")).toBeVisible();
  const confirmButton = dialog.getByRole("button", { name: "Eliminar definitivamente" });
  await expect(confirmButton).toBeDisabled(); // un solo clic no alcanza
  await page.getByLabel(/Escribe ELIMINAR/).fill("eliminar"); // insensible a mayúsculas
  await expect(confirmButton).toBeEnabled();
  await expect(page.getByText(/Se eliminaron/)).toHaveCount(0); // todavía no se confirmó
  await confirmButton.click();
  await expect(page.getByText(/Se eliminaron 1 papeleta\(s\) y 1 archivo\(s\) de Storage\./)).toBeVisible();
});

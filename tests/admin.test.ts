import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fixtureRequirement, IDS } from "./fixtures/admin";
import { cleanText, SIDIGE_HEADERS, SidigeValidationError, toSidigeRows } from "../lib/admin/sidige";
import { buildSidigeWorkbook, EmptyExportError, sidigeFilename } from "../lib/admin/workbook";
import { EMPTY_FILTERS, filterParams, filterRpcArgs, parseAdminQuery } from "../lib/admin/filters";
import { makeAdminListHandler, makeAdminUpdateHandler, makeSidigeHandler } from "../lib/admin/handlers";
import { exportRequirements } from "../lib/admin/data";
import type { SidigeRequirement } from "../lib/admin/types";
import type { Profile } from "../lib/types";

async function* groups(rows: SidigeRequirement[]) { yield* rows; }
const admin: Profile = { id: IDS.coordinador, nombre: "Admin", email: "admin@example.test", role: "admin" };
function mockDb(rows: SidigeRequirement[]) {
  const calls: Record<string, unknown>[] = [];
  const db = {
    rpc: (_name: string, args: Record<string, unknown>) => {
      calls.push(args);
      const result = Promise.resolve({ data: { rows, total: rows.length }, error: null });
      return Object.assign(result, { abortSignal: () => result });
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

test("una prenda: diez columnas exactas, espacios simples y referencia constante", () => {
  const rows = toSidigeRows(fixtureRequirement());
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], ["AGENTE RAMÍREZ RIVERA JERY 071389725", "RENOVACION VERANO", "RENIEC OFICINA REGISTRAL ATE", "AGENTE RAMÍREZ RIVERA JERY 071389725", 1, "EPP", "000012", "CAMISA BLANCA — TALLA S", 2, 20]);
  assert.equal(cleanText("  uno\t dos\n tres  "), "uno dos tres");
});
test("múltiples prendas: orden created_at/id y numeración reiniciada", () => {
  const req = fixtureRequirement();
  const detail = req.detalle_requerimiento[0];
  req.detalle_requerimiento = [
    { ...detail, id: "b", created_at: "2026-09-03T00:00:00Z" },
    { ...detail, id: "c" },
    { ...detail, id: "a" },
  ];
  assert.deepEqual(toSidigeRows(req).map(r => r[4]), [1, 2, 3]);
  assert.equal(toSidigeRows(fixtureRequirement())[0][4], 1);
  const ordered = req.detalle_requerimiento.map(d => ({ ...d, prendas: { ...d.prendas!, codigo_prenda: d.id } }));
  assert.deepEqual(toSidigeRows({ ...req, detalle_requerimiento: ordered }).map(r => r[6]), ["a", "c", "b"]);
});
test("prioriza snapshots, precio cero válido y fallback de almacén", () => {
  const req = fixtureRequirement();
  req.detalle_requerimiento[0].precio_unitario = 0;
  assert.equal(toSidigeRows(req)[0][9], 0);
  assert.equal(toSidigeRows(req)[0][5], "EPP");
  req.detalle_requerimiento[0].codigo_almacen = null;
  assert.equal(toSidigeRows(req)[0][5], "ACTUAL");
});
for (const field of ["nombre", "dni", "cargo"] as const) test("rechaza agente sin " + field, () => {
  const req = fixtureRequirement(); req.personal![field] = "";
  assert.throws(() => toSidigeRows(req), SidigeValidationError);
});
for (const field of ["clientes", "unidades"] as const) test("rechaza destino incompleto: " + field, () => {
  assert.throws(() => toSidigeRows(fixtureRequirement({ [field]: null })), SidigeValidationError);
});
test("rechaza requerimiento sin prendas y detalle sin código/descripción/almacén", () => {
  assert.throws(() => toSidigeRows(fixtureRequirement({ detalle_requerimiento: [] })), SidigeValidationError);
  const req = fixtureRequirement(); req.detalle_requerimiento[0].prendas = null; req.detalle_requerimiento[0].codigo_almacen = "";
  assert.throws(() => toSidigeRows(req), (e: unknown) => e instanceof SidigeValidationError && e.issues[0].campos.length === 3);
});
for (const value of [null, "", -1, "NaN", "Infinity"]) test("rechaza precio inválido: " + value, () => {
  const req = fixtureRequirement(); req.detalle_requerimiento[0].precio_unitario = value;
  assert.throws(() => toSidigeRows(req), SidigeValidationError);
});
for (const value of [0, -1, 1.5, NaN]) test("rechaza cantidad inválida: " + value, () => {
  const req = fixtureRequirement(); req.detalle_requerimiento[0].cantidad = value;
  assert.throws(() => toSidigeRows(req), SidigeValidationError);
});
test("XLSX real: encabezados exactos, tipos, tildes, ceros, precio 0.00, sin extras", async () => {
  const a = fixtureRequirement(); a.detalle_requerimiento.push({ ...a.detalle_requerimiento[0], id: "77000000-0000-4000-8000-000000000002", precio_unitario: "20.25" });
  const b = fixtureRequirement({ id: "44000000-0000-4000-8000-000000000002" });
  b.detalle_requerimiento[0].prendas!.codigo_prenda = "=000001";
  const bytes = await buildSidigeWorkbook(groups([a, b]));
  assert.equal(bytes.subarray(0, 2).toString(), "PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(bytes).buffer);
  assert.equal(workbook.worksheets.length, 1);
  const sheet = workbook.worksheets[0];
  assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1), [...SIDIGE_HEADERS]);
  assert.equal(sheet.rowCount, 4); assert.equal(sheet.columnCount, 10);
  assert.equal(sheet.getCell("G2").value, "000012"); assert.equal(sheet.getCell("G2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("G4").value, "=000001"); assert.equal(sheet.getCell("G4").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("J3").value, 20.25); assert.equal(sheet.getCell("J3").numFmt, "0.00");
  assert.equal(sheet.getCell("I2").type, ExcelJS.ValueType.Number);
  assert.deepEqual([2,3,4].map(row => sheet.getCell("E" + row).value), [1,2,1]);
  assert.equal(sheet.getCell("A2").value, "AGENTE RAMÍREZ RIVERA JERY 071389725");
  assert.equal(sheet.autoFilter, undefined); assert.equal(sheet.getCell("A1").isMerged, false);
});
test("no entrega archivos vacíos ni parciales con datos incompletos", async () => {
  await assert.rejects(buildSidigeWorkbook(groups([])), EmptyExportError);
  await assert.rejects(buildSidigeWorkbook(groups([fixtureRequirement(), fixtureRequirement({ clientes: null })])), SidigeValidationError);
});
test("nombre de archivo con fecha/hora de Perú", () => {
  assert.equal(sidigeFilename(new Date("2026-09-02T02:03:00Z")), "MIGRADOR_RENOVACION_VERANO_20260901_2103.xlsx");
});

test("conserva espacios internos en códigos y descripciones", () => {
  const req = fixtureRequirement();
  req.detalle_requerimiento[0].codigo_almacen = "  ALM  01  ";
  req.detalle_requerimiento[0].prendas!.codigo_prenda = "  00  12  ";
  req.detalle_requerimiento[0].prendas!.nombre_prenda = "CAMISA  BLANCA";
  const row = toSidigeRows(req)[0];
  assert.equal(row[5], "ALM  01"); assert.equal(row[6], "00  12"); assert.equal(row[7], "CAMISA  BLANCA");
});
test("respeta microsegundos de PostgreSQL antes del desempate por id", () => {
  const req = fixtureRequirement(); const first = req.detalle_requerimiento[0];
  req.detalle_requerimiento = [
    { ...first, id: "a", created_at: "2026-09-02T15:00:00.000002Z", codigo_almacen: "SEGUNDO" },
    { ...first, id: "b", created_at: "2026-09-02T15:00:00.000001Z", codigo_almacen: "PRIMERO" },
  ];
  assert.deepEqual(toSidigeRows(req).map(row => row[5]), ["PRIMERO", "SEGUNDO"]);
});
for (const key of ["cliente", "unidad", "coordinador"] as const) test("filtro por " + key, () => {
  const parsed = parseAdminQuery(new URLSearchParams({ [key]: IDS[key] }));
  assert.equal(parsed.filters[key], IDS[key]);
});
test("filtros combinados y fechas inclusivas en Perú", () => {
  const filters = { ...EMPTY_FILTERS, cliente: IDS.cliente, unidad: IDS.unidad, coordinador: IDS.coordinador, estado: "Pendiente" as const, desde: "2026-09-01", hasta: "2026-09-02", q: "Ramírez" };
  assert.deepEqual(parseAdminQuery(filterParams(filters, 2)), { filters, page: 2 });
  assert.deepEqual(filterRpcArgs(filters), { p_cliente_id: IDS.cliente, p_unidad_id: IDS.unidad, p_coordinador_id: IDS.coordinador, p_estado: "Pendiente", p_desde: "2026-09-01T00:00:00-05:00", p_hasta: "2026-09-03T05:00:00.000Z", p_busqueda: "Ramírez" });
});
for (const query of ["desde=2026-02-30", "desde=2026-09-03&hasta=2026-09-02", "cliente=no-uuid", "estado=Otro", "page=-1"]) test("filtros inválidos: " + query, () => {
  assert.throws(() => parseAdminQuery(new URLSearchParams(query)));
});
for (const role of ["coordinador", "anonymous"] as const) test("acceso directo " + role + " rechazado a listado, modificación y Excel", async () => {
  const deps = { getProfile: async () => role === "anonymous" ? null : { ...admin, role }, getDb: async (): Promise<SupabaseClient> => { throw new Error("No debe consultar DB"); } };
  for (const make of [makeAdminListHandler, makeAdminUpdateHandler, makeSidigeHandler]) {
    const response = await make(deps)(new Request("http://localhost/api/admin/requerimientos/sidige"));
    assert.equal(response.status, 403);
  }
});
test("endpoint Excel usa filtros del listado, no el tamaño de página", async () => {
  const mock = mockDb([fixtureRequirement()]);
  const params = filterParams({ ...EMPTY_FILTERS, cliente: IDS.cliente, unidad: IDS.unidad, coordinador: IDS.coordinador, estado: "Pendiente" }, 3);
  const response = await makeSidigeHandler({ getProfile: async () => admin, getDb: async () => mock.db })(new Request("http://localhost/api/admin/requerimientos/sidige?" + params));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type")!, /spreadsheetml/);
  assert.equal(mock.calls[0].p_cliente_id, IDS.cliente); assert.equal(mock.calls[0].p_unidad_id, IDS.unidad);
  assert.equal(mock.calls[0].p_coordinador_id, IDS.coordinador); assert.equal(mock.calls[0].p_estado, "Pendiente");
  assert.equal(mock.calls[0].p_offset, 0); assert.equal(mock.calls[0].p_exportar, true);
});
test("endpoint devuelve requerimientos incompletos, no bytes XLSX", async () => {
  const mock = mockDb([fixtureRequirement({ unidades: null })]);
  const response = await makeSidigeHandler({ getProfile: async () => admin, getDb: async () => mock.db })(new Request("http://localhost/api/admin/requerimientos/sidige"));
  assert.equal(response.status, 422);
  const body = await response.json(); assert.equal(body.issues[0].id, fixtureRequirement().id); assert.ok(body.issues[0].campos.includes("Unidad"));
});
test("endpoint devuelve mensaje sin registros", async () => {
  const mock = mockDb([]);
  const response = await makeSidigeHandler({ getProfile: async () => admin, getDb: async () => mock.db })(new Request("http://localhost/api/admin/requerimientos/sidige"));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "No hay requerimientos para exportar con los filtros seleccionados.");
});
test("paginación de exportación: cursor estable, bloques de 250 sin N+1", async () => {
  const calls: Record<string, unknown>[] = [];
  const first = Array.from({ length: 250 }, (_, i) => fixtureRequirement({ id: String(i) }));
  const db = { rpc: (_name: string, args: Record<string, unknown>) => { calls.push(args); return Promise.resolve({ data: { rows: calls.length === 1 ? first : [fixtureRequirement()] }, error: null }); } } as unknown as SupabaseClient;
  const rows = []; for await (const r of exportRequirements(db, EMPTY_FILTERS)) rows.push(r);
  assert.equal(rows.length, 251); assert.equal(calls.length, 2);
  assert.equal(calls[1].p_cursor_id, "249"); assert.equal(calls[1].p_creado_hasta, calls[0].p_creado_hasta);
});

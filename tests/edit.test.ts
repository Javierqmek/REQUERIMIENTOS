import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canEditRequirement, editGarmentsSchema, initialEditLines, newEditLine, ATTENDED_MESSAGE } from "../lib/requirements/edit";
import { makeEditGarmentsHandler } from "../lib/requirements/handlers";
import { editProfile, editGarments, fixtureEdit } from "./fixtures/edit";
import type { Profile } from "../lib/types";
import { toCsvRows, CSV_HEADERS } from "../lib/admin/csv";
import { toSidigeRows } from "../lib/admin/sidige";
import { buildSidigeWorkbook } from "../lib/admin/workbook";
import { fixtureRequirement } from "./fixtures/admin";
import ExcelJS from "exceljs";
import { genderLabel, inferGender, isGenderCompatible } from "../lib/garments/gender";
import { catalogTotal, formatMoney, historicalTotal } from "../lib/requirements/money";

for (const role of ["coordinador", "admin"] as const) for (const estado of ["Pendiente", "Observado", "Atendido"] as const) {
  test(`${role} - ${estado}: permiso visual`, () => {
    assert.equal(canEditRequirement({ ...editProfile, role }, { ...fixtureEdit().requerimiento, estado }), estado !== "Atendido");
  });
}
test("coordinador no edita ajeno, admin sí", () => {
  const row = { ...fixtureEdit().requerimiento, usuario_creador_id: "otro" };
  assert.equal(canEditRequirement(editProfile, row), false);
  assert.equal(canEditRequirement({ ...editProfile, role: "admin" }, row), true);
  assert.equal(canEditRequirement(null, row), false);
});
test("líneas activas: conserva snapshots y usa cantidad fija", () => {
  const row = fixtureEdit().requerimiento;
  row.detalle_requerimiento.push({ ...row.detalle_requerimiento[0], id: "inactiva", activo: false });
  const lines = initialEditLines(row);
  assert.equal(lines.length, 1); assert.equal(lines[0].precio, 20); assert.equal(lines[0].codigo, "HISTÓRICO"); assert.equal(lines[0].cantidad, 5); assert.equal(lines[0].genero, "HOMBRE");
  const fresh = newEditLine(editGarments[0]);
  assert.equal(fresh.detalle_id, undefined); assert.equal(fresh.precio, 99); assert.equal(fresh.codigo, "ACTUAL"); assert.equal(fresh.cantidad, 5);
});
test("género filtra específicas, conserva AMBOS e infiere cuando es posible", () => {
  assert.deepEqual(editGarments.filter(p => isGenderCompatible(p.genero, "HOMBRE")).map(p => p.genero), ["HOMBRE","AMBOS"]);
  assert.deepEqual(editGarments.filter(p => isGenderCompatible(p.genero, "MUJER")).map(p => p.genero), ["AMBOS","MUJER"]);
  assert.equal(inferGender(["AMBOS","HOMBRE"]), "HOMBRE");
  assert.equal(inferGender(["AMBOS"]), null);
  assert.equal(inferGender(["HOMBRE","MUJER"]), null);
  assert.equal(genderLabel("AMBOS"), "Unisex");
});
test("totales usan catálogo nuevo y snapshots históricos activos", () => {
  assert.equal(catalogTotal([{ cantidad: 2, precio: 28 },{ cantidad: 1, precio: 45 }]), 101);
  assert.equal(historicalTotal([
    { cantidad: 2, precio_unitario: "28.00", activo: true },
    { cantidad: 1, precio_unitario: 45, activo: true },
    { cantidad: 99, precio_unitario: 100, activo: false },
  ]), 101);
  assert.equal(formatMoney(101), "S/ 101.00");
});
const body = () => ({ version: fixtureEdit().version, detalles: [{ prenda_id: editGarments[0].id }] });
test("CSV y XLSX real excluyen líneas inactivas incluso si la fuente las incluye", async () => {
  const row = fixtureRequirement();
  row.detalle_requerimiento.push({ ...row.detalle_requerimiento[0], id: "retirada", activo: false, cantidad: 900, codigo_almacen: "RETIRADA" });
  assert.equal(CSV_HEADERS[1], "Coordinador");
  assert.equal(toCsvRows(row).length, 1); assert.equal(toCsvRows(row)[0][8], 2);
  assert.equal(toSidigeRows(row).length, 1); assert.equal(toSidigeRows(row)[0][4], 1);
  async function* source() { yield row; }
  const bytes = await buildSidigeWorkbook(source());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  assert.equal(workbook.worksheets[0].rowCount, 2);
  assert.equal(workbook.worksheets[0].getRow(2).getCell(9).value, 2);
});
for (const field of ["agente_id", "cliente_id", "unidad_id", "usuario_creador_id", "fecha", "referencia_interna", "estado"]) test(`rechaza campo de cabecera ${field}`, () => {
  assert.equal(editGarmentsSchema.safeParse({ ...body(), [field]: "x" }).success, false);
});
for (const field of ["cantidad", "precio_unitario", "codigo_almacen", "activo"]) test(`rechaza valor manual ${field}`, () => {
  assert.equal(editGarmentsSchema.safeParse({ ...body(), detalles: [{ ...body().detalles[0], [field]: 99 }] }).success, false);
});
test("rechaza vacío, duplicados y acepta conjunto de identificadores", () => {
  assert.equal(editGarmentsSchema.safeParse({ ...body(), detalles: [] }).success, false);
  assert.equal(editGarmentsSchema.safeParse({ ...body(), detalles: [body().detalles[0], body().detalles[0]] }).success, false);
  assert.equal(editGarmentsSchema.safeParse(body()).success, true);
});
function mockHandler(profile: Profile | null = editProfile, state = "Pendiente", rpcError?: string, foreign = false) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const payload = fixtureEdit(); payload.requerimiento.estado = state as "Pendiente";
  if (foreign) payload.requerimiento.usuario_creador_id = "other";
  const db = { rpc: async (name: string, args: unknown) => {
    calls.push({ name, args });
    return name === "obtener_edicion_prendas" ? { data: payload, error: null } : { data: payload, error: rpcError ? { code: rpcError } : null };
  } } as unknown as SupabaseClient;
  return { calls, run: makeEditGarmentsHandler({ getProfile: async () => profile, getDb: async () => db }) };
}
const request = (input: unknown = body()) => new Request("http://localhost/api/requerimientos/x/prendas", { method: "PATCH", body: JSON.stringify(input) });
test("API deniega sin sesión sin consultar BD", async () => {
  const h = mockHandler(null); assert.equal((await h.run(request(), fixtureEdit().requerimiento.id)).status, 403); assert.equal(h.calls.length, 0);
});
test("API deniega propietario ajeno aun con lectura simulada", async () => {
  const h = mockHandler(editProfile, "Pendiente", undefined, true); assert.equal((await h.run(request(), fixtureEdit().requerimiento.id)).status, 403); assert.equal(h.calls.length, 1);
});
for (const role of ["coordinador", "admin"] as const) test(`API bloquea Atendido para ${role}`, async () => {
  const h = mockHandler({ ...editProfile, role }, "Atendido"); const result = await h.run(request(), fixtureEdit().requerimiento.id);
  assert.equal(result.status, 409); assert.equal((await result.json()).error, ATTENDED_MESSAGE); assert.equal(h.calls.length, 1);
});
test("API admin edita ajeno con contrato sin cabecera", async () => {
  const h = mockHandler({ ...editProfile, role: "admin" }, "Observado", undefined, true);
  const response = await h.run(request(), fixtureEdit().requerimiento.id);
  assert.equal(response.status, 200); assert.deepEqual(h.calls[1].args, { p_id: fixtureEdit().requerimiento.id, p_version: body().version, p_detalles: body().detalles });
  const payload=await response.json();assert.equal(payload.message, "Prendas actualizadas correctamente.");assert.equal(payload.data.requerimiento.id,fixtureEdit().requerimiento.id);
});
test("dos ediciones consecutivas conservan la misma cabecera y nunca llaman crear_requerimiento", async () => {
  const h=mockHandler();const id=fixtureEdit().requerimiento.id;
  for(let attempt=0;attempt<2;attempt++){
    const response=await h.run(request(),id);assert.equal(response.status,200);
    const payload=await response.json();assert.equal(payload.data.requerimiento.id,id);
  }
  assert.deepEqual(h.calls.map(call=>call.name),[
    "obtener_edicion_prendas","editar_prendas_requerimiento",
    "obtener_edicion_prendas","editar_prendas_requerimiento",
  ]);
  assert.equal(h.calls.some(call=>call.name==="crear_requerimiento"),false);
});
for (const [code, status] of [["40001",409],["55000",409],["42501",403],["22023",400],["XX000",500]] as const) test(`API maneja error SQL ${code}`, async () => {
  const h = mockHandler(editProfile, "Pendiente", code); assert.equal((await h.run(request(), fixtureEdit().requerimiento.id)).status, status);
});
test("API rechaza cabecera antes de consultar la base", async () => {
  const h = mockHandler(); assert.equal((await h.run(request({ ...body(), estado: "Atendido" }), fixtureEdit().requerimiento.id)).status, 400); assert.equal(h.calls.length, 0);
});

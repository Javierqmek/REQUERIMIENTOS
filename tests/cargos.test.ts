import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { catalogCreateSchema } from "../lib/admin/maintenance";
import { validatePersonalRows } from "../lib/admin/personal-import";
import { editHeaderSchema, type EditPayload } from "../lib/requirements/edit";
import { makeEditHeaderHandler } from "../lib/requirements/handlers";
import { requerimientoSchema } from "../lib/validations";
import { toCsvRows } from "../lib/admin/csv";
import { fixtureRequirement } from "./fixtures/admin";
import { fixtureEdit } from "./fixtures/edit";
import type { Profile } from "../lib/types";

const CARGOS = [{ nombre: "AGENTE", activo: true }, { nombre: "SUPERVISOR", activo: true }, { nombre: "DESCANSERO", activo: false }];
const UUID = "11111111-1111-4111-8111-111111111111";

test("importar personal: un cargo que no existe es error con número de fila; el que existe se guarda con el nombre del catálogo", () => {
  const rows: Record<string, string>[] = [
    { codigo_personal: "A", nombre: "N", dni: "12345678", cargo: "supervisor", activo: "sí" },
    { codigo_personal: "B", nombre: "N", dni: "22345678", cargo: "PIRATA", activo: "sí" },
    { codigo_personal: "C", nombre: "N", dni: "32345678", activo: "sí" },
  ];
  const { valid, issues } = validatePersonalRows(rows, [2, 3, 4], CARGOS);
  assert.deepEqual(valid.map(r => [r.fila, r.cargo]), [[2, "SUPERVISOR"], [4, null]]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].row, 3);
  assert.match(issues[0].message, /El cargo "PIRATA" no existe en el catálogo de cargos/);
});
test("sin catálogo (pruebas antiguas) no se valida el cargo en pantalla; la base siempre lo valida", () => {
  const { valid, issues } = validatePersonalRows([{ codigo_personal: "A", nombre: "N", dni: "12345678", cargo: "LO QUE SEA", activo: "sí" }], [2]);
  assert.deepEqual(issues, []);
  assert.equal(valid[0].cargo, "LO QUE SEA");
});
test("Mantenimiento: el catálogo de cargos acepta solo el nombre", () => {
  assert.equal(catalogCreateSchema.safeParse({ catalogo: "cargos", valores: { nombre: "AGENTE DIA" } }).success, true);
  assert.equal(catalogCreateSchema.safeParse({ catalogo: "cargos", valores: { nombre: "" } }).success, false);
  assert.equal(catalogCreateSchema.safeParse({ catalogo: "cargos", valores: { nombre: "X", activo: false } }).success, false);
});
test("el requerimiento nuevo acepta el cargo elegido (opcional en el esquema; la base lo valida contra el catálogo)", () => {
  const base = { agente_id: UUID, cliente_id: UUID, unidad_id: UUID, renovacion: "VERANO", genero: "HOMBRE", detalles: [{ prenda_id: UUID }] };
  assert.equal(requerimientoSchema.safeParse({ ...base, cargo: "SUPERVISOR" }).success, true);
  assert.equal(requerimientoSchema.safeParse(base).success, true);
  assert.equal(requerimientoSchema.safeParse({ ...base, cargo: "" }).success, false);
});
test("editar cabecera: solo renovación, cargo y la confirmación de líneas (nada más)", () => {
  assert.equal(editHeaderSchema.safeParse({ renovacion: "INVIERNO" }).success, true);
  assert.equal(editHeaderSchema.safeParse({ cargo: "SUPERVISOR" }).success, true);
  assert.equal(editHeaderSchema.safeParse({ renovacion: "INVIERNO", cargo: "SUPERVISOR", lineas_confirmadas: [UUID] }).success, true);
  assert.equal(editHeaderSchema.safeParse({}).success, false, "sin ningún cambio");
  assert.equal(editHeaderSchema.safeParse({ lineas_confirmadas: [UUID] }).success, false);
  assert.equal(editHeaderSchema.safeParse({ renovacion: "PRIMAVERA" }).success, false);
  for (const extra of [{ estado: "Atendido" }, { cliente_id: UUID }, { agente_id: UUID }, { fecha: "2026-01-01" }, { referencia_interna: "X" }, { puesto_id: UUID }]) {
    assert.equal(editHeaderSchema.safeParse({ renovacion: "VERANO", ...extra }).success, false, Object.keys(extra)[0]);
  }
});

type Call = { name: string; args: Record<string, unknown> };
function setup(role: Profile["role"], opts: { estado?: "Pendiente" | "Observado" | "Atendido"; creator?: string; rpc?: (args: Record<string, unknown>) => { data?: unknown; error?: { code: string; message: string } } } = {}) {
  const profile: Profile = { id: "22222222-2222-4222-8222-222222222222", email: "c@example.test", nombre: "C", role };
  const payload = fixtureEdit();
  payload.requerimiento.estado = opts.estado ?? "Pendiente";
  payload.requerimiento.usuario_creador_id = opts.creator ?? profile.id;
  const calls: Call[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "obtener_edicion_prendas") return { data: payload as EditPayload, error: null };
    const out = opts.rpc?.(args) ?? { data: { ok: true, data: payload } };
    return { data: out.data ?? null, error: out.error ?? null };
  } } as unknown as SupabaseClient;
  const handler = makeEditHeaderHandler({ getProfile: async () => profile, getDb: async () => db });
  const call = (body: unknown) => handler(new Request("http://x/api", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), UUID);
  return { call, calls };
}
test("API cabecera: el coordinador dueño cambia renovación y cargo; la RPC recibe solo esos datos", async () => {
  const { call, calls } = setup("coordinador");
  const response = await call({ renovacion: "INVIERNO", cargo: "SUPERVISOR" });
  assert.equal(response.status, 200);
  const rpc = calls.find(c => c.name === "editar_cabecera_requerimiento")!;
  assert.deepEqual(rpc.args, { p_id: UUID, p_renovacion: "INVIERNO", p_cargo: "SUPERVISOR", p_lineas_confirmadas: null });
});
test("API cabecera: si hay prendas que no corresponden devuelve la lista para confirmar (sin guardar) y luego acepta la confirmación", async () => {
  const lineas = [{ id: UUID, prenda_id: UUID, codigo: "P-VER", nombre: "POLO", cantidad: 1 }];
  const first = setup("coordinador", { rpc: () => ({ data: { requiere_confirmacion: true, lineas } }) });
  const body = await (await first.call({ renovacion: "INVIERNO" })).json();
  assert.deepEqual(body, { requiere_confirmacion: true, lineas });
  const second = setup("coordinador");
  await second.call({ renovacion: "INVIERNO", lineas_confirmadas: [UUID] });
  assert.deepEqual(second.calls.find(c => c.name === "editar_cabecera_requerimiento")!.args.p_lineas_confirmadas, [UUID]);
});
test("API cabecera: coordinador ajeno 403, Atendido 409 (también superadmin), rol sin permiso 403, admin sí", async () => {
  assert.equal((await setup("coordinador", { creator: "33333333-3333-4333-8333-333333333333" }).call({ cargo: "AGENTE" })).status, 403);
  const attended = setup("coordinador", { estado: "Atendido" });
  assert.equal((await attended.call({ cargo: "AGENTE" })).status, 409);
  assert.equal(attended.calls.some(c => c.name === "editar_cabecera_requerimiento"), false, "ni siquiera llega a la RPC");
  assert.equal((await setup("superadmin", { estado: "Atendido" }).call({ cargo: "AGENTE" })).status, 409);
  assert.equal((await setup("agente").call({ cargo: "AGENTE" })).status, 403);
  assert.equal((await setup("admin", { creator: "33333333-3333-4333-8333-333333333333" }).call({ cargo: "AGENTE" })).status, 200);
});
test("API cabecera: campos de más y datos inválidos se rechazan con 400; los errores de la base llegan al usuario", async () => {
  const { call } = setup("coordinador");
  assert.equal((await call({ renovacion: "INVIERNO", estado: "Atendido" })).status, 400);
  assert.equal((await call({})).status, 400);
  const inactive = setup("coordinador", { rpc: () => ({ error: { code: "22023", message: "El cargo está inactivo: elige un cargo activo" } }) });
  const response = await inactive.call({ cargo: "DESCANSERO" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "El cargo está inactivo: elige un cargo activo");
  const attended = setup("coordinador", { rpc: () => ({ error: { code: "55000", message: "Este requerimiento ya fue atendido y no puede modificarse." } }) });
  assert.equal((await attended.call({ cargo: "AGENTE" })).status, 409);
});
test("el CSV de requerimientos trae el cargo con el que se pidió (no el actual de la ficha)", () => {
  const row = fixtureRequirement();
  row.cargo = "AGENTE DIA";
  assert.equal(toCsvRows(row)[0][4], "AGENTE DIA");
  row.cargo = null;
  assert.equal(toCsvRows(row)[0][4], row.personal?.cargo);
});
test("el Excel SIDIGE no cambia: sigue sin columna de cargo propia", async () => {
  const sidige = await readFile("lib/admin/sidige.ts", "utf8");
  assert.match(sidige, /SIDIGE_HEADERS = \["Comentario", "Ref\.Int\.", "Num\. Real", "Glosa", "Num\. Item", "Sub\. Alm\.", "Cod\. Articulo", "Des\. Articulo", "Cantidad Art\.", "Precio Art\."\]/);
});

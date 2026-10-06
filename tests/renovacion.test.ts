import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { catalogCreateSchema } from "../lib/admin/maintenance";
import { PRENDAS_REQUIRED_HEADERS, preparePrendasImport } from "../lib/admin/prendas-import";
import { makeEditGarmentsHandler } from "../lib/requirements/handlers";
import { requerimientoSchema } from "../lib/validations";
import { editGarmentsSchema } from "../lib/requirements/edit";
import { garmentChoices, garmentFits, normalizeRenovacion } from "../lib/garments/renovacion";
import { EMPTY_REQUIREMENT_FILTERS, parseRequirementQuery, requirementRpcArgs } from "../lib/requirements/list-filters";
import { EMPTY_FILTERS, filterParams, filterRpcArgs, parseAdminQuery } from "../lib/admin/filters";
import { editGarments, fixtureEdit, inviernoGarment } from "./fixtures/edit";
import type { Profile } from "../lib/types";

const garments = [...editGarments, inviernoGarment];
const ids = (rows: { id: string }[]) => rows.map(row => row.id);

// --- Filtro renovación + género -------------------------------------------------------------
test("una prenda aparece si su renovación es la elegida o AMBOS", () => {
  const verano = { genero: "AMBOS" as const, renovacion: "VERANO" as const };
  const invierno = { genero: "AMBOS" as const, renovacion: "INVIERNO" as const };
  const ambos = { genero: "AMBOS" as const, renovacion: "AMBOS" as const };
  assert.deepEqual([verano, invierno, ambos].map(g => garmentFits(g, "VERANO", "HOMBRE")), [true, false, true]);
  assert.deepEqual([verano, invierno, ambos].map(g => garmentFits(g, "INVIERNO", "MUJER")), [false, true, true]);
});
test("renovación y género se combinan: ambos criterios deben cumplirse", () => {
  const hombreInvierno = { genero: "HOMBRE" as const, renovacion: "INVIERNO" as const };
  assert.equal(garmentFits(hombreInvierno, "INVIERNO", "HOMBRE"), true);
  assert.equal(garmentFits(hombreInvierno, "INVIERNO", "MUJER"), false);
  assert.equal(garmentFits(hombreInvierno, "VERANO", "HOMBRE"), false);
  assert.equal(garmentFits({ genero: "HOMBRE", renovacion: "AMBOS" }, "VERANO", "MUJER"), false);
});
test("el catálogo de prueba se filtra por renovación + género", () => {
  const visible = (r: "VERANO" | "INVIERNO", g: "HOMBRE" | "MUJER") => ids(garments.filter(p => garmentFits(p, r, g)));
  assert.deepEqual(visible("VERANO", "HOMBRE"), [garments[0].id, garments[1].id]);
  assert.deepEqual(visible("VERANO", "MUJER"), [garments[1].id, garments[2].id]);
  assert.deepEqual(visible("INVIERNO", "HOMBRE"), [garments[0].id, garments[1].id, inviernoGarment.id]);
});
test("al cambiar renovación o género, solo se quitan las prendas que ya no corresponden", () => {
  const lines = [garments[0], inviernoGarment]; // camisa AMBOS/HOMBRE + abrigo INVIERNO
  assert.deepEqual(ids(lines.filter(p => garmentFits(p, "VERANO", "HOMBRE"))), [garments[0].id]);
  assert.deepEqual(ids(lines.filter(p => garmentFits(p, "INVIERNO", "MUJER"))), [inviernoGarment.id]);
});

// --- Importación con la columna Renovación (por cliente) ------------------------------------
const CLIENTE = "58000000-0000-4000-8000-000000000001";
function importDb(rpc: (name: string, args: Record<string, unknown>) => unknown = () => ({ data: emptyResult, error: null })) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { nombre: "RENIEC", activo: true }, error: null }) }) }) }),
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return rpc(name, args); },
  } as unknown as SupabaseClient;
  return { db, calls };
}
const emptyResult = { aplicado: false, cliente: "RENIEC", prendas_nuevas: 0, asignaciones_nuevas: 0, cantidades_actualizadas: 0, estados_actualizados: 0, sin_cambios: 0, alertas: [], conflictos: [], desactivar: [], fichas_inactivas: [] };
const prendaRow = (codigo: string, renovacion: string | undefined, extra: Record<string, string> = {}) => ({
  codigo_prenda: codigo, nombre_prenda: "Camisa", codigo_almacen: "A1", precio: "20.50", cantidad: "2", genero: "HOMBRE",
  ...(renovacion === undefined ? {} : { renovacion }), activo: "true", ...extra,
});
const prendaPayload = (rows: Record<string, string>[], headers: string[] = [...PRENDAS_REQUIRED_HEADERS]) => ({ kind: "prendas" as const, cliente_id: CLIENTE, mode: "preview" as const, headers, rows });

test("la plantilla de prendas incluye la columna renovacion antes de activo", () => {
  assert.deepEqual(PRENDAS_REQUIRED_HEADERS.slice(-2), ["renovacion", "activo"]);
});
test("normaliza Verano/Invierno/Ambos sin importar mayúsculas ni tildes", () => {
  for (const [input, expected] of [["Verano", "VERANO"], [" invierno ", "INVIERNO"], ["AMBOS", "AMBOS"], ["Ámbos", "AMBOS"], ["VERÁNO", "VERANO"]] as const) {
    assert.equal(normalizeRenovacion(input), expected);
  }
  for (const bad of ["otoño", "", "verano/invierno", undefined]) assert.equal(normalizeRenovacion(bad), null);
});
test("importación acepta la columna Renovación con tilde y cualquier mayúscula", async () => {
  const headers = ["codigo_prenda", "nombre_prenda", "codigo_almacen", "precio", "cantidad", "Género", "Renovación", "activo"];
  const rows = [
    { ...prendaRow("G1", undefined), "Género": "HOMBRE", "Renovación": "verano" },
    { ...prendaRow("G2", undefined), "Género": "MUJER", "Renovación": "INVIERNO" },
    { ...prendaRow("G3", undefined), "Género": "MUJER", "Renovación": "Ámbos" },
  ];
  const { db, calls } = importDb();
  const { preview } = await preparePrendasImport(db, prendaPayload(rows, headers));
  assert.equal(preview.errores, 0);
  assert.deepEqual((calls[0].args.p_filas as { renovacion: string }[]).map(r => r.renovacion), ["VERANO", "INVIERNO", "AMBOS"]);
});
test("importación con renovación inválida marca error indicando la fila", async () => {
  const { db, calls } = importDb();
  const { preview } = await preparePrendasImport(db, prendaPayload([prendaRow("G1", "Verano"), prendaRow("G2", "Otoño"), prendaRow("G3", "")]));
  assert.equal((calls[0].args.p_filas as unknown[]).length, 1);
  assert.deepEqual(preview.issues.map(i => [i.row, i.code, i.action]), [[3, "G2", "error"], [4, "G3", "error"]]);
  assert.match(preview.issues[0].message, /Renovación inválida "Otoño"/);
});
test("importación sin la columna renovacion se rechaza por encabezados", async () => {
  const headers = PRENDAS_REQUIRED_HEADERS.filter(h => h !== "renovacion");
  await assert.rejects(preparePrendasImport(importDb().db, prendaPayload([prendaRow("G1", undefined)], [...headers])), /Encabezados requeridos/);
});

// --- Renovación en el catálogo (prendas y unidades) ------------------------------------------
const garmentValues = { codigo_prenda: "G1", nombre_prenda: "Camisa", codigo_almacen: "A1", precio: 20, genero: "AMBOS" };
const asignacion = { cliente_id: CLIENTE, cantidad: 1, activo: true };
test("Mantenimiento → Prendas: la renovación va en cada asignación (VERANO, INVIERNO o AMBOS)", () => {
  for (const renovacion of ["VERANO", "INVIERNO", "AMBOS"]) assert.ok(catalogCreateSchema.safeParse({ catalogo: "prendas", valores: { ...garmentValues, asignaciones: [{ ...asignacion, renovacion }] } }).success);
  assert.ok(!catalogCreateSchema.safeParse({ catalogo: "prendas", valores: { ...garmentValues, asignaciones: [asignacion] } }).success);
  assert.ok(!catalogCreateSchema.safeParse({ catalogo: "prendas", valores: { ...garmentValues, asignaciones: [{ ...asignacion, renovacion: "OTOÑO" }] } }).success);
  // la ficha ya no lleva cliente, cantidad ni renovación
  assert.ok(!catalogCreateSchema.safeParse({ catalogo: "prendas", valores: { ...garmentValues, cantidad: 1 } }).success);
  assert.ok(!catalogCreateSchema.safeParse({ catalogo: "prendas", valores: { ...garmentValues, renovacion: "AMBOS" } }).success);
});
test("Mantenimiento → Unidades exige renovación por defecto Verano o Invierno (no AMBOS)", () => {
  const unit = { cliente_id: "58000000-0000-4000-8000-000000000001", nombre: "Sede" };
  for (const renovacion_defecto of ["VERANO", "INVIERNO"]) assert.ok(catalogCreateSchema.safeParse({ catalogo: "unidades", valores: { ...unit, renovacion_defecto } }).success);
  assert.ok(!catalogCreateSchema.safeParse({ catalogo: "unidades", valores: { ...unit, renovacion_defecto: "AMBOS" } }).success);
  assert.ok(!catalogCreateSchema.safeParse({ catalogo: "unidades", valores: unit }).success);
});
test("el formulario preselecciona la renovación por defecto de la unidad elegida y deja cambiarla", async () => {
  const source = await readFile("components/new-requirement.tsx", "utf8");
  assert.match(source, /onChange=\{e => changeUnit\(e\.target\.value\)\}/);
  assert.match(source, /requestChange\(\{ renovacion: next\.renovacion_defecto \}\)/);
  assert.match(source, /<RenovacionPicker value=\{renovacion\} disabled=\{saving\} onChange=\{value => requestChange\(\{ renovacion: value \}\)\}/);
  const hook = await readFile("components/use-active-catalog.ts", "utf8");
  assert.match(hook, /unidades: "id,cliente_id,nombre,renovacion_defecto,activo"/);
});

// --- Requerimiento: renovación obligatoria, filtros y detalle ---------------------------------
const base = { agente_id: "22000000-0000-4000-8000-000000000001", cliente_id: "55000000-0000-4000-8000-000000000001", unidad_id: "66000000-0000-4000-8000-000000000001", detalles: [{ prenda_id: garments[0].id }] };
test("crear requerimiento exige el tipo de renovación (Verano o Invierno)", () => {
  assert.ok(requerimientoSchema.safeParse({ ...base, renovacion: "INVIERNO" }).success);
  assert.ok(!requerimientoSchema.safeParse(base).success);
  assert.ok(!requerimientoSchema.safeParse({ ...base, renovacion: "AMBOS" }).success);
});
test("los filtros de requerimientos (propios y administración) aceptan y envían la renovación a la RPC", () => {
  const own = { ...EMPTY_REQUIREMENT_FILTERS, renovacion: "INVIERNO" as const };
  assert.equal(requirementRpcArgs(own).p_renovacion, "INVIERNO");
  assert.equal(requirementRpcArgs(EMPTY_REQUIREMENT_FILTERS).p_renovacion, null);
  assert.throws(() => parseRequirementQuery(new URLSearchParams("renovacion=OTOÑO")));
  const admin = { ...EMPTY_FILTERS, renovacion: "VERANO" as const };
  assert.deepEqual(parseAdminQuery(filterParams(admin)).filters, admin);
  assert.equal(filterRpcArgs(admin).p_renovacion, "VERANO");
  assert.throws(() => parseAdminQuery(new URLSearchParams("renovacion=OTOÑO")));
});
test("detalle y listados muestran la renovación del requerimiento", async () => {
  assert.match(await readFile("components/requirement-facts.tsx", "utf8"), /\["Renovación", row\.renovacion \? renovacionLabel\(row\.renovacion\)/);
  assert.match(await readFile("components/requirements-list.tsx", "utf8"), /renovacionLabel\(row\.renovacion\)/);
  assert.match(await readFile("components/admin-results.tsx", "utf8"), /renovacionLabel\(row\.renovacion\)/);
  assert.match(await readFile("lib/requerimientos.ts", "utf8"), /estado,renovacion,usuario_creador_id/);
});

// --- Prendas no repetidas dentro de un requerimiento ------------------------------------------
test("pantalla: la lista marca como 'Ya agregada' (gris, tachada, deshabilitada) lo ya elegido y lo libera al quitarlo", () => {
  const withOne = garmentChoices(garments, [garments[0].id]);
  assert.deepEqual(withOne.map(c => c.added), [true, false, false, false]);
  assert.deepEqual(garmentChoices(garments, []).map(c => c.added), [false, false, false, false]);
});
test("pantalla: los selectores de crear y editar deshabilitan y rotulan las prendas ya agregadas", async () => {
  for (const file of ["components/new-requirement.tsx", "components/edit-requirement.tsx"]) {
    const source = await readFile(file, "utf8");
    assert.match(source, /disabled=\{added\} className=\{added \? "text-\[#8794A8\] line-through" : undefined\}/, file);
    assert.match(source, /added \? " · Ya agregada" : ""/, file);
  }
});
test("servidor (esquemas): una prenda repetida se rechaza al crear y al editar", () => {
  const dup = [{ prenda_id: garments[0].id }, { prenda_id: garments[0].id }];
  assert.ok(!requerimientoSchema.safeParse({ ...base, renovacion: "VERANO", detalles: dup }).success);
  assert.ok(!editGarmentsSchema.safeParse({ version: "a".repeat(32), detalles: dup }).success);
});
function editHandler(rpcError?: string) {
  const payload = { version: "a".repeat(32), requerimiento: fixtureEdit().requerimiento };
  const profile: Profile = { id: payload.requerimiento.usuario_creador_id, email: "c@test.local", nombre: "C", role: "coordinador" };
  const db = { rpc: async (name: string) => name === "obtener_edicion_prendas" ? { data: payload, error: null } : { data: null, error: rpcError ? { code: rpcError } : null } } as unknown as SupabaseClient;
  return makeEditGarmentsHandler({ getProfile: async () => profile, getDb: async () => db });
}
const editBody = (detalles: unknown[]) => new Request("http://localhost/api/requerimientos/x/prendas", { method: "PATCH", body: JSON.stringify({ version: "a".repeat(32), detalles }) });
test("servidor (API): prenda repetida en el cuerpo → 400 sin llamar a la RPC; la RPC que la rechaza → 400", async () => {
  const id = fixtureEdit().requerimiento.id;
  const dup = [{ prenda_id: garments[0].id }, { prenda_id: garments[0].id }];
  assert.equal((await editHandler()(editBody(dup), id)).status, 400);
  for (const code of ["22023", "23505"]) assert.equal((await editHandler(code)(editBody([{ prenda_id: garments[0].id }]), id)).status, 400);
});

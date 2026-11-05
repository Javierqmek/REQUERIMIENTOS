import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeCsvBytes, parseCsv } from "../lib/admin/csv-import";
import { catalogCreateSchema, catalogUpdateSchema } from "../lib/admin/maintenance";
import { buildPrendasCsv, prendasExportFilename, PRENDAS_EXPORT_HEADERS, type PrendaExportRow } from "../lib/admin/prendas-export";
import { checkPrendasFile, preparePrendasImport, validatePrendasRows, type PrendasPreview } from "../lib/admin/prendas-import";
import { requerimientoSchema } from "../lib/validations";
import { filterRpcArgs, EMPTY_FILTERS } from "../lib/admin/filters";
import { EMPTY_REQUIREMENT_FILTERS, requirementRpcArgs } from "../lib/requirements/list-filters";

// Prendas por puesto (BCR) y exportación de prendas: validación de la importación, formato del CSV exportado y esquemas.
const BCR = "58000000-0000-4000-8000-000000000009";
const HEADERS = ["codigo_prenda", "nombre_prenda", "codigo_almacen", "precio", "cantidad", "cliente", "puesto", "genero", "renovacion", "activo"];
const CON_PUESTOS = { usa: true, puestos: [{ nombre: "Vigilante Masculino", activo: true }, { nombre: "Vigilante Masculino (Terno)", activo: true }, { nombre: "Vigilante Femenino", activo: false }] };
const row = (extra: Record<string, string> = {}) => ({
  codigo_prenda: "CAM-BL", nombre_prenda: "Camisa blanca manga corta", codigo_almacen: "UNF1", precio: "40", cantidad: "2", genero: "HOMBRE", renovacion: "AMBOS", activo: "sí", puesto: "Vigilante Masculino", ...extra,
});
const emptyPreview: PrendasPreview = { aplicado: false, cliente: "BCR", prendas_nuevas: 0, asignaciones_nuevas: 0, cantidades_actualizadas: 0, generos_actualizados: 0, estados_actualizados: 0, sin_cambios: 0, alertas: [], renovaciones_actualizadas: [], desactivar: [], fichas_inactivas: [], cambios_ficha: [] };
function fakeDb(usaPuestos: boolean) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = {
    from: (table: string) => ({ select: () => ({ eq: () => table === "puestos"
      ? { limit: async () => ({ data: CON_PUESTOS.puestos, error: null }) }
      : { maybeSingle: async () => ({ data: { nombre: "BCR", activo: true, diferencia_puestos: usaPuestos }, error: null }) } }) }),
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: emptyPreview, error: null }; },
  } as unknown as SupabaseClient;
  return { db, calls };
}
const payload = (rows: Record<string, string>[]) => ({ kind: "prendas", cliente_id: BCR, mode: "preview", headers: HEADERS, rows });

test("cliente con puestos: el puesto es obligatorio y debe existir (error con número de fila)", () => {
  const { valid, issues } = validatePrendasRows([row(), row({ puesto: "" }), row({ puesto: "Guardia" })], "BCR", [2, 3, 4], CON_PUESTOS);
  assert.deepEqual(valid.map(r => [r.fila, r.puesto]), [[2, "Vigilante Masculino"]]);
  assert.deepEqual(issues.map(i => i.row), [3, 4]);
  assert.match(issues[0].message, /puesto es obligatorio/);
  assert.match(issues[1].message, /"Guardia" no existe en el catálogo de BCR/);
});
test("el puesto se empareja sin distinguir mayúsculas y se envía con el nombre del catálogo", () => {
  const { valid } = validatePrendasRows([row({ puesto: " vigilante  masculino (terno) " .replace("  ", " ") })], "BCR", [2], CON_PUESTOS);
  assert.equal(valid[0].puesto, "Vigilante Masculino (Terno)");
});
test("un puesto inactivo solo admite filas inactivas", () => {
  const { valid, issues } = validatePrendasRows([row({ puesto: "Vigilante Femenino" }), row({ puesto: "Vigilante Femenino", activo: "no" })], "BCR", [2, 3], CON_PUESTOS);
  assert.deepEqual(issues.map(i => i.row), [2]);
  assert.match(issues[0].message, /está inactivo/);
  assert.deepEqual(valid.map(r => r.fila), [3]);
});
test("cliente sin puestos: la columna puesto con valor es error; vacía o ausente es válida", () => {
  const { valid, issues } = validatePrendasRows([row(), row({ puesto: "" }), { ...row(), puesto: undefined as unknown as string }], "RENIEC", [2, 3, 4]);
  assert.deepEqual(issues.map(i => i.row), [2]);
  assert.match(issues[0].message, /RENIEC no diferencia prendas por puesto/);
  assert.deepEqual(valid.map(r => [r.fila, r.puesto]), [[3, null], [4, null]]);
});
test("la misma prenda en dos puestos con cantidades distintas es válida; repetir dentro de un puesto es error", () => {
  const ok = validatePrendasRows([row({ cantidad: "2" }), row({ puesto: "Vigilante Masculino (Terno)", cantidad: "3" })], "BCR", [2, 3], CON_PUESTOS);
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(checkPrendasFile(ok.valid).issues, []);
  const dup = validatePrendasRows([row(), row({ cantidad: "9" })], "BCR", [2, 3], CON_PUESTOS);
  const checked = checkPrendasFile(dup.valid);
  assert.deepEqual(checked.issues.map(i => i.row), [2, 3]);
  assert.match(checked.issues[0].message, /en el puesto "Vigilante Masculino"/);
});
test("AMBOS contra VERANO solo choca dentro del mismo puesto", () => {
  const apart = validatePrendasRows([row({ renovacion: "AMBOS" }), row({ puesto: "Vigilante Masculino (Terno)", renovacion: "Verano" })], "BCR", [2, 3], CON_PUESTOS);
  assert.deepEqual(checkPrendasFile(apart.valid).issues, []);
  const same = validatePrendasRows([row({ renovacion: "AMBOS" }), row({ renovacion: "Verano" })], "BCR", [2, 3], CON_PUESTOS);
  assert.deepEqual(checkPrendasFile(same.valid).issues.map(i => i.row), [2, 3]);
});
test("la ficha (precio) debe ser igual aunque la prenda esté en varios puestos", () => {
  const { valid } = validatePrendasRows([row(), row({ puesto: "Vigilante Masculino (Terno)", precio: "45" })], "BCR", [2, 3], CON_PUESTOS);
  assert.match(checkPrendasFile(valid).issues[0].message, /precio distinto/);
});
test("de punta a punta: con puestos el RPC recibe el puesto de cada fila; sin puestos no se consulta el catálogo", async () => {
  const withPuestos = fakeDb(true);
  const { preview } = await preparePrendasImport(withPuestos.db, payload([row(), row({ puesto: "vigilante masculino (terno)", cantidad: "3" })]));
  assert.equal(preview.errores, 0);
  assert.deepEqual((withPuestos.calls[0].args.p_filas as { puesto: string }[]).map(r => r.puesto), ["Vigilante Masculino", "Vigilante Masculino (Terno)"]);
  const missing = await preparePrendasImport(fakeDb(true).db, payload([row({ puesto: "" })]));
  assert.equal(missing.preview.errores, 1);
  const plain = fakeDb(false);
  const result = await preparePrendasImport(plain.db, payload([row({ puesto: "" })]));
  assert.equal(result.preview.errores, 0);
  assert.equal((plain.calls[0].args.p_filas as { puesto: string | null }[])[0].puesto, null);
});
test("filas de prendas sin asignación (de la exportación) se ignoran sin error", () => {
  const sola = { codigo_prenda: "SOLA-01", nombre_prenda: "Sin asignación", codigo_almacen: "UNF9", precio: "9.50", cantidad: "", cliente: "", puesto: "", genero: "", renovacion: "", activo: "sí" };
  const { valid, issues } = validatePrendasRows([sola, row()], "BCR", [2, 3], CON_PUESTOS);
  assert.deepEqual(issues, []);
  assert.deepEqual(valid.map(r => r.fila), [3]);
});

const exportRows: PrendaExportRow[] = [
  { codigo_prenda: "0012", nombre_prenda: "Camisa blanca, manga corta", codigo_almacen: "00345", precio: "40.00", cantidad: 2, cliente: "BCR", puesto: "Vigilante Masculino", genero: "HOMBRE", renovacion: "AMBOS", activo: true },
  { codigo_prenda: "CAM-BL", nombre_prenda: "Camisa \"blanca\"", codigo_almacen: "UNF1", precio: "40.00", cantidad: 3, cliente: "BCR", puesto: "Vigilante Masculino (Terno)", genero: "HOMBRE", renovacion: "VERANO", activo: false },
  { codigo_prenda: "SOLA-01", nombre_prenda: "Prenda sin asignación", codigo_almacen: "UNF9", precio: "9.50", cantidad: null, cliente: null, puesto: null, genero: null, renovacion: null, activo: true },
];
test("el CSV exportado es UTF-8 con BOM, separado por ; y con los encabezados de la importación", () => {
  const csv = buildPrendasCsv(exportRows);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  const bytes = new TextEncoder().encode(csv);
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.equal(csv.split("\r\n")[0].slice(1), PRENDAS_EXPORT_HEADERS.map(h => `"${h}"`).join(";"));
  assert.deepEqual([...PRENDAS_EXPORT_HEADERS], HEADERS);
});
test("los códigos con solo dígitos se exportan como texto (sus ceros iniciales no se pierden en Excel)", () => {
  const csv = buildPrendasCsv(exportRows);
  assert.match(csv, /"=""0012""";/);
  assert.match(csv, /"=""00345""";/);
  assert.doesNotMatch(csv, /"CAM-BL";.*="/);
});
test("exportar y volver a leer el mismo archivo da las mismas filas (0 cambios) y conserva ceros, comas y comillas", () => {
  const csv = parseCsv(decodeCsvBytes(new TextEncoder().encode(buildPrendasCsv(exportRows))));
  assert.equal(csv.delimiter, ";");
  assert.equal(csv.rows.length, 3);
  const { valid, issues } = validatePrendasRows(csv.rows, "BCR", csv.filas, { usa: true, puestos: [{ nombre: "Vigilante Masculino", activo: true }, { nombre: "Vigilante Masculino (Terno)", activo: true }] });
  assert.deepEqual(issues, []);
  assert.deepEqual(valid.map(r => [r.codigo_prenda, r.codigo_almacen, r.nombre_prenda, r.precio, r.cantidad, r.puesto, r.genero, r.renovacion, r.activo]), [
    ["0012", "00345", "Camisa blanca, manga corta", 40, 2, "Vigilante Masculino", "HOMBRE", "AMBOS", true],
    ["CAM-BL", "UNF1", "Camisa \"blanca\"", 40, 3, "Vigilante Masculino (Terno)", "HOMBRE", "VERANO", false],
  ]);
});
test("Excel puede guardar VERDADERO/FALSO: la importación lo entiende", () => {
  const { valid, issues } = validatePrendasRows([row({ activo: "VERDADERO" }), row({ puesto: "Vigilante Masculino (Terno)", activo: "FALSO" })], "BCR", [2, 3], CON_PUESTOS);
  assert.deepEqual(issues, []);
  assert.deepEqual(valid.map(r => r.activo), [true, false]);
});
test("el nombre del archivo exportado indica el cliente y la fecha", () => {
  assert.equal(prendasExportFilename(new Date("2026-11-05T12:00:00Z"), "Banco Central de Reserva"), "prendas-banco-central-de-reserva-2026-11-05.csv");
  assert.equal(prendasExportFilename(new Date("2026-11-05T12:00:00Z")), "prendas-todos-2026-11-05.csv");
});

test("Mantenimiento: cliente con la opción, puestos y asignaciones con puesto pasan el esquema", () => {
  assert.equal(catalogCreateSchema.safeParse({ catalogo: "clientes", valores: { nombre: "BCR", diferencia_puestos: true } }).success, true);
  assert.equal(catalogCreateSchema.safeParse({ catalogo: "clientes", valores: { nombre: "RENIEC" } }).success, true);
  assert.equal(catalogCreateSchema.safeParse({ catalogo: "puestos", valores: { cliente_id: BCR, nombre: "Vigilante Masculino" } }).success, true);
  assert.equal(catalogCreateSchema.safeParse({ catalogo: "puestos", valores: { cliente_id: BCR, nombre: " " } }).success, false);
  assert.equal(catalogUpdateSchema.safeParse({ catalogo: "puestos", id: BCR, valores: { cliente_id: BCR, nombre: "Otro", extra: 1 } }).success, false);
  const asignacion = { cliente_id: BCR, renovacion: "AMBOS", genero: "HOMBRE", cantidad: 2, activo: true };
  const garment = (a: Record<string, unknown>) => catalogCreateSchema.safeParse({ catalogo: "prendas", valores: { codigo_prenda: "X", nombre_prenda: "X", codigo_almacen: "X", precio: 1, asignaciones: [a] } }).success;
  assert.equal(garment({ ...asignacion, puesto_id: BCR }), true);
  assert.equal(garment({ ...asignacion, puesto_id: null }), true);
  assert.equal(garment(asignacion), true);
  assert.equal(garment({ ...asignacion, puesto_id: "no-uuid" }), false);
});
test("el requerimiento acepta un puesto opcional (obligatorio solo para clientes con puestos, lo exige la pantalla y la base)", () => {
  const base = { agente_id: BCR, cliente_id: BCR, unidad_id: BCR, renovacion: "VERANO", genero: "HOMBRE", detalles: [{ prenda_id: BCR }] };
  assert.equal(requerimientoSchema.safeParse(base).success, true);
  assert.equal(requerimientoSchema.safeParse({ ...base, puesto_id: BCR }).success, true);
  assert.equal(requerimientoSchema.safeParse({ ...base, puesto_id: "x" }).success, false);
});
test("los filtros de requerimientos envían el puesto a las RPC", () => {
  assert.equal(requirementRpcArgs({ ...EMPTY_REQUIREMENT_FILTERS, puesto: BCR }).p_puesto_id, BCR);
  assert.equal(requirementRpcArgs(EMPTY_REQUIREMENT_FILTERS).p_puesto_id, null);
  assert.equal(filterRpcArgs({ ...EMPTY_FILTERS, puesto: BCR }).p_puesto_id, BCR);
});
test("la pantalla de requerimientos pide el puesto solo si el cliente lo usa y la edición lo respeta", async () => {
  const form = await readFile("components/new-requirement.tsx", "utf8");
  assert.match(form, /const usesPuestos = client\?\.diferencia_puestos === true;/);
  assert.match(form, /\{unit && usesPuestos && <div className="mt-4">/);
  assert.ok(form.indexOf("htmlFor=\"puesto\"") < form.indexOf("<GarmentGenderPicker"), "Puesto va antes de Género");
  assert.match(form, /p_puesto_id: parsed\.data\.puesto_id \?\? null/);
});

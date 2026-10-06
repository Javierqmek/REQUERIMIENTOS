import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeCsvBytes, parseCsv } from "../lib/admin/csv-import";
import { checkPrendasFile, ImportInputError, normalizeGenero, parsePrecio, preparePrendasImport, validatePrendasRows, type PrendasPreview } from "../lib/admin/prendas-import";

// Importación de prendas POR CLIENTE: limpieza, repetidos dentro del archivo, alertas, reemplazo y codificación.
const INDECOPI = "58000000-0000-4000-8000-000000000002";
const HEADERS = ["codigo_prenda", "nombre_prenda", "codigo_almacen", "precio", "cantidad", "genero", "renovacion", "activo"];
const row = (codigo: string, renovacion: string, extra: Record<string, string> = {}) => ({
  codigo_prenda: codigo, nombre_prenda: "Bloqueador", codigo_almacen: "UNF9", precio: "12", cantidad: "6", genero: "AMBOS", renovacion, activo: "true", ...extra,
});
const emptyPreview: PrendasPreview = { aplicado: false, cliente: "INDECOPI", prendas_nuevas: 0, asignaciones_nuevas: 0, cantidades_actualizadas: 0, generos_actualizados: 0, estados_actualizados: 0, sin_cambios: 0, alertas: [], renovaciones_actualizadas: [], desactivar: [], fichas_inactivas: [], cambios_ficha: [] };
function fakeDb(result: Partial<PrendasPreview> = {}, rpcError?: { code: string; message: string }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { nombre: "INDECOPI", activo: true }, error: null }) }) }) }),
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return rpcError ? { data: null, error: rpcError } : { data: { ...emptyPreview, ...result }, error: null }; },
  } as unknown as SupabaseClient;
  return { db, calls };
}
const payload = (rows: Record<string, string>[], extra: Record<string, unknown> = {}) => ({ kind: "prendas", cliente_id: INDECOPI, mode: "preview", headers: HEADERS, rows, ...extra });
const sentRows = (calls: { args: Record<string, unknown> }[]) => calls[0].args.p_filas as { fila: number; codigo_prenda: string; renovacion: string; cantidad: number; codigo_almacen: string }[];

test("el mismo bloqueador con Verano 6 e Invierno 3 son dos asignaciones válidas (no se sobrescriben)", async () => {
  const { db, calls } = fakeDb();
  const { preview } = await preparePrendasImport(db, payload([row("ACS0206", "Verano", { cantidad: "6" }), row("ACS0206", "Invierno", { cantidad: "3" })]));
  assert.equal(preview.errores, 0);
  assert.deepEqual(sentRows(calls).map(r => [r.fila, r.renovacion, r.cantidad]), [[2, "VERANO", 6], [3, "INVIERNO", 3]]);
});
test("dos filas con el mismo código, cliente y renovación son error en ambas, con sus números de fila", async () => {
  const { db, calls } = fakeDb();
  const { preview } = await preparePrendasImport(db, payload([row("ACS0206", "Verano", { cantidad: "6" }), row("OTRA", "Ambos"), row("ACS0206", "Verano", { cantidad: "9" })]));
  assert.deepEqual(preview.issues.map(i => [i.row, i.code]), [[2, "ACS0206"], [4, "ACS0206"]]);
  assert.match(preview.issues[0].message, /filas 2 y 4/);
  assert.deepEqual(sentRows(calls).map(r => r.codigo_prenda), ["OTRA"]);
});
test("el mismo código con precios distintos dentro del archivo es error (no se elige uno por el usuario)", async () => {
  const { db, calls } = fakeDb();
  const { preview } = await preparePrendasImport(db, payload([row("ACS0206", "Verano", { precio: "12" }), row("ACS0206", "Invierno", { precio: "15" })]));
  assert.equal(preview.errores, 2);
  assert.match(preview.issues[0].message, /precio distinto en el archivo: S\/ 12 \(fila 2\) y S\/ 15 \(fila 3\)/);
  assert.equal(calls.length, 0, "sin filas válidas no se consulta a la base");
});
test("AMBOS junto con VERANO o INVIERNO en el MISMO archivo para el mismo código es error", () => {
  const { valid } = validatePrendasRows([row("X1", "Ambos"), row("X1", "Verano")], "INDECOPI");
  const { ok, issues } = checkPrendasFile(valid);
  assert.equal(ok.length, 0);
  assert.equal(issues.length, 2);
  assert.match(issues[0].message, /combina AMBOS con VERANO o INVIERNO/);
});
test("el mismo código con género distinto en el mismo archivo NO es error: el género es de cada asignación", () => {
  const { valid } = validatePrendasRows([row("X1", "Verano", { genero: "Hombre" }), row("X1", "Invierno", { genero: "Mujer" })], "INDECOPI");
  const { ok, issues } = checkPrendasFile(valid);
  assert.deepEqual(issues, []);
  assert.deepEqual(ok.map(r => r.genero), ["HOMBRE", "MUJER"]);
});
test("limpia espacios en todos los campos (p. ej. codigo_almacen \"UNF1 \")", () => {
  const { valid, issues } = validatePrendasRows([{ codigo_prenda: "  COR001 ", nombre_prenda: " CORBATA ", codigo_almacen: "UNF1 ", precio: " 15 ", cantidad: " 2 ", genero: " unisex ", renovacion: " verano ", activo: " Sí " }], "INDECOPI");
  assert.deepEqual(issues, []);
  assert.deepEqual(valid[0], { fila: 2, codigo_prenda: "COR001", nombre_prenda: "CORBATA", codigo_almacen: "UNF1", precio: 15, cantidad: 2, genero: "AMBOS", renovacion: "VERANO", activo: true });
});
test("género acepta Hombre/Mujer/Ambos/Unisex y rechaza lo demás; cliente distinto en el archivo es error de esa fila", () => {
  assert.deepEqual(["Hombre", "MUJER", "ámbos", "Unisex", "hombre / mujer"].map(normalizeGenero), ["HOMBRE", "MUJER", "AMBOS", "AMBOS", "AMBOS"]);
  assert.equal(normalizeGenero("niños"), null);
  const { valid, issues } = validatePrendasRows([row("A", "Verano", { cliente: "RENIEC" }), row("B", "Verano", { cliente: "indecopi" })], "INDECOPI");
  assert.deepEqual(valid.map(r => r.codigo_prenda), ["B"]);
  assert.match(issues[0].message, /cliente "RENIEC".*"INDECOPI"/);
});
test("solo se envían a la base el cliente elegido y las filas válidas, con las decisiones de ficha (alcance) y el modo de reemplazo", async () => {
  const { db, calls } = fakeDb();
  await preparePrendasImport(db, payload([row("CAM001", "Ambos")], { mode: "apply", actualizar: { CAM001: "tramite" }, reemplazar: false }));
  assert.equal(calls[0].name, "admin_importar_prendas");
  assert.deepEqual({ ...calls[0].args, p_filas: undefined }, { p_cliente_id: INDECOPI, p_filas: undefined, p_aplicar: true, p_actualizar: { CAM001: "tramite" }, p_reemplazar: false });
});
test("el alcance de la actualización solo admite ahora, tramite o todos", async () => {
  await assert.rejects(preparePrendasImport(fakeDb().db, payload([row("CAM001", "Ambos")], { actualizar: { CAM001: "siempre" } })));
});
test("la vista previa (modo preview) nunca pide aplicar", async () => {
  const { db, calls } = fakeDb();
  await preparePrendasImport(db, payload([row("CAM001", "Ambos")]));
  assert.equal(calls[0].args.p_aplicar, false);
});
test("alertas de ficha con su impacto, renovaciones actualizadas y asignaciones a desactivar vuelven en la vista previa", async () => {
  const impacto = { precio_cambia: true, almacen_cambia: false, tramite: { requerimientos: 2, lineas: 3 }, todos: { requerimientos: 4, lineas: 5 } };
  const { db } = fakeDb({
    prendas_nuevas: 1, asignaciones_nuevas: 2, cantidades_actualizadas: 1, generos_actualizados: 1,
    alertas: [{ codigo: "CAM001", nombre: "CAMISA", cambios: [{ campo: "precio", actual: "40.00", archivo: "45.00" }], impacto }],
    renovaciones_actualizadas: [{ codigo: "COR001", nombre: "CORBATA", de: "AMBOS", a: "VERANO" }],
    desactivar: [{ codigo: "OLD1", nombre: "ANTIGUA", renovacion: "VERANO", cantidad: 2 }],
  });
  const { preview } = await preparePrendasImport(db, payload([row("CAM001", "Ambos")], { reemplazar: true }));
  assert.equal(preview.prendas.alertas[0].cambios[0].actual, "40.00");
  assert.equal(preview.prendas.alertas[0].impacto?.tramite.lineas, 3);
  assert.deepEqual(preview.prendas.renovaciones_actualizadas[0], { codigo: "COR001", nombre: "CORBATA", de: "AMBOS", a: "VERANO" });
  assert.equal(preview.prendas.desactivar.length, 1);
  assert.equal(preview.nuevos, 2);
  assert.equal(preview.actualizados, 1);
  assert.deepEqual(preview.issues, []);
});
test("reemplazar el catálogo no se aplica si el archivo tiene errores", async () => {
  const { db, calls } = fakeDb();
  await assert.rejects(preparePrendasImport(db, payload([row("A", "Verano"), row("B", "Otoño")], { mode: "apply", reemplazar: true })), ImportInputError);
  assert.equal(calls.length, 0);
});
test("los mensajes de la base (22023/23P01...) llegan al usuario; los demás errores no filtran detalles", async () => {
  await assert.rejects(preparePrendasImport(fakeDb({}, { code: "22023", message: "Selecciona un cliente activo" }).db, payload([row("A", "Verano")])), /Selecciona un cliente activo/);
  await assert.rejects(preparePrendasImport(fakeDb({}, { code: "XX000", message: "detalle interno" }).db, payload([row("A", "Verano")])), /No se pudo procesar la importación\./);
});
test("encabezados: sin tildes ni mayúsculas, en cualquier orden, con cliente opcional; faltantes o desconocidos se rechazan", async () => {
  const { db } = fakeDb();
  await preparePrendasImport(db, payload([{ Código_Prenda: "A", NOMBRE_PRENDA: "N", codigo_almacen: "U", precio: "1", cantidad: "1", Género: "Ambos", "Renovación": "Verano", activo: "sí", cliente: "INDECOPI" }],
    { headers: ["Código_Prenda", "NOMBRE_PRENDA", "codigo_almacen", "precio", "cantidad", "cliente", "Género", "Renovación", "activo"] }));
  await assert.rejects(preparePrendasImport(db, payload([row("A", "Verano")], { headers: [...HEADERS, "extra"] })), /Encabezados requeridos/);
  await assert.rejects(preparePrendasImport(db, payload([row("A", "Verano")], { headers: HEADERS.filter(h => h !== "cantidad") })), /Encabezados requeridos/);
});

// --- Codificación del CSV -----------------------------------------------------------------------
const csvText = "codigo_prenda,nombre_prenda\nA1,Camisa Ñandú áéíóú";
test("decodeCsvBytes lee UTF-8 (con o sin BOM)", () => {
  const utf8 = new TextEncoder().encode(csvText);
  assert.equal(decodeCsvBytes(utf8), csvText);
  assert.equal(decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])), csvText);
});
test("decodeCsvBytes lee Windows-1252 sin romper tildes ni la ñ", () => {
  const ansi = Buffer.from(csvText, "latin1");
  assert.notEqual(new TextDecoder("utf-8").decode(ansi), csvText, "como UTF-8 se vería roto");
  assert.equal(decodeCsvBytes(ansi), csvText);
  assert.equal(parseCsv(decodeCsvBytes(ansi)).rows[0].nombre_prenda, "Camisa Ñandú áéíóú");
});

// --- Formulario: solo prendas asignadas al cliente, con su cantidad -----------------------------
test("el formulario pide al servidor las prendas del cliente y la renovación elegidos (no las filtra por texto)", async () => {
  const hook = await readFile("components/use-client-garments.ts", "utf8");
  assert.match(hook, /rpc\("listar_prendas_cliente", \{ p_cliente_id: clienteId, p_renovacion: renovacion \}\)/);
  assert.match(await readFile("components/new-requirement.tsx", "utf8"), /useClientGarments\(supabase, .*clientId, renovacion\)/);
  assert.match(await readFile("components/edit-requirement.tsx", "utf8"), /useClientGarments\(db, .*row\.cliente_id, row\.renovacion\)/);
  assert.doesNotMatch(await readFile("components/use-active-catalog.ts", "utf8"), /prendas/);
});

// --- Excel en español: separador, moneda, filas vacías y número de fila original ----------------
test("parsePrecio acepta moneda (S/ 60.00, S/ 1,250.50), coma decimal y rechaza lo ambiguo", () => {
  const cases: [string, number | null][] = [["S/ 60.00", 60], ["S/ 1,250.50", 1250.5], ["S/1,250", 1250], ["s/. 45", 45], ["60", 60], ["60,5", 60.5], ["1.250,50", 1250.5], ["1,250.50", 1250.5], [" S/ 12.5 ", 12.5], ["PEN 8", 8], ["12.345", null], ["abc", null], ["", null], ["-5", null]];
  for (const [input, expected] of cases) assert.equal(parsePrecio(input), expected, input);
});
test("validatePrendasRows acepta el precio con formato de moneda", () => {
  const { valid, issues } = validatePrendasRows([row("A", "Ambos", { precio: "S/ 1,250.50" })], "INDECOPI");
  assert.deepEqual(issues, []);
  assert.equal(valid[0].precio, 1250.5);
});
test("CSV de Excel en español: separador ; autodetectado (y , sigue funcionando)", () => {
  const semi = parseCsv("codigo_prenda;nombre_prenda;precio\r\nA1;Camisa, manga larga;S/ 1,250.50\r\n");
  assert.equal(semi.delimiter, ";");
  assert.deepEqual(semi.rows, [{ codigo_prenda: "A1", nombre_prenda: "Camisa, manga larga", precio: "S/ 1,250.50" }]);
  assert.equal(parseCsv("codigo_prenda,nombre_prenda,precio\nA1,Camisa,60").delimiter, ",");
  assert.equal(parseCsv("a\tb\n1\t2").delimiter, "\t");
  assert.equal(parseCsv("sep=;\na;b\n1;2").rows[0].b, "2");
  assert.equal(parseCsv("﻿a;b\n1;2").headers[0], "a");
});
test("filas totalmente vacías (;;;;;;;) se ignoran y no cuentan; el número de fila original se conserva", () => {
  const parsed = parseCsv("codigo_prenda;precio;cantidad\n;;\nA1;1;1\n;;;;;;;\n\nA2;2;2\n;;");
  assert.deepEqual(parsed.rows.map(r => r.codigo_prenda), ["A1", "A2"]);
  assert.deepEqual(parsed.filas, [3, 6]);
  const many = "a;b\n" + Array.from({ length: 1500 }, () => ";").join("\n") + "\n1;2";
  assert.equal(parseCsv(many).rows.length, 1);
});
test("columnas vacías al final (Excel) se ignoran, pero una fila con datos de más o de menos es error con su fila", () => {
  assert.equal(parseCsv("a;b;;\n1;2;;").headers.length, 2);
  assert.throws(() => parseCsv("a;b\n1;2\n3"), /fila 3/);
  assert.throws(() => parseCsv("a;b\n1;2;9"), /fila 2/);
});
test("los errores indican la fila ORIGINAL del archivo, no la posición tras quitar filas vacías", async () => {
  const csv = parseCsv("codigo_prenda;nombre_prenda;codigo_almacen;precio;cantidad;genero;renovacion;activo\n;;;;;;;\nA1;N;U;S/ 10.50;1;Hombre;Otoño;sí\n");
  const { db } = fakeDb();
  const { preview } = await preparePrendasImport(db, { kind: "prendas", cliente_id: INDECOPI, mode: "preview", headers: csv.headers, rows: csv.rows, filas: csv.filas });
  assert.deepEqual(preview.issues.map(i => i.row), [3]);
});
test("Excel con ; y precios con S/: de punta a punta llega a la base limpio", async () => {
  const csv = parseCsv("codigo_prenda;nombre_prenda;codigo_almacen;precio;cantidad;genero;renovacion;activo\nA1;Bloqueador;UNF9 ;S/ 1,250.50;6;Unisex;Verano;sí\n;;;;;;;\nA1;Bloqueador;UNF9;S/ 1,250.50;3;Unisex;Invierno;sí");
  const { db, calls } = fakeDb();
  const { preview } = await preparePrendasImport(db, { kind: "prendas", cliente_id: INDECOPI, mode: "preview", headers: csv.headers, rows: csv.rows, filas: csv.filas });
  assert.equal(preview.errores, 0);
  assert.deepEqual(sentRows(calls).map(r => [r.fila, r.renovacion, r.cantidad, r.codigo_almacen]), [[2, "VERANO", 6, "UNF9"], [4, "INVIERNO", 3, "UNF9"]]);
});
test("una sola fila con otra renovación reemplaza la vigente: la vista previa lo informa y no es error", async () => {
  const { db } = fakeDb({ renovaciones_actualizadas: [{ codigo: "COR001", nombre: "CORBATA", de: "AMBOS", a: "VERANO" }] });
  const { preview } = await preparePrendasImport(db, payload([row("COR001", "Verano")]));
  assert.equal(preview.errores, 0);
  assert.equal(preview.prendas.renovaciones_actualizadas[0].de, "AMBOS");
});
test("la importación ya no tiene alertas de género: solo precio, nombre y código de almacén", async () => {
  assert.doesNotMatch(await readFile("lib/admin/prendas-import.ts", "utf8"), /\["genero", "género"\]/);
});

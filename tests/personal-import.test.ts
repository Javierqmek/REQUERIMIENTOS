import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeCsvBytes, parseCsv } from "../lib/admin/csv-import";
import { ImportInputError } from "../lib/admin/prendas-import";
import { checkPersonalFile, checkDni, preparePersonalImport, validatePersonalRows, type PersonalPreview } from "../lib/admin/personal-import";

// Importación de personal por DNI: CSV guardado por Excel en Perú (; + BOM + DNI sin cero inicial + filas vacías + >1000 filas).
const emptyPreview: PersonalPreview = { aplicado: false, nuevos: 0, sin_cambios: 0, actualizados: 0, diferencias: [], errores: [] };
function fakeDb(result: Partial<PersonalPreview> = {}, rpcError?: { code: string; message: string }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return rpcError ? { data: null, error: rpcError } : { data: { ...emptyPreview, ...result }, error: null }; } } as unknown as SupabaseClient;
  return { db, calls };
}
type Sent = { fila: number; codigo_personal: string; nombre: string; dni: string; cargo: string | null; activo: boolean };
const sent = (calls: { args: Record<string, unknown> }[]) => calls[0].args.p_filas as Sent[];

// Como lo guarda Excel con configuración regional de Perú ("CSV (delimitado por comas)" usa ;): BOM, CRLF, DNI numéricos sin cero, filas vacías.
function excelPeru(rows: number) {
  const lines = ["codigo_personal;nombre;dni;activo"];
  for (let i = 1; i <= rows; i++) {
    const dni = i % 10 === 0 ? String(1000000 + i) : String(10000000 + i); // cada 10.ª: 7 dígitos (Excel quitó el 0 inicial): error
    lines.push(`SEG-${i};PÉREZ NÚÑEZ ${i};${dni};${i % 7 === 0 ? "no" : "sí"}`);
    if (i % 100 === 0) lines.push(";;;");
  }
  lines.push(";;;", ";;;");
  return "﻿" + lines.join("\r\n") + "\r\n";
}
const payloadFrom = (csv: ReturnType<typeof parseCsv>, extra: Record<string, unknown> = {}) => ({ kind: "personal", mode: "preview", headers: csv.headers, rows: csv.rows, filas: csv.filas, ...extra });

test("CSV de Excel Perú (; + BOM + CRLF, UTF-8): se lee sin los ';;;' vacíos y con más de 1000 filas", () => {
  const csv = parseCsv(decodeCsvBytes(new TextEncoder().encode(excelPeru(1500))));
  assert.equal(csv.delimiter, ";");
  assert.deepEqual(csv.headers, ["codigo_personal", "nombre", "dni", "activo"]);
  assert.equal(csv.rows.length, 1500);
  assert.equal(csv.rows[0].nombre, "PÉREZ NÚÑEZ 1");
  assert.equal(csv.filas[0], 2);
  assert.equal(csv.filas[100], 103, "el número de fila original salta las filas vacías intermedias");
});
test("el mismo archivo guardado como Windows-1252 conserva las tildes y la ñ", () => {
  const csv = parseCsv(decodeCsvBytes(Buffer.from(excelPeru(5).replace("﻿", ""), "latin1")));
  assert.equal(csv.rows[0].nombre, "PÉREZ NÚÑEZ 1");
});
test("de punta a punta: 1500 filas, los DNI de 7 dígitos son error (no se completan) con fila, nombre y DNI tal como vino", async () => {
  const csv = parseCsv(decodeCsvBytes(new TextEncoder().encode(excelPeru(1500))));
  const { db, calls } = fakeDb({ nuevos: 1500 });
  const { preview } = await preparePersonalImport(db, payloadFrom(csv));
  assert.equal(calls.length, 1, "una sola llamada (transacción única), sin lotes");
  assert.equal(sent(calls).length, 1350);
  assert.ok(sent(calls).every(row => /^\d{8}$/.test(row.dni)), "todos los DNI llegan como texto de 8 dígitos");
  assert.ok(!sent(calls).some(row => row.dni.startsWith("0")), "nunca se completan ceros");
  assert.equal(preview.errores, 150);
  assert.deepEqual(preview.issues[0], { row: 11, code: "SEG-10", message: "DNI con 7 dígitos: 1000010", action: "error", nombre: "PÉREZ NÚÑEZ 10", dni: "1000010" });
  assert.equal(sent(calls)[6].activo, false);
  assert.equal(sent(calls)[0].cargo, null, "sin columna cargo: el cargo por defecto lo pone la base");
});
test("las filas solo llevan los campos permitidos: nunca profile_id, email ni vinculación", async () => {
  const csv = parseCsv("codigo_personal;nombre;dni;activo;profile_id\nA;N;12345678;sí;x");
  await assert.rejects(preparePersonalImport(fakeDb().db, payloadFrom(csv)), /Encabezados requeridos/);
  const ok = parseCsv("codigo_personal;nombre;dni;activo\nA;N;12345678;sí");
  const { db, calls } = fakeDb();
  await preparePersonalImport(db, payloadFrom(ok));
  assert.deepEqual(Object.keys(sent(calls)[0]).sort(), ["activo", "cargo", "codigo_personal", "dni", "fila", "nombre"]);
});
test("DNI estricto: exactamente 8 dígitos; menos, más, letras o vacío son error con motivo", () => {
  assert.deepEqual(checkDni("12345678"), { dni: "12345678" });
  assert.deepEqual(checkDni("'01234567"), { dni: "01234567" });
  assert.deepEqual(checkDni("1234567"), { error: "DNI con 7 dígitos: 1234567" });
  assert.deepEqual(checkDni("123456789"), { error: "DNI con 9 dígitos: 123456789" });
  assert.deepEqual(checkDni("12A45678"), { error: "DNI con caracteres no numéricos: 12A45678" });
  for (const bad of ["", "   ", "1234 5678", "12345678.0", "-1234567"]) assert.ok("error" in checkDni(bad), bad);
});
test("errores con número de fila: DNI vacío o inválido, código o nombre vacío, estado inválido", () => {
  const rows = [
    { codigo_personal: "A", nombre: "N", dni: "", activo: "sí" },
    { codigo_personal: "B", nombre: "N", dni: "ABC", activo: "sí" },
    { codigo_personal: "", nombre: "N", dni: "12345678", activo: "sí" },
    { codigo_personal: "D", nombre: "", dni: "12345678", activo: "sí" },
    { codigo_personal: "E", nombre: "N", dni: "12345678", activo: "tal vez" },
    { codigo_personal: "F", nombre: "N", dni: "1234567", activo: "sí" },
  ];
  const { valid, issues } = validatePersonalRows(rows, [2, 3, 4, 5, 6, 8]);
  assert.deepEqual(issues.map(i => i.row), [2, 3, 4, 5, 6, 8]);
  assert.match(issues[0].message, /DNI vacío/);
  assert.match(issues[1].message, /DNI con caracteres no numéricos: ABC/);
  assert.deepEqual(issues[5], { row: 8, code: "F", message: "DNI con 7 dígitos: 1234567", action: "error", nombre: "N", dni: "1234567" });
  assert.deepEqual(valid.map(r => r.fila), []);
});
test("DNI repetido o código repetido dentro del archivo: error en TODAS las filas implicadas ", () => {
  const rows = [
    { codigo_personal: "A", nombre: "Uno", dni: "01234567", activo: "sí" },
    { codigo_personal: "B", nombre: "Dos", dni: "01234567", activo: "sí" },
    { codigo_personal: "C", nombre: "Tres", dni: "22222222", activo: "sí" },
    { codigo_personal: "C", nombre: "Cuatro", dni: "33333333", activo: "sí" },
    { codigo_personal: "D", nombre: "Cinco", dni: "44444444", activo: "sí" },
  ];
  const { ok, issues } = checkPersonalFile(validatePersonalRows(rows).valid);
  assert.deepEqual(ok.map(r => r.codigo_personal), ["D"]);
  assert.deepEqual(issues.map(i => i.row).sort(), [2, 3, 4, 5]);
  assert.match(issues.find(i => i.row === 2)!.message, /DNI 01234567 está repetido en las filas 2, 3/);
  assert.match(issues.find(i => i.row === 4)!.message, /código C está repetido en las filas 4, 5/);
});
test("encabezados: sin activo o con columnas desconocidas se rechaza; cargo es opcional; el orden da igual", async () => {
  const sin = parseCsv("codigo_personal;nombre;dni\nA;N;12345678");
  await assert.rejects(preparePersonalImport(fakeDb().db, payloadFrom(sin)), /Encabezados requeridos/);
  const conCargo = parseCsv("DNI;Nombre;Código_Personal;Cargo;Activo\n12345678;Ana;A;Guardia;sí");
  const { db, calls } = fakeDb();
  await preparePersonalImport(db, payloadFrom(conCargo));
  assert.equal(sent(calls)[0].cargo, "Guardia");
});
test("las diferencias, errores de la base y vistas previas vuelven con su fila; el cargo por defecto y las personas a actualizar viajan a la base", async () => {
  const csv = parseCsv("codigo_personal;nombre;dni;activo\nR-1;ANA DIAZ;12345678;sí\nS-1;NUEVA;44444444;sí");
  const { db, calls } = fakeDb({
    nuevos: 1, sin_cambios: 0,
    diferencias: [{ fila: 2, dni: "12345678", nombre: "ANA PEREZ", codigo_personal: "R-1", vinculado: true, cambios: [{ campo: "nombre", actual: "ANA PEREZ", archivo: "ANA DIAZ" }] }],
    errores: [{ fila: 3, codigo: "S-1", mensaje: "El código S-1 ya pertenece a otra persona (DNI 99999999)" }],
  });
  const { preview } = await preparePersonalImport(db, payloadFrom(csv, { mode: "apply", actualizar: ["12345678"], cargo_defecto: "GUARDIA" }));
  assert.deepEqual(calls[0].args.p_actualizar, ["12345678"]);
  assert.equal(calls[0].args.p_cargo_defecto, "GUARDIA");
  assert.equal(calls[0].args.p_aplicar, true);
  assert.equal(preview.personal.diferencias[0].vinculado, true);
  assert.deepEqual(preview.issues.map(i => [i.row, i.code, i.nombre, i.dni]), [[3, "S-1", "NUEVA", "44444444"]]);
  assert.equal(preview.errores, 1);
});
test("la vista previa nunca aplica; sin filas válidas no se llama a la base", async () => {
  const { db, calls } = fakeDb();
  await preparePersonalImport(db, payloadFrom(parseCsv("codigo_personal;nombre;dni;activo\nA;N;12345678;sí")));
  assert.equal(calls[0].args.p_aplicar, false);
  const none = fakeDb();
  const { preview } = await preparePersonalImport(none.db, payloadFrom(parseCsv("codigo_personal;nombre;dni;activo\nA;N;XYZ;sí")));
  assert.equal(none.calls.length, 0);
  assert.equal(preview.errores, 1);
});
test("hasta 5000 filas; más se rechaza; los mensajes de la base llegan al usuario y los demás errores no filtran detalles", async () => {
  const big = parseCsv("codigo_personal;nombre;dni;activo\n" + Array.from({ length: 5001 }, (_, i) => `C${i};N;${String(10000000 + i)};sí`).join("\n"));
  await assert.rejects(preparePersonalImport(fakeDb().db, payloadFrom(big)));
  const one = parseCsv("codigo_personal;nombre;dni;activo\nA;N;12345678;sí");
  await assert.rejects(preparePersonalImport(fakeDb({}, { code: "22023", message: "Importación inválida (1 a 5000 filas)" }).db, payloadFrom(one)), ImportInputError);
  await assert.rejects(preparePersonalImport(fakeDb({}, { code: "XX000", message: "detalle interno" }).db, payloadFrom(one)), /No se pudo procesar la importación\./);
  const exact = parseCsv("codigo_personal;nombre;dni;activo\n" + Array.from({ length: 5000 }, (_, i) => `C${i};N;${String(10000000 + i)};sí`).join("\n"));
  const { db, calls } = fakeDb();
  await preparePersonalImport(db, payloadFrom(exact));
  assert.equal(sent(calls).length, 5000);
});

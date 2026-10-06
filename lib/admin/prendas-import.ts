import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRenovacion } from "@/lib/garments/renovacion";
import type { ImportIssue } from "./maintenance";

// Importación de prendas POR CLIENTE: el archivo solo crea o modifica las asignaciones de ese cliente.
// La pantalla limpia y valida cada fila (con su número) y detecta repetidos dentro del archivo; la base
// (RPC admin_importar_prendas) compara contra lo guardado y aplica, y vuelve a exigir todo.
export const PRENDAS_REQUIRED_HEADERS = ["codigo_prenda", "nombre_prenda", "codigo_almacen", "precio", "cantidad", "genero", "renovacion", "activo"] as const;
export const PRENDAS_OPTIONAL_HEADERS = ["cliente"] as const;

export type PrendasPreview = {
  aplicado: boolean; cliente: string; prendas_nuevas: number; asignaciones_nuevas: number;
  cantidades_actualizadas: number; estados_actualizados: number; sin_cambios: number;
  alertas: { codigo: string; nombre: string; cambios: { campo: string; actual: string; archivo: string }[] }[];
  conflictos: { fila: number; codigo: string; renovacion: string; otras: string[] }[];
  desactivar: { codigo: string; nombre: string; renovacion: string; cantidad: number }[];
  fichas_inactivas: string[];
};
export type PrendasImportPreview = { rows: Record<string, unknown>[]; issues: ImportIssue[]; nuevos: number; actualizados: number; omitidos: number; errores: number; prendas: PrendasPreview };

export const prendasPayloadSchema = z.object({
  kind: z.literal("prendas"), cliente_id: z.string().uuid("Selecciona el cliente del archivo."),
  headers: z.array(z.string()).max(12), rows: z.array(z.record(z.string(), z.string())).min(1).max(1000),
  mode: z.enum(["preview", "apply"]), reemplazar: z.boolean().default(false),
  actualizar: z.array(z.string().max(80)).max(1000).default([]),
}).strict();
export type PrendasPayload = z.infer<typeof prendasPayloadSchema>;
// Mensaje pensado para mostrarse tal cual al usuario.
export class ImportInputError extends Error {}

// "Renovación" y "renovacion", "Género" y "genero": misma columna.
const headerKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
// Quita espacios sobrantes (también los no separables, p. ej. "UNF1 ") antes de validar o comparar.
export const cleanCell = (value: string | undefined) => (value ?? "").replace(/[   ]/g, " ").trim();
const noControl = (text: string) => !/[\u0000-\u001f]/.test(text);

function booleanValue(value: string) {
  const normalized = cleanCell(value).toLowerCase();
  if (["true", "1", "si", "sí"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}
export function normalizeGenero(value: string | undefined) {
  const text = cleanCell(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s*\/\s*/g, "/");
  if (text === "HOMBRE" || text === "MUJER" || text === "AMBOS") return text;
  return text === "UNISEX" || text === "HOMBRE/MUJER" ? "AMBOS" : null;
}

type Row = { fila: number; codigo_prenda: string; nombre_prenda: string; codigo_almacen: string; precio: number; cantidad: number; genero: string; renovacion: string; activo: boolean };

export function checkPrendasHeaders(headers: string[]) {
  const keys = headers.map(headerKey);
  const allowed = new Set<string>([...PRENDAS_REQUIRED_HEADERS, ...PRENDAS_OPTIONAL_HEADERS]);
  if (new Set(keys).size !== keys.length || PRENDAS_REQUIRED_HEADERS.some(h => !keys.includes(h)) || keys.some(k => !allowed.has(k))) {
    throw new z.ZodError([{ code: "custom", path: ["headers"], message: `Encabezados requeridos: ${PRENDAS_REQUIRED_HEADERS.join(", ")} (opcional: ${PRENDAS_OPTIONAL_HEADERS.join(", ")}).` }]);
  }
}

export function validatePrendasRows(rows: Record<string, string>[], clienteNombre: string) {
  const issues: ImportIssue[] = []; const valid: Row[] = [];
  rows.forEach((raw, index) => {
    const fila = index + 2; const r = Object.fromEntries(Object.entries(raw).map(([name, value]) => [headerKey(name), cleanCell(value)]));
    const codigo = r.codigo_prenda ?? "";
    const fail = (message: string) => issues.push({ row: fila, code: codigo || "—", message, action: "error" });
    if (!codigo || codigo.length > 80 || !noControl(codigo)) return fail("codigo_prenda es obligatorio o demasiado largo.");
    if (r.cliente && r.cliente.toLowerCase() !== clienteNombre.trim().toLowerCase()) {
      return fail(`La fila es del cliente "${r.cliente}" pero este archivo se importa para "${clienteNombre}". Importa un archivo por cliente.`);
    }
    const renovacion = normalizeRenovacion(r.renovacion);
    if (!renovacion) return fail(`Renovación inválida "${r.renovacion ?? ""}". Usa Verano, Invierno o Ambos.`);
    const activo = booleanValue(r.activo ?? "");
    if (activo === null) return fail("activo debe ser true/false, sí/no o 1/0.");
    const genero = normalizeGenero(r.genero);
    if (!genero) return fail(`Género inválido "${r.genero ?? ""}". Usa Hombre, Mujer o Ambos.`);
    const nombre = r.nombre_prenda ?? "", almacen = r.codigo_almacen ?? "";
    if (!nombre || nombre.length > 240 || !noControl(nombre)) return fail("nombre_prenda es obligatorio o demasiado largo.");
    if (!almacen || almacen.length > 80 || !noControl(almacen)) return fail("codigo_almacen es obligatorio o demasiado largo.");
    if (!/^\d+(\.\d{1,2})?$/.test(r.precio ?? "")) return fail(`Precio inválido "${r.precio ?? ""}": usa un número con hasta dos decimales.`);
    if (!/^[1-9]\d{0,4}$/.test(r.cantidad ?? "") || Number(r.cantidad) > 10000) return fail(`Cantidad inválida "${r.cantidad ?? ""}": usa un entero entre 1 y 10000.`);
    valid.push({ fila, codigo_prenda: codigo, nombre_prenda: nombre, codigo_almacen: almacen, precio: Number(r.precio), cantidad: Number(r.cantidad), genero, renovacion, activo });
  });
  return { valid, issues };
}

// Repetidos y combinaciones ambiguas DENTRO del archivo: se marcan (con número de fila) y no se importan.
export function checkPrendasFile(valid: Row[]) {
  const issues: ImportIssue[] = []; const bad = new Set<number>();
  const flag = (row: Row, message: string) => { bad.add(row.fila); issues.push({ row: row.fila, code: row.codigo_prenda, message, action: "error" }); };
  const byCode = new Map<string, Row[]>();
  for (const row of valid) byCode.set(row.codigo_prenda, [...(byCode.get(row.codigo_prenda) ?? []), row]);
  for (const [code, rows] of byCode) {
    const byRenovacion = new Map<string, Row[]>();
    for (const row of rows) byRenovacion.set(row.renovacion, [...(byRenovacion.get(row.renovacion) ?? []), row]);
    for (const [renovacion, same] of byRenovacion) if (same.length > 1) {
      for (const row of same) flag(row, `${code} con renovación ${renovacion} está repetido en las filas ${same.map(s => s.fila).join(" y ")}. Deja una sola fila por código y renovación.`);
    }
    if (byRenovacion.has("AMBOS") && byRenovacion.size > 1) {
      for (const row of rows) if (!bad.has(row.fila)) flag(row, `${code} combina AMBOS con VERANO o INVIERNO (filas ${rows.map(s => s.fila).join(", ")}). Usa AMBOS solo, o una fila por renovación.`);
    }
    for (const [campo, label] of [["precio", "precio"], ["nombre_prenda", "nombre"], ["codigo_almacen", "código de almacén"], ["genero", "género"]] as const) {
      const values = new Map<string, number[]>();
      for (const row of rows) values.set(String(row[campo]), [...(values.get(String(row[campo])) ?? []), row.fila]);
      if (values.size > 1) {
        const detail = [...values].map(([value, filas]) => `${campo === "precio" ? "S/ " : ""}${value} (fila ${filas.join(", ")})`).join(" y ");
        for (const row of rows) if (!bad.has(row.fila)) flag(row, `El código ${code} trae ${label} distinto en el archivo: ${detail}.`);
      }
    }
  }
  return { ok: valid.filter(row => !bad.has(row.fila)), issues };
}

const emptyPreview = (cliente: string): PrendasPreview => ({ aplicado: false, cliente, prendas_nuevas: 0, asignaciones_nuevas: 0, cantidades_actualizadas: 0, estados_actualizados: 0, sin_cambios: 0, alertas: [], conflictos: [], desactivar: [], fichas_inactivas: [] });

export async function preparePrendasImport(db: SupabaseClient, input: unknown) {
  const parsed = prendasPayloadSchema.parse(input);
  checkPrendasHeaders(parsed.headers);
  const { data: client, error: clientError } = await db.from("clientes").select("nombre,activo").eq("id", parsed.cliente_id).maybeSingle();
  if (clientError) throw new Error("No se pudo validar el cliente.");
  if (!client || client.activo === false) throw new z.ZodError([{ code: "custom", path: ["cliente_id"], message: "El cliente no existe o está inactivo." }]);
  const { valid, issues } = validatePrendasRows(parsed.rows, String(client.nombre));
  const file = checkPrendasFile(valid);
  const all = [...issues, ...file.issues].sort((a, b) => a.row - b.row);
  const finish = (prendas: PrendasPreview): PrendasImportPreview => {
    const conflicts: ImportIssue[] = prendas.conflictos.map(c => ({ row: c.fila, code: c.codigo, action: "error",
      message: `${c.renovacion} choca con la asignación ${c.otras.join(" y ")} ya vigente para este cliente (AMBOS no convive con VERANO o INVIERNO).` }));
    const allIssues = [...all, ...conflicts].sort((a, b) => a.row - b.row);
    return { rows: file.ok, issues: allIssues, nuevos: prendas.asignaciones_nuevas, actualizados: prendas.cantidades_actualizadas + prendas.estados_actualizados,
      omitidos: 0, errores: allIssues.length, prendas };
  };
  if (!file.ok.length) return { parsed, preview: finish(emptyPreview(String(client.nombre))) };
  // Reemplazar desactiva lo que no viene en el archivo: con filas con error se desconoce qué "no viene", así que no se aplica.
  if (parsed.reemplazar && parsed.mode === "apply" && all.length) throw new ImportInputError("Corrige los errores del archivo antes de reemplazar el catálogo de este cliente.");
  const { data, error } = await db.rpc("admin_importar_prendas", {
    p_cliente_id: parsed.cliente_id, p_filas: file.ok, p_aplicar: parsed.mode === "apply",
    p_actualizar: parsed.actualizar, p_reemplazar: parsed.reemplazar,
  });
  if (error) {
    if (["22023", "55000", "23505", "23P01"].includes(error.code)) throw new ImportInputError(error.message);
    throw new Error("No se pudo procesar la importación.");
  }
  return { parsed, preview: finish(data as PrendasPreview) };
}

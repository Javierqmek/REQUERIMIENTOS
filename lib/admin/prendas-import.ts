import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRenovacion } from "@/lib/garments/renovacion";
import type { ImportIssue } from "./maintenance";

// Importación de prendas POR CLIENTE: el archivo solo crea o modifica las asignaciones de ese cliente.
// La pantalla limpia y valida cada fila (con su número) y detecta repetidos dentro del archivo; la base
// (RPC admin_importar_prendas) compara contra lo guardado y aplica, y vuelve a exigir todo.
export const PRENDAS_REQUIRED_HEADERS = ["codigo_prenda", "nombre_prenda", "codigo_almacen", "precio", "cantidad", "genero", "renovacion", "activo"] as const;
export const PRENDAS_OPTIONAL_HEADERS = ["cliente", "puesto"] as const;

export const ALCANCES = ["ahora", "tramite", "todos"] as const;
export type Alcance = (typeof ALCANCES)[number];
export type Impacto = { precio_cambia: boolean; almacen_cambia: boolean; tramite: { requerimientos: number; lineas: number }; todos: { requerimientos: number; lineas: number } };
export type PrendasPreview = {
  aplicado: boolean; cliente: string; prendas_nuevas: number; asignaciones_nuevas: number;
  cantidades_actualizadas: number; generos_actualizados: number; estados_actualizados: number; sin_cambios: number;
  // Alertas de ficha: solo precio, nombre y código de almacén (el género es de la asignación del cliente).
  alertas: { codigo: string; nombre: string; cambios: { campo: string; actual: string; archivo: string }[]; impacto: Impacto | null }[];
  renovaciones_actualizadas: { codigo: string; nombre: string; de: string; a: string }[];
  desactivar: { codigo: string; nombre: string; renovacion: string; cantidad: number; puesto?: string | null }[];
  fichas_inactivas: string[];
  cambios_ficha: { codigo: string; alcance: Alcance; requerimientos: number; lineas: number }[];
};
export type PrendasImportPreview = { rows: Record<string, unknown>[]; issues: ImportIssue[]; nuevos: number; actualizados: number; omitidos: number; errores: number; prendas: PrendasPreview };

export const prendasPayloadSchema = z.object({
  kind: z.literal("prendas"), cliente_id: z.string().uuid("Selecciona el cliente del archivo."),
  headers: z.array(z.string()).max(12), rows: z.array(z.record(z.string(), z.string())).min(1).max(1000),
  mode: z.enum(["preview", "apply"]), reemplazar: z.boolean().default(false),
  // Fichas cuyos datos se actualizan con los del archivo y con qué alcance sobre requerimientos existentes.
  actualizar: z.record(z.string().max(80), z.enum(ALCANCES)).default({}),
  // Número de fila ORIGINAL de cada fila (Excel), para que los errores la indiquen aunque se omitan filas vacías.
  filas: z.array(z.number().int().min(1).max(2000000)).max(1000).optional(),
}).strict();
export type PrendasPayload = z.infer<typeof prendasPayloadSchema>;
// Mensaje pensado para mostrarse tal cual al usuario.
export class ImportInputError extends Error {}

// "Renovación" y "renovacion", "Género" y "genero": misma columna.
export const headerKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
// Quita espacios sobrantes (también los no separables, p. ej. "UNF1 ") antes de validar o comparar.
// Los códigos exportados como ="0012" (para que Excel no les quite los ceros) se leen sin el envoltorio.
export const cleanCell = (value: string | undefined) => (value ?? "").replace(/[   ]/g, " ").trim().replace(/^="(.*)"$/, "$1").trim();
const noControl = (text: string) => !/[\u0000-\u001f]/.test(text);

function booleanValue(value: string) {
  const normalized = cleanCell(value).toLowerCase();
  if (["true", "1", "si", "sí", "verdadero"].includes(normalized)) return true;
  if (["false", "0", "no", "falso"].includes(normalized)) return false;
  return null;
}
export function normalizeGenero(value: string | undefined) {
  const text = cleanCell(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s*\/\s*/g, "/");
  if (text === "HOMBRE" || text === "MUJER" || text === "AMBOS") return text;
  return text === "UNISEX" || text === "HOMBRE/MUJER" ? "AMBOS" : null;
}

// "S/ 60.00", "S/ 1,250.50", "1.250,50", "60,5", "PEN 60": devuelve un número con hasta 2 decimales, o null.
export function parsePrecio(value: string | undefined) {
  let text = cleanCell(value).replace(/^(S\/\.?|PEN|\$|USD)\s*/i, "").replace(/\s+/g, "");
  if (!/^\d[\d.,]*$/.test(text)) return null;
  const lastDot = text.lastIndexOf("."), lastComma = text.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    text = text.split(decimal === "." ? "," : ".").join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    text = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, "") : text.replace(",", ".");
  }
  return /^\d+(\.\d{1,2})?$/.test(text) ? Number(text) : null;
}

type Row = { fila: number; puesto: string | null; codigo_prenda: string; nombre_prenda: string; codigo_almacen: string; precio: number; cantidad: number; genero: string; renovacion: string; activo: boolean };

export function checkPrendasHeaders(headers: string[]) {
  const keys = headers.map(headerKey);
  const allowed = new Set<string>([...PRENDAS_REQUIRED_HEADERS, ...PRENDAS_OPTIONAL_HEADERS]);
  if (new Set(keys).size !== keys.length || PRENDAS_REQUIRED_HEADERS.some(h => !keys.includes(h)) || keys.some(k => !allowed.has(k))) {
    throw new z.ZodError([{ code: "custom", path: ["headers"], message: `Encabezados requeridos: ${PRENDAS_REQUIRED_HEADERS.join(", ")} (opcional: ${PRENDAS_OPTIONAL_HEADERS.join(", ")}).` }]);
  }
}

// puestos: catálogo del cliente cuando diferencia prendas por puesto (usa=true); sin él, la columna puesto debe venir vacía.
export type PuestosContext = { usa: boolean; puestos: { nombre: string; activo: boolean }[] };
export function validatePrendasRows(rows: Record<string, string>[], clienteNombre: string, filas?: number[], contexto: PuestosContext = { usa: false, puestos: [] }) {
  const issues: ImportIssue[] = []; const valid: Row[] = [];
  rows.forEach((raw, index) => {
    const fila = filas?.[index] ?? index + 2; const r = Object.fromEntries(Object.entries(raw).map(([name, value]) => [headerKey(name), cleanCell(value)]));
    const codigo = r.codigo_prenda ?? "";
    const fail = (message: string) => issues.push({ row: fila, code: codigo || "—", message, action: "error" });
    // Fila de la exportación para una prenda sin asignación (columna cliente presente pero vacía, y sin cantidad, género ni renovación): no hay nada que importar.
    if (codigo && "cliente" in r && !r.cliente && !r.puesto && !r.cantidad && !r.genero && !r.renovacion) return;
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
    const precio = parsePrecio(r.precio);
    if (precio === null) return fail(`Precio inválido "${r.precio ?? ""}": usa un número con hasta dos decimales (también se acepta S/ 1,250.50).`);
    if (!/^[1-9]\d{0,4}$/.test(r.cantidad ?? "") || Number(r.cantidad) > 10000) return fail(`Cantidad inválida "${r.cantidad ?? ""}": usa un entero entre 1 y 10000.`);
    let puesto: string | null = null;
    if (contexto.usa) {
      if (!r.puesto) return fail(`puesto es obligatorio: ${clienteNombre} diferencia prendas por puesto.`);
      const found = contexto.puestos.find(p => p.nombre.trim().toLowerCase() === r.puesto.toLowerCase());
      if (!found) return fail(`El puesto "${r.puesto}" no existe en el catálogo de ${clienteNombre} (Mantenimiento → Puestos).`);
      if (!found.activo && activo) return fail(`El puesto "${r.puesto}" está inactivo: actívalo en Mantenimiento o marca la fila como inactiva.`);
      puesto = found.nombre;
    } else if (r.puesto) {
      return fail(`${clienteNombre} no diferencia prendas por puesto: deja la columna puesto vacía (fila con puesto "${r.puesto}").`);
    }
    valid.push({ fila, puesto, codigo_prenda: codigo, nombre_prenda: nombre, codigo_almacen: almacen, precio, cantidad: Number(r.cantidad), genero, renovacion, activo });
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
    // La misma prenda puede estar en varios puestos (con distinta cantidad): renovación y AMBOS se revisan dentro de cada puesto.
    const byPuesto = new Map<string, Row[]>();
    for (const row of rows) byPuesto.set(row.puesto ?? "", [...(byPuesto.get(row.puesto ?? "") ?? []), row]);
    for (const [puesto, inPuesto] of byPuesto) {
      const where = puesto ? ` en el puesto "${puesto}"` : "";
      const byRenovacion = new Map<string, Row[]>();
      for (const row of inPuesto) byRenovacion.set(row.renovacion, [...(byRenovacion.get(row.renovacion) ?? []), row]);
      for (const [renovacion, same] of byRenovacion) if (same.length > 1) {
        for (const row of same) flag(row, `${code} con renovación ${renovacion}${where} está repetido en las filas ${same.map(s => s.fila).join(" y ")}. Deja una sola fila por código${puesto ? ", puesto" : ""} y renovación.`);
      }
      if (byRenovacion.has("AMBOS") && byRenovacion.size > 1) {
        for (const row of inPuesto) if (!bad.has(row.fila)) flag(row, `${code} combina AMBOS con VERANO o INVIERNO${where} (filas ${inPuesto.map(s => s.fila).join(", ")}). Usa AMBOS solo, o una fila por renovación.`);
      }
    }
    // Datos de ficha (el género NO: va en la asignación de cada cliente y puede variar por renovación).
    for (const [campo, label] of [["precio", "precio"], ["nombre_prenda", "nombre"], ["codigo_almacen", "código de almacén"]] as const) {
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

const emptyPreview = (cliente: string): PrendasPreview => ({ aplicado: false, cliente, prendas_nuevas: 0, asignaciones_nuevas: 0, cantidades_actualizadas: 0, generos_actualizados: 0, estados_actualizados: 0, sin_cambios: 0, alertas: [], renovaciones_actualizadas: [], desactivar: [], fichas_inactivas: [], cambios_ficha: [] });

export async function preparePrendasImport(db: SupabaseClient, input: unknown) {
  const parsed = prendasPayloadSchema.parse(input);
  checkPrendasHeaders(parsed.headers);
  const { data: client, error: clientError } = await db.from("clientes").select("nombre,activo,diferencia_puestos").eq("id", parsed.cliente_id).maybeSingle();
  if (clientError) throw new Error("No se pudo validar el cliente.");
  if (!client || client.activo === false) throw new z.ZodError([{ code: "custom", path: ["cliente_id"], message: "El cliente no existe o está inactivo." }]);
  let contexto: PuestosContext = { usa: false, puestos: [] };
  if (client.diferencia_puestos === true) {
    const { data: puestos, error: puestosError } = await db.from("puestos").select("nombre,activo").eq("cliente_id", parsed.cliente_id).limit(1000);
    if (puestosError) throw new Error("No se pudieron validar los puestos del cliente.");
    contexto = { usa: true, puestos: (puestos ?? []) as PuestosContext["puestos"] };
  }
  const { valid, issues } = validatePrendasRows(parsed.rows, String(client.nombre), parsed.filas, contexto);
  const file = checkPrendasFile(valid);
  const all = [...issues, ...file.issues].sort((a, b) => a.row - b.row);
  const finish = (prendas: PrendasPreview): PrendasImportPreview => {
    const allIssues = all;
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
    if (error.code === "42501") throw new ImportInputError("Solo un superadmin puede aplicar el cambio de precio a todos los requerimientos.");
    if (["22023", "55000", "23505", "23P01"].includes(error.code)) throw new ImportInputError(error.message);
    throw new Error("No se pudo procesar la importación.");
  }
  return { parsed, preview: finish(data as PrendasPreview) };
}

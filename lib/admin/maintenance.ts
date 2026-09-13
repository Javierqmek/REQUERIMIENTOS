import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export const CATALOG_KINDS = ["clientes", "unidades", "personal", "prendas"] as const;
export type CatalogKind = typeof CATALOG_KINDS[number];
export type CatalogResult = { rows: Record<string, unknown>[]; total: number; page: number; pageSize: number };
const querySchema = z.object({
  catalogo: z.enum(CATALOG_KINDS), q: z.string().trim().max(120).default(""),
  cliente: z.union([z.string().uuid(), z.literal("")]).default(""),
  genero: z.enum(["HOMBRE", "MUJER", "AMBOS", ""]).default(""),
  page: z.coerce.number().int().min(1).max(1001).default(1),
});
export function parseCatalogQuery(params: URLSearchParams) {
  return querySchema.parse(Object.fromEntries(params));
}
export async function getCatalogRows(db: SupabaseClient, raw: ReturnType<typeof parseCatalogQuery>): Promise<CatalogResult> {
  const pageSize = 50;
  const { data, error } = await db.rpc("admin_listar_catalogo", {
    p_catalogo: raw.catalogo, p_busqueda: raw.q || null, p_cliente_id: raw.cliente || null,
    p_genero: raw.genero || null, p_limite: pageSize, p_offset: (raw.page - 1) * pageSize,
  });
  if (error) throw new Error("No se pudo consultar el catálogo.");
  const result = data as { rows: Record<string, unknown>[]; total: number };
  if ((raw.catalogo === "clientes" || raw.catalogo === "unidades") && result.rows.length) {
    const { data: capabilities, error: capabilityError } = await db.rpc("admin_capacidades_catalogo", {
      p_catalogo: raw.catalogo, p_ids: result.rows.map(row => row.id),
    });
    if (capabilityError) throw new Error("No se pudieron validar las relaciones del catálogo.");
    const safe = (capabilities ?? {}) as Record<string, boolean>;
    result.rows = result.rows.map(row => ({
      ...row, puede_eliminar: safe[String(row.id)] === true,
      ...(raw.catalogo === "unidades" ? { puede_cambiar_cliente: safe[String(row.id)] === true } : {}),
    }));
  }
  return { ...result, page: raw.page, pageSize };
}

const shortText = (max: number, label: string) => z.string().trim().min(1, `${label} es obligatorio.`).max(max);
const clientValues = z.object({ nombre: shortText(200, "El nombre") }).strict();
const unitValues = z.object({ cliente_id: z.string().uuid("Selecciona un cliente válido."), nombre: shortText(200, "El nombre") }).strict();
const personValues = z.object({
  codigo_personal: shortText(80, "El código"), nombre: shortText(200, "El nombre"),
  dni: z.string().trim().regex(/^\d{8,12}$/, "El DNI debe tener entre 8 y 12 dígitos."),
  cargo: shortText(120, "El cargo"),
}).strict();
const garmentValues = z.object({
  codigo_prenda: shortText(80, "El código"), nombre_prenda: shortText(240, "El nombre"),
  codigo_almacen: shortText(80, "El código de almacén"),
  precio: z.number().finite().min(0).max(9999999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, "Usa como máximo dos decimales."),
  cantidad: z.number().int().min(1).max(10000),
  cliente_id: z.string().uuid("Selecciona un cliente válido."),
  genero: z.enum(["HOMBRE", "MUJER", "AMBOS"]),
}).strict();
const createSchemas = [
  z.object({ catalogo: z.literal("clientes"), valores: clientValues }).strict(),
  z.object({ catalogo: z.literal("unidades"), valores: unitValues }).strict(),
  z.object({ catalogo: z.literal("personal"), valores: personValues }).strict(),
  z.object({ catalogo: z.literal("prendas"), valores: garmentValues }).strict(),
] as const;
const updateSchemas = [
  z.object({ catalogo: z.literal("clientes"), id: z.string().uuid(), valores: clientValues }).strict(),
  z.object({ catalogo: z.literal("unidades"), id: z.string().uuid(), valores: unitValues }).strict(),
  z.object({ catalogo: z.literal("personal"), id: z.string().uuid(), valores: personValues }).strict(),
  z.object({ catalogo: z.literal("prendas"), id: z.string().uuid(), valores: garmentValues }).strict(),
] as const;
export const catalogCreateSchema = z.discriminatedUnion("catalogo", createSchemas);
export const catalogUpdateSchema = z.discriminatedUnion("catalogo", updateSchemas);
export const catalogDeleteSchema = z.object({
  catalogo: z.enum(["clientes", "unidades"]), id: z.string().uuid(),
}).strict();

export const IMPORT_KINDS = ["personal", "prendas"] as const;
export type ImportKind = typeof IMPORT_KINDS[number];
export const IMPORT_HEADERS: Record<ImportKind, readonly string[]> = {
  personal: ["codigo_personal", "nombre", "dni", "cargo", "activo"],
  prendas: ["codigo_prenda", "nombre_prenda", "codigo_almacen", "precio", "cantidad", "cliente", "genero", "activo"],
};
export type RawImport = { kind: ImportKind; headers: string[]; rows: Record<string, string>[] };
export type ImportIssue = { row: number; code: string; message: string; action: "error" | "omitido" };
export type ImportPreview = { rows: Record<string, unknown>[]; issues: ImportIssue[]; nuevos: number; actualizados: number; omitidos: number; errores: number };

function booleanValue(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "si", "sí"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}
function clean(value: string, max: number) {
  const text = value.trim();
  return text && text.length <= max && !/[\u0000-\u001f]/.test(text) ? text : null;
}
const payloadSchema = z.object({
  kind: z.enum(IMPORT_KINDS), headers: z.array(z.string()).max(12),
  rows: z.array(z.record(z.string(), z.string())).min(1).max(1000), mode: z.enum(["preview", "apply"]),
}).strict();
async function findValues(db: SupabaseClient, table: string, column: string, values: string[]) {
  const found = new Set<string>();
  for (let i=0;i<values.length;i+=150) {
    const { data, error } = await db.from(table).select(column).in(column, values.slice(i,i+150));
    if (error) throw new Error("No se pudieron validar los registros existentes.");
    for (const row of data ?? []) found.add(String((row as unknown as Record<string, unknown>)[column]));
  }
  return found;
}
export async function prepareImport(db: SupabaseClient, input: unknown) {
  const parsed = payloadSchema.parse(input); const expected=[...IMPORT_HEADERS[parsed.kind]];
  if (parsed.headers.length!==expected.length || parsed.headers.some((h,i)=>h.trim().toLowerCase()!==expected[i])) {
    throw new z.ZodError([{ code:"custom", path:["headers"], message:`Encabezados requeridos: ${expected.join(", ")}` }]);
  }
  const key = parsed.kind === "personal" ? "codigo_personal" : "codigo_prenda";
  const codes=parsed.rows.map(row=>row[key]?.trim()).filter(Boolean);
  const existing=await findValues(db,parsed.kind,key,[...new Set(codes)]);
  const clients=parsed.kind === "prendas" ? await findValues(db,"clientes","nombre",[...new Set(parsed.rows.map(r=>r.cliente?.trim()).filter(Boolean))]) : new Set<string>();
  const seen=new Set<string>(); const rows:Record<string,unknown>[]=[]; const issues:ImportIssue[]=[]; let nuevos=0,actualizados=0;
  parsed.rows.forEach((raw,index)=>{
    const rowNumber=index+2; const code=clean(raw[key]??"",80)??"";
    if (!code) { issues.push({row:rowNumber,code:"—",message:`${key} es obligatorio o demasiado largo.`,action:"error"}); return; }
    if (seen.has(code)) { issues.push({row:rowNumber,code,message:"Código repetido dentro del archivo; se conserva la primera fila.",action:"omitido"}); return; }
    seen.add(code); const active=booleanValue(raw.activo??"");
    if (active===null) { issues.push({row:rowNumber,code,message:"activo debe ser true/false, sí/no o 1/0.",action:"error"}); return; }
    if (parsed.kind === "personal") {
      const nombre=clean(raw.nombre??"",200),dni=(raw.dni??"").trim(),cargo=clean(raw.cargo??"",120);
      if (!nombre || !cargo || !/^\d{8,12}$/.test(dni)) { issues.push({row:rowNumber,code,message:"Revisa nombre, cargo y DNI (8 a 12 dígitos).",action:"error"}); return; }
      rows.push({codigo_personal:code,nombre,dni,cargo,activo:active});
    } else {
      const nombre=clean(raw.nombre_prenda??"",240),almacen=clean(raw.codigo_almacen??"",80),cliente=clean(raw.cliente??"",200);
      const precio=Number(raw.precio),cantidad=Number(raw.cantidad),genero=(raw.genero??"").trim().toUpperCase();
      if (!nombre || !almacen || !cliente || !clients.has(cliente) || !Number.isFinite(precio) || precio<0 || !/^\d+(\.\d{1,2})?$/.test(raw.precio??"") || !Number.isInteger(cantidad) || cantidad<1 || cantidad>10000 || !["HOMBRE","MUJER","AMBOS"].includes(genero)) {
        issues.push({row:rowNumber,code,message:"Revisa nombre, almacén, precio, cantidad, género y cliente existente.",action:"error"}); return;
      }
      rows.push({codigo_prenda:code,nombre_prenda:nombre,codigo_almacen:almacen,precio,cantidad,cliente,genero,activo:active});
    }
    if (existing.has(code)) actualizados++; else nuevos++;
  });
  const preview:ImportPreview={rows,issues,nuevos,actualizados,omitidos:issues.filter(i=>i.action==="omitido").length,errores:issues.filter(i=>i.action==="error").length};
  return { parsed, preview };
}

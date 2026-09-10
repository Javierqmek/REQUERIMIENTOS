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
  return { ...(data as { rows: Record<string, unknown>[]; total: number }), page: raw.page, pageSize };
}

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

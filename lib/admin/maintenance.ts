import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRENDA_RENOVACIONES, RENOVACIONES } from "@/lib/garments/renovacion";

export const CATALOG_KINDS = ["clientes", "unidades", "personal", "prendas", "provincias"] as const;
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
const unitValues = z.object({
  cliente_id: z.string().uuid("Selecciona un cliente válido."), nombre: shortText(200, "El nombre"),
  renovacion_defecto: z.enum(RENOVACIONES, { error: "La renovación por defecto debe ser Verano o Invierno." }),
}).strict();
const personValues = z.object({
  codigo_personal: shortText(80, "El código"), nombre: shortText(200, "El nombre"),
  dni: z.string().trim().regex(/^\d{8,12}$/, "El DNI debe tener entre 8 y 12 dígitos."),
  cargo: shortText(120, "El cargo"),
}).strict();
const garmentValues = z.object({
  codigo_prenda: shortText(80, "El código"), nombre_prenda: shortText(240, "El nombre"),
  codigo_almacen: shortText(80, "El código de almacén"),
  precio: z.number().finite().min(0).max(9999999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, "Usa como máximo dos decimales."),
  // Alcance del cambio de precio o de código de almacén sobre requerimientos existentes (ver 202610070001).
  alcance: z.enum(["ahora", "tramite", "todos"]).optional(),
  // Asignaciones de la prenda: cliente, renovación, género, cantidad y estado. No se borran: se desactivan.
  asignaciones: z.array(z.object({
    id: z.string().uuid().optional(), cliente_id: z.string().uuid("Selecciona un cliente válido."),
    renovacion: z.enum(PRENDA_RENOVACIONES, { error: "La renovación debe ser Verano, Invierno o Ambos." }),
    genero: z.enum(["HOMBRE", "MUJER", "AMBOS"], { error: "El género de la asignación debe ser Hombre, Mujer o Ambos." }),
    cantidad: z.number().int("La cantidad debe ser un entero.").min(1, "La cantidad mínima es 1.").max(10000),
    activo: z.boolean(),
  }).strict()).max(200).optional(),
}).strict();
const provinceValues = z.object({ nombre: shortText(200, "El nombre") }).strict();
const createSchemas = [
  z.object({ catalogo: z.literal("clientes"), valores: clientValues }).strict(),
  z.object({ catalogo: z.literal("unidades"), valores: unitValues }).strict(),
  z.object({ catalogo: z.literal("personal"), valores: personValues }).strict(),
  z.object({ catalogo: z.literal("prendas"), valores: garmentValues }).strict(),
  z.object({ catalogo: z.literal("provincias"), valores: provinceValues }).strict(),
] as const;
const updateSchemas = [
  z.object({ catalogo: z.literal("clientes"), id: z.string().uuid(), valores: clientValues }).strict(),
  z.object({ catalogo: z.literal("unidades"), id: z.string().uuid(), valores: unitValues }).strict(),
  z.object({ catalogo: z.literal("personal"), id: z.string().uuid(), valores: personValues }).strict(),
  z.object({ catalogo: z.literal("prendas"), id: z.string().uuid(), valores: garmentValues }).strict(),
  z.object({ catalogo: z.literal("provincias"), id: z.string().uuid(), valores: provinceValues }).strict(),
] as const;
export const catalogCreateSchema = z.discriminatedUnion("catalogo", createSchemas);
export const catalogUpdateSchema = z.discriminatedUnion("catalogo", updateSchemas);
export const catalogDeleteSchema = z.object({
  catalogo: z.enum(["clientes", "unidades"]), id: z.string().uuid(),
}).strict();

export const IMPORT_KINDS = ["personal", "prendas"] as const;
export type ImportKind = typeof IMPORT_KINDS[number];
export const IMPORT_HEADERS: Record<ImportKind, readonly string[]> = {
  personal: ["codigo_personal", "nombre", "dni", "activo"],
  prendas: ["codigo_prenda", "nombre_prenda", "codigo_almacen", "precio", "cantidad", "genero", "renovacion", "activo"],
};
export type RawImport = { kind: ImportKind; headers: string[]; rows: Record<string, string>[] };
export type ImportIssue = { row: number; code: string; message: string; action: "error" | "omitido" };
export type ImportPreview = { rows: Record<string, unknown>[]; issues: ImportIssue[]; nuevos: number; actualizados: number; omitidos: number; errores: number };

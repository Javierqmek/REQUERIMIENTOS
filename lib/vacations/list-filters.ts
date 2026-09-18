import { z } from "zod";
import type { PapeletaEstado } from "./types";

// Mismo patrón que lib/requirements/list-filters.ts: un solo esquema de filtros, un solo builder
// de argumentos de RPC, reutilizado por coordinador (bandeja propia) y admin/gerente (bandeja
// global) -- la RPC listar_papeletas_vacaciones_filtradas ya distingue el alcance según quién
// llama (ver migración), así que no hace falta duplicar el motor de consulta aquí tampoco.
const uuid = z.union([z.literal(""), z.string().uuid()]).default("");
const isoDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default("");
export const PAPELETA_ESTADOS: PapeletaEstado[] = ["REGISTRADO", "OBSERVADO", "FIRMADO", "CONFORME"];

export const papeletaFiltersSchema = z.object({
  cliente: uuid, unidad: uuid, provincia: uuid, coordinador: uuid,
  estado: z.union([z.literal(""), z.enum(["REGISTRADO", "OBSERVADO", "FIRMADO", "CONFORME"])]).default(""),
  desde: isoDate, hasta: isoDate,
  q: z.string().trim().max(120).default(""),
}).refine(value => !value.desde || !value.hasta || value.desde <= value.hasta, {
  message: "La fecha desde no puede ser posterior a la fecha hasta", path: ["hasta"],
});
export type PapeletaFilters = z.infer<typeof papeletaFiltersSchema>;
export const EMPTY_PAPELETA_FILTERS: PapeletaFilters = { cliente: "", unidad: "", provincia: "", coordinador: "", estado: "", desde: "", hasta: "", q: "" };

export function parsePapeletaQuery(params: URLSearchParams) {
  return { filters: papeletaFiltersSchema.parse(Object.fromEntries(params)), page: z.coerce.number().int().min(1).max(100000).parse(params.get("page") ?? 1) };
}
export function papeletaFilterParams(filters: PapeletaFilters, page = 1) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  params.set("page", String(page));
  return params;
}
export function papeletaRpcArgs(filters: PapeletaFilters) {
  return {
    p_busqueda: filters.q || null, p_cliente_id: filters.cliente || null, p_unidad_id: filters.unidad || null,
    p_provincia_id: filters.provincia || null, p_estado: filters.estado || null, p_coordinador_id: filters.coordinador || null,
    p_desde: filters.desde || null, p_hasta: filters.hasta || null,
  };
}

import { z } from "zod";

export const ADMIN_STATES = ["Pendiente", "Atendido", "Observado"] as const;
export const ADMIN_SORT_FIELDS = ["fecha", "agente", "cliente", "unidad", "coordinador", "estado", "prendas", "total"] as const;
export type AdminSortField = typeof ADMIN_SORT_FIELDS[number];
export type AdminSortDirection = "asc" | "desc" | "";
const uuid = z.union([z.literal(""), z.string().uuid()]).default("");
const date = z.string().refine(value => {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}, "Fecha inválida").default("");
export const adminFiltersSchema = z.object({
  cliente: uuid, unidad: uuid, coordinador: uuid,
  estado: z.union([z.literal(""), z.enum(ADMIN_STATES)]).default(""),
  desde: date, hasta: date, q: z.string().trim().max(120).default(""),
  duplicados: z.union([z.literal(""), z.literal("1")]).default(""),
  orden: z.union([z.literal(""), z.enum(ADMIN_SORT_FIELDS)]).default(""),
  direccion: z.union([z.literal(""), z.literal("asc"), z.literal("desc")]).default(""),
}).refine(f => !f.desde || !f.hasta || f.desde <= f.hasta, { message: "La fecha desde no puede ser posterior a la fecha hasta", path: ["hasta"] });
export type AdminFilters = z.infer<typeof adminFiltersSchema>;
export const EMPTY_FILTERS: AdminFilters = { cliente: "", unidad: "", coordinador: "", estado: "", desde: "", hasta: "", q: "", duplicados: "", orden: "", direccion: "" };
export function parseAdminQuery(params: URLSearchParams) {
  return {
    filters: adminFiltersSchema.parse(Object.fromEntries(params)),
    page: z.coerce.number().int().min(1).max(1000000).parse(params.get("page") ?? 1),
  };
}
export function filterParams(filters: AdminFilters, page = 1) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  params.set("page", String(page));
  return params;
}
export function filterRpcArgs(filters: AdminFilters) {
  // Operación en Perú: fecha hasta incluye todo ese día, mediante límite exclusivo.
  const until = filters.hasta ? new Date(Date.parse(filters.hasta + "T00:00:00-05:00") + 86400000).toISOString() : null;
  return {
    p_cliente_id: filters.cliente || null, p_unidad_id: filters.unidad || null,
    p_coordinador_id: filters.coordinador || null, p_estado: filters.estado || null,
    p_desde: filters.desde ? filters.desde + "T00:00:00-05:00" : null,
    p_hasta: until, p_busqueda: filters.q || null,
    p_solo_duplicados: filters.duplicados === "1",
    p_orden: filters.orden || "fecha",
    p_direccion: filters.direccion || "desc",
  };
}

export function nextSort(filters: AdminFilters, field: AdminSortField): AdminFilters {
  if (filters.orden !== field) return { ...filters, orden: field, direccion: "asc" };
  if (filters.direccion === "asc") return { ...filters, direccion: "desc" };
  return { ...filters, orden: "", direccion: "" };
}

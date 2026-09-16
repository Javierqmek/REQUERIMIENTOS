import type { SupabaseClient } from "@supabase/supabase-js";
import { filterRpcArgs, type AdminFilters } from "./filters";
import type { AdminOptions, AdminResult, SidigeRequirement } from "./types";

export const ADMIN_PAGE_SIZE = 50;
export async function getAdminOptions(db: SupabaseClient): Promise<AdminOptions> {
  const { data, error } = await db.rpc("admin_opciones_requerimientos");
  if (error) throw new Error("No se pudieron cargar los filtros. Verifica la migración administrativa.");
  return data as AdminOptions;
}
export async function getAdminResults(db: SupabaseClient, filters: AdminFilters, page = 1, signal?: AbortSignal): Promise<AdminResult> {
  let request = db.rpc("admin_consultar_requerimientos_v2", { ...filterRpcArgs(filters), p_limite: ADMIN_PAGE_SIZE, p_offset: (page - 1) * ADMIN_PAGE_SIZE, p_exportar: false });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw new Error("No se pudieron consultar los requerimientos. Verifica la migración administrativa.");
  return { ...data, duplicateTotal: data.duplicate_total ?? 0, duplicateGroups: data.duplicate_groups ?? 0, page, pageSize: ADMIN_PAGE_SIZE };
}
export async function* exportRequirements(db: SupabaseClient, filters: AdminFilters, signal?: AbortSignal): AsyncGenerator<SidigeRequirement> {
  const cutoff = new Date().toISOString();
  let cursor: { fecha: string; id: string } | undefined;
  while (true) {
    signal?.throwIfAborted();
    let request = db.rpc("admin_consultar_requerimientos_v2", {
      ...filterRpcArgs(filters), p_orden: "fecha", p_direccion: "desc", p_limite: 250, p_offset: 0, p_exportar: true,
      p_creado_hasta: cutoff, p_cursor_fecha: cursor?.fecha ?? null, p_cursor_id: cursor?.id ?? null,
    });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) throw new Error("No se pudo consultar la información para exportar.");
    const rows = data.rows as SidigeRequirement[];
    for (const row of rows) yield row;
    if (rows.length < 250) break;
    const last = rows[rows.length - 1];
    if (last.id === cursor?.id) throw new Error("No se pudo avanzar en la exportación.");
    cursor = { fecha: last.fecha, id: last.id };
  }
}

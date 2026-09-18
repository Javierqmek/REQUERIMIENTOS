import type { SupabaseClient } from "@supabase/supabase-js";
import { papeletaRpcArgs, type PapeletaFilters } from "./list-filters";
import type { PapeletaRow } from "./types";

export const PAPELETAS_PAGE_SIZE = 20;
export type PapeletaListResult = { rows: PapeletaRow[]; total: number; page: number; pageSize: number };
export type PapeletaListOptions = {
  clientes: { id: string; nombre: string }[];
  unidades: { id: string; cliente_id: string; nombre: string }[];
  provincias: { id: string; nombre: string }[];
  coordinadores: { id: string; nombre: string }[];
};

// Consulta en servidor, con filtros + paginación + orden por fecha descendente resueltos en la
// RPC (nunca se trae la tabla completa al cliente para filtrar en el navegador).
export async function getPapeletaList(db: SupabaseClient, filters: PapeletaFilters, page = 1, signal?: AbortSignal): Promise<PapeletaListResult> {
  let request = db.rpc("listar_papeletas_vacaciones_filtradas", { ...papeletaRpcArgs(filters), p_limite: PAPELETAS_PAGE_SIZE, p_offset: (page - 1) * PAPELETAS_PAGE_SIZE });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw new Error("No se pudieron cargar las papeletas de vacaciones.");
  return { ...(data as { rows: PapeletaRow[]; total: number }), page, pageSize: PAPELETAS_PAGE_SIZE };
}
export async function getPapeletaListOptions(db: SupabaseClient): Promise<PapeletaListOptions> {
  const { data, error } = await db.rpc("opciones_papeletas_vacaciones");
  if (error) throw new Error("No se pudieron cargar los filtros.");
  return data as PapeletaListOptions;
}

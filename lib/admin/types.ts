import type { Requerimiento } from "@/lib/types";

export type AdminRow = Requerimiento & { usuario_creador_id: string; cantidad_prendas: number; total_requerimiento: number | string };
export type AdminResult = { rows: AdminRow[]; total: number; page: number; pageSize: number };
export type AdminOptions = {
  clientes: { id: string; nombre: string }[];
  unidades: { id: string; cliente_id: string; nombre: string }[];
  coordinadores: { id: string; nombre: string; email: string }[];
};
export type SidigeDetail = {
  id: string; created_at: string; cantidad: number; precio_unitario: number | string | null;
  codigo_almacen: string | null; activo?: boolean;
  prendas: { codigo_prenda: string | null; nombre_prenda: string | null; codigo_almacen: string | null } | null;
};
export type SidigeRequirement = Omit<AdminRow, "detalle_requerimiento"> & { detalle_requerimiento: SidigeDetail[] };

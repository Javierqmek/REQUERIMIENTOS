export type PapeletaEstado = "REGISTRADO";
export const papeletaEstadoLabel: Record<PapeletaEstado, string> = { REGISTRADO: "Registrado" };

export interface PapeletaRow {
  id: string;
  created_at: string;
  colaborador_nombre: string;
  colaborador_codigo: string;
  fisicas_fecha_inicio: string;
  fisicas_fecha_fin: string;
  fisicas_dias: number;
  tiene_venta: boolean;
  venta_fecha_inicio: string | null;
  venta_fecha_fin: string | null;
  venta_dias: number | null;
  estado: PapeletaEstado;
  archivo_nombre: string;
  reemplazo: { nombre: string } | null;
  provincias: { nombre: string } | null;
  clientes: { nombre: string } | null;
  unidades: { nombre: string } | null;
  profiles?: { nombre: string } | null;
}

export const PAPELETA_LIST_SELECT =
  "id,created_at,colaborador_nombre,colaborador_codigo,fisicas_fecha_inicio,fisicas_fecha_fin,fisicas_dias," +
  "tiene_venta,venta_fecha_inicio,venta_fecha_fin,venta_dias,estado,archivo_nombre," +
  "reemplazo:personal!papeletas_vacaciones_reemplazo_id_fkey(nombre),provincias(nombre),clientes(nombre),unidades(nombre)," +
  "profiles!papeletas_vacaciones_coordinador_id_fkey(nombre)";

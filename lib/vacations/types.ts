export type PapeletaEstado = "REGISTRADO" | "OBSERVADO" | "CONFORME";
export const papeletaEstadoLabel: Record<PapeletaEstado, string> = {
  REGISTRADO: "Registrado", OBSERVADO: "Observado", CONFORME: "Conforme",
};

export interface PapeletaRow {
  id: string;
  created_at: string;
  updated_at?: string;
  colaborador_id?: string;
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
  version_actual: number;
  motivo_observacion: string | null;
  archivo_nombre: string;
  coordinador_id?: string;
  reemplazo_id?: string;
  provincia_id?: string;
  cliente_id?: string;
  unidad_id?: string;
  reemplazo: { nombre: string } | null;
  provincias: { nombre: string } | null;
  clientes: { nombre: string } | null;
  unidades: { nombre: string } | null;
  profiles?: { nombre: string } | null;
}

export interface PapeletaVersionRow {
  id: string;
  version: number;
  colaborador_nombre: string;
  fisicas_fecha_inicio: string;
  fisicas_fecha_fin: string;
  fisicas_dias: number;
  tiene_venta: boolean;
  venta_fecha_inicio: string | null;
  venta_fecha_fin: string | null;
  venta_dias: number | null;
  archivo_nombre: string;
  archivo_path: string;
  created_at: string;
}

export type PapeletaEventoAccion = "REGISTRADO" | "OBSERVADO" | "CORREGIDO" | "CONFORME";
export interface PapeletaEventoRow {
  id: number;
  accion: PapeletaEventoAccion;
  estado_anterior: PapeletaEstado | null;
  estado_nuevo: PapeletaEstado | null;
  version: number | null;
  motivo: string | null;
  created_at: string;
  profiles: { nombre: string } | null;
}

// unidades tiene dos FK desde papeletas_vacaciones (simple + compuesta con cliente_id, igual
// que requerimientos): hay que nombrar la relación o PostgREST responde PGRST201 (ambigua) y
// la consulta entera falla, lo que en la página se veía como "no hay papeletas registradas".
export const PAPELETA_LIST_SELECT =
  "id,created_at,colaborador_nombre,colaborador_codigo,fisicas_fecha_inicio,fisicas_fecha_fin,fisicas_dias," +
  "tiene_venta,venta_fecha_inicio,venta_fecha_fin,venta_dias,estado,version_actual,motivo_observacion,archivo_nombre," +
  "reemplazo:personal!papeletas_vacaciones_reemplazo_id_fkey(nombre),provincias(nombre),clientes(nombre)," +
  "unidades!papeletas_vacaciones_unidad_id_fkey(nombre)," +
  "profiles!papeletas_vacaciones_coordinador_id_fkey(nombre)";

export interface PapeletaDetailRow {
  id: string; created_at: string; updated_at: string; coordinador_id: string;
  colaborador_id: string; colaborador_nombre: string; colaborador_codigo: string;
  fisicas_fecha_inicio: string; fisicas_fecha_fin: string; fisicas_dias: number;
  tiene_venta: boolean; venta_fecha_inicio: string | null; venta_fecha_fin: string | null; venta_dias: number | null;
  estado: PapeletaEstado; version_actual: number; motivo_observacion: string | null; archivo_nombre: string;
  reemplazo_id: string; provincia_id: string; cliente_id: string; unidad_id: string;
  reemplazo: { id: string; nombre: string; dni: string; cargo: string; codigo_personal: string } | null;
  provincias: { id: string; nombre: string } | null;
  clientes: { id: string; nombre: string } | null;
  unidades: { id: string; nombre: string } | null;
  profiles: { nombre: string } | null;
}

// Mismo motivo que PAPELETA_LIST_SELECT: unidades necesita la FK explícita para no ser ambigua.
export const PAPELETA_DETAIL_SELECT =
  "id,created_at,updated_at,coordinador_id,colaborador_id,colaborador_nombre,colaborador_codigo," +
  "fisicas_fecha_inicio,fisicas_fecha_fin,fisicas_dias,tiene_venta,venta_fecha_inicio,venta_fecha_fin,venta_dias," +
  "estado,version_actual,motivo_observacion,archivo_nombre,reemplazo_id,provincia_id,cliente_id,unidad_id," +
  "reemplazo:personal!papeletas_vacaciones_reemplazo_id_fkey(id,nombre,dni,cargo,codigo_personal)," +
  "provincias(id,nombre),clientes(id,nombre),unidades!papeletas_vacaciones_unidad_id_fkey(id,nombre)," +
  "profiles!papeletas_vacaciones_coordinador_id_fkey(nombre)";

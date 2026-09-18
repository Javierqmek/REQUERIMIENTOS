// CONFORME se conserva como estado histórico/legado: papeletas marcadas conformes ANTES de que
// existiera la firma real (202609200001) no tienen gerente firmante, hash final, perfil de firma
// ni fecha de firma, y nunca se les inventan esos metadatos. Nadie puede llegar a CONFORME desde
// ahora (la RPC que lo hacía fue retirada); el único camino a un estado terminal nuevo es FIRMADO,
// vía firmar_papeleta_vacaciones. Ver migración para el detalle del incidente que motivó esto.
export type PapeletaEstado = "REGISTRADO" | "OBSERVADO" | "CONFORME" | "FIRMADO";
// REGISTRADO se muestra como "Pendiente de firma" salvo cuando nunca fue revisado por el
// coordinador (mismo valor de estado en ambos casos; el texto exacto lo decide el llamador
// según a quién se le muestra, ver componentes de lista/detalle).
export const papeletaEstadoLabel: Record<PapeletaEstado, string> = {
  REGISTRADO: "Pendiente de firma", OBSERVADO: "Observado", CONFORME: "Conforme (histórico)", FIRMADO: "Firmado",
};

export type PapeletaVersionTipo = "ORIGINAL" | "CORRECCION" | "FIRMADO";
export const papeletaVersionTipoLabel: Record<PapeletaVersionTipo, string> = {
  ORIGINAL: "Original", CORRECCION: "Corrección", FIRMADO: "Firmado",
};

// Fila compacta de la bandeja (coordinador/admin/gerente): SOLO lo que la tarjeta resumida
// necesita (colaborador, código, estado, fecha de registro, coordinador, cliente, unidad). Todo
// lo demás (físicas, venta, reemplazo, provincia detallada) vive únicamente en PapeletaDetailRow,
// visible desde "Ver detalle". La forma coincide con lo que devuelve la RPC
// listar_papeletas_vacaciones_filtradas (ver lib/vacations/list-data.ts), no con un select directo.
export interface PapeletaRow {
  id: string;
  created_at: string;
  colaborador_nombre: string;
  colaborador_codigo: string;
  estado: PapeletaEstado;
  version_actual: number;
  motivo_observacion: string | null;
  archivo_nombre: string;
  es_prueba: boolean;
  coordinador_id: string;
  provincia_id: string | null;
  cliente_id: string | null;
  unidad_id: string | null;
  provincias: { nombre: string } | null;
  clientes: { nombre: string } | null;
  unidades: { nombre: string } | null;
  profiles: { nombre: string } | null;
}

export interface PapeletaVersionRow {
  id: string;
  version: number;
  tipo: PapeletaVersionTipo;
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

export type PapeletaEventoAccion = "REGISTRADO" | "OBSERVADO" | "CORREGIDO" | "FIRMADO" | "CONFORME";
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

export interface PapeletaDetailRow {
  id: string; created_at: string; updated_at: string; coordinador_id: string;
  colaborador_id: string; colaborador_nombre: string; colaborador_codigo: string;
  fisicas_fecha_inicio: string; fisicas_fecha_fin: string; fisicas_dias: number;
  tiene_venta: boolean; venta_fecha_inicio: string | null; venta_fecha_fin: string | null; venta_dias: number | null;
  estado: PapeletaEstado; version_actual: number; motivo_observacion: string | null; archivo_nombre: string; archivo_sha256: string;
  es_prueba: boolean;
  firmado_por: string | null; firmado_at: string | null; firma_perfil_version: number | null;
  reemplazo_id: string; provincia_id: string; cliente_id: string; unidad_id: string;
  reemplazo: { id: string; nombre: string; dni: string; cargo: string; codigo_personal: string } | null;
  provincias: { id: string; nombre: string } | null;
  clientes: { id: string; nombre: string } | null;
  unidades: { id: string; nombre: string } | null;
  profiles: { nombre: string } | null;
  firmante: { nombre: string } | null;
}

// Mismo motivo que PAPELETA_LIST_SELECT: unidades necesita la FK explícita para no ser ambigua.
// firmante usa el mismo hint por la misma razón (papeletas_vacaciones tiene dos FK a profiles:
// coordinador_id y firmado_por).
export const PAPELETA_DETAIL_SELECT =
  "id,created_at,updated_at,coordinador_id,colaborador_id,colaborador_nombre,colaborador_codigo," +
  "fisicas_fecha_inicio,fisicas_fecha_fin,fisicas_dias,tiene_venta,venta_fecha_inicio,venta_fecha_fin,venta_dias," +
  "estado,version_actual,motivo_observacion,archivo_nombre,archivo_sha256,es_prueba,firmado_por,firmado_at,firma_perfil_version," +
  "reemplazo_id,provincia_id,cliente_id,unidad_id," +
  "reemplazo:personal!papeletas_vacaciones_reemplazo_id_fkey(id,nombre,dni,cargo,codigo_personal)," +
  "provincias(id,nombre),clientes(id,nombre),unidades!papeletas_vacaciones_unidad_id_fkey(id,nombre)," +
  "profiles!papeletas_vacaciones_coordinador_id_fkey(nombre)," +
  "firmante:profiles!papeletas_vacaciones_firmado_por_fkey(nombre)";

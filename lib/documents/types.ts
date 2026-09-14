export type DocumentStatus = "BORRADOR"|"PENDIENTE_FIRMA"|"OBSERVADO"|"FIRMADO"|"RECHAZADO";
export type DocumentType = "VACACIONES"|"LICENCIA_CON_GOCE"|"LICENCIA_SIN_GOCE";
export type Placement = { id?:string; usuario_id?:string; tipo:"FIRMA"|"SELLO"; pagina:number; x:number; y:number; ancho:number; alto:number; asset_path?:string };
export type DocumentRow = {
  id:string; tipo:DocumentType; trabajador_id:string; usuario_creador_id:string; firmante_id:string;
  estado:DocumentStatus; observacion:string|null; comentario_decision:string|null;
  archivo_original_nombre:string; archivo_original_path:string; archivo_firmado_path:string|null;
  archivo_coordinador_path:string|null; archivo_coordinador_sha256:string|null;
  coordinador_firmado_at:string|null; coordinador_firmante_id:string|null;
  paginas:number; created_at:string; enviado_at:string|null; firmado_at:string|null;
  personal:{nombre:string;dni:string;cargo:string}|null;
  creador:{nombre:string}|null;
  coordinador_firmante?:{nombre:string}|null;
  firmante:{nombre:string}|null;
};
export const documentStatusLabel:Record<DocumentStatus,string>={
  BORRADOR:"Borrador",PENDIENTE_FIRMA:"Pendiente de firma",OBSERVADO:"Observado",FIRMADO:"Firmado",RECHAZADO:"Rechazado"
};
export const documentTypeLabel:Record<DocumentType,string>={
  VACACIONES:"Vacaciones",LICENCIA_CON_GOCE:"Licencia con goce",LICENCIA_SIN_GOCE:"Licencia sin goce"
};

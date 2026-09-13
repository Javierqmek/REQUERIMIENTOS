export type DocumentStatus = "BORRADOR"|"PENDIENTE_FIRMA"|"OBSERVADO"|"FIRMADO"|"RECHAZADO";
export type DocumentType = "VACACIONES"|"PERMISO"|"MEMORANDO"|"OTRO";
export type Placement = { id?:string; usuario_id?:string; tipo:"FIRMA"|"SELLO"; pagina:number; x:number; y:number; ancho:number; alto:number; asset_path?:string };
export type DocumentRow = {
  id:string; tipo:DocumentType; trabajador_id:string; usuario_creador_id:string; firmante_id:string;
  estado:DocumentStatus; observacion:string|null; comentario_decision:string|null;
  archivo_original_nombre:string; archivo_original_path:string; archivo_firmado_path:string|null;
  paginas:number; created_at:string; enviado_at:string|null; firmado_at:string|null;
  personal:{nombre:string;dni:string;cargo:string}|null;
  profiles:{nombre:string}|null;
};
export const documentStatusLabel:Record<DocumentStatus,string>={
  BORRADOR:"Borrador",PENDIENTE_FIRMA:"Pendiente de firma",OBSERVADO:"Observado",FIRMADO:"Firmado",RECHAZADO:"Rechazado"
};

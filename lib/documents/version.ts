export type DocumentVersionPaths={
  archivo_original_path:string;
  archivo_coordinador_path:string|null;
  archivo_firmado_path?:string|null;
};

export function documentBasePath(document:DocumentVersionPaths){
  return document.archivo_coordinador_path||document.archivo_original_path;
}

export function documentVersionPath(document:DocumentVersionPaths,type:"original"|"coordinador"|"firmado"|"base"){
  if(type==="coordinador")return document.archivo_coordinador_path;
  if(type==="firmado")return document.archivo_firmado_path||null;
  if(type==="base")return documentBasePath(document);
  return document.archivo_original_path;
}

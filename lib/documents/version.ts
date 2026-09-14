export type DocumentPdfVersion="original"|"coordinador"|"firmado";
export type RequestedDocumentVersion=DocumentPdfVersion|"base";
export type DocumentVersionPaths={
  archivo_original_path:string;
  archivo_original_sha256:string;
  archivo_coordinador_path:string|null;
  archivo_coordinador_sha256:string|null;
  archivo_firmado_path?:string|null;
  archivo_firmado_sha256?:string|null;
};
export type ResolvedDocumentVersion={type:DocumentPdfVersion;path:string;sha256:string};

function resolved(type:DocumentPdfVersion,path:string|null|undefined,sha256:string|null|undefined){
  return path&&sha256?{type,path,sha256}:null;
}

export function documentSigningBase(document:DocumentVersionPaths):ResolvedDocumentVersion{
  const coordinator=resolved("coordinador",document.archivo_coordinador_path,document.archivo_coordinador_sha256);
  const coordinatorStarted=Boolean(document.archivo_coordinador_path||document.archivo_coordinador_sha256);if(coordinatorStarted&&!coordinator)throw new Error("La versión coordinador está incompleta.");
  const original=resolved("original",document.archivo_original_path,document.archivo_original_sha256);
  if(coordinator)return coordinator;if(original)return original;throw new Error("La versión base del documento está incompleta.");
}

export function resolveDocumentVersion(document:DocumentVersionPaths,type:RequestedDocumentVersion):ResolvedDocumentVersion|null{
  if(type==="base")return documentSigningBase(document);
  if(type==="coordinador")return resolved(type,document.archivo_coordinador_path,document.archivo_coordinador_sha256);
  if(type==="firmado")return resolved(type,document.archivo_firmado_path,document.archivo_firmado_sha256);
  return resolved(type,document.archivo_original_path,document.archivo_original_sha256);
}

export function documentBasePath(document:DocumentVersionPaths){return documentSigningBase(document).path}
export function documentVersionPath(document:DocumentVersionPaths,type:RequestedDocumentVersion){return resolveDocumentVersion(document,type)?.path||null}
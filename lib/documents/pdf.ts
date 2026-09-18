import { degrees,PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Placement } from "./types";
import { DOCUMENT_BUCKET,sha256 } from "./security";
import { fitImageInPlacement } from "./placement";

// sourceBucket permite reutilizar este mismo motor de composición para PDFs que viven fuera del
// bucket de Documentos (p.ej. papeletas-vacaciones): los assets de firma (sello/firma) siguen
// viviendo siempre en DOCUMENT_BUCKET porque perfiles_firma es compartido entre módulos.
export async function createSignedPdf(db:SupabaseClient,originalPath:string,placements:Placement[],expectedSourceHash?:string,sourceBucket:string=DOCUMENT_BUCKET){
  const original=await db.storage.from(sourceBucket).download(originalPath);
  if(original.error)throw new Error("No se pudo leer el PDF original.");
  const sourceBytes=new Uint8Array(await original.data.arrayBuffer());if(expectedSourceHash&&sha256(sourceBytes)!==expectedSourceHash)throw new Error("La versión base no coincide con su hash registrado.");
  const pdf=await PDFDocument.load(sourceBytes);
  const assets=new Map<string,Uint8Array>();
  for(const placement of placements){
    if(!placement.asset_path)throw new Error("Evidencia de firma incompleta.");
    if(!assets.has(placement.asset_path)){
      const result=await db.storage.from(DOCUMENT_BUCKET).download(placement.asset_path);
      if(result.error)throw new Error("No se pudo leer una imagen de firma.");
      assets.set(placement.asset_path,new Uint8Array(await result.data.arrayBuffer()));
    }
    const page=pdf.getPage(placement.pagina-1);if(!page)throw new Error("Página de firma inválida.");
    const image=await pdf.embedPng(assets.get(placement.asset_path)!);
    const crop=page.getCropBox();const rect=fitImageInPlacement(image,{...crop,rotation:page.getRotation().angle},placement);
    page.drawImage(image,{x:rect.x,y:rect.y,width:rect.width,height:rect.height,rotate:degrees(rect.rotation)});
  }
  const bytes=await pdf.save({useObjectStreams:true});return {bytes,hash:sha256(bytes)};
}

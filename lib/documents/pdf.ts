import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Placement } from "./types";
import { DOCUMENT_BUCKET,sha256 } from "./security";

export async function createSignedPdf(db:SupabaseClient,originalPath:string,placements:Placement[]){
  const original=await db.storage.from(DOCUMENT_BUCKET).download(originalPath);
  if(original.error)throw new Error("No se pudo leer el PDF original.");
  const pdf=await PDFDocument.load(await original.data.arrayBuffer());
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
    const {width,height}=page.getSize();const drawWidth=placement.ancho*width;const drawHeight=placement.alto*height;
    page.drawImage(image,{x:placement.x*width,y:height-placement.y*height-drawHeight,width:drawWidth,height:drawHeight});
  }
  const bytes=await pdf.save({useObjectStreams:true});return {bytes,hash:sha256(bytes)};
}

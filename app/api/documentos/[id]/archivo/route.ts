import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { DOCUMENT_BUCKET } from "@/lib/documents/security";
import { documentVersionPath } from "@/lib/documents/version";

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const profile=await getCurrentProfile();if(!profile)return NextResponse.json({error:"Sesión requerida."},{status:401});
  const id=(await params).id;const url=new URL(request.url);const elemento=url.searchParams.get("elemento");const requested=url.searchParams.get("tipo");const tipo=requested==="firmado"?"firmado":requested==="coordinador"?"coordinador":requested==="base"?"base":"original";const db=await createClient();
  if(elemento){
    if(!/^[0-9a-f-]{36}$/i.test(elemento))return NextResponse.json({error:"Elemento inválido."},{status:400});
    const {data}=await db.from("documento_firmas").select("asset_path").eq("id",elemento).eq("documento_id",id).maybeSingle();
    if(!data?.asset_path)return NextResponse.json({error:"Imagen no disponible."},{status:404});
    const image=await db.storage.from(DOCUMENT_BUCKET).download(data.asset_path);if(image.error)return NextResponse.json({error:"Imagen no disponible."},{status:404});
    return new NextResponse(image.data,{headers:{"Content-Type":"image/png","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }
  const {data:doc}=await db.from("documentos").select("archivo_original_path,archivo_original_nombre,archivo_coordinador_path,archivo_firmado_path").eq("id",id).maybeSingle();
  const path=doc?documentVersionPath(doc,tipo):null;if(!doc||!path)return NextResponse.json({error:"Archivo no disponible."},{status:404});
  const result=await db.storage.from(DOCUMENT_BUCKET).download(path);if(result.error)return NextResponse.json({error:"No se pudo leer el archivo."},{status:404});
  if(tipo!=="base")await db.rpc("registrar_descarga_documento",{p_documento_id:id,p_tipo:tipo});
  const prefix=tipo==="firmado"?"firmado-":tipo==="coordinador"?"coordinador-":"";const disposition=url.searchParams.get("download")==="1"?`attachment; filename="${prefix}${doc.archivo_original_nombre}"`:"inline";
  return new NextResponse(result.data,{headers:{"Content-Type":"application/pdf","Content-Disposition":disposition,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}

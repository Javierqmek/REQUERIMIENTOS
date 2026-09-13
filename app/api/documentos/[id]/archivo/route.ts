import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { DOCUMENT_BUCKET } from "@/lib/documents/security";

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const profile=await getCurrentProfile();if(!profile)return NextResponse.json({error:"Sesión requerida."},{status:401});
  const id=(await params).id;const tipo=new URL(request.url).searchParams.get("tipo")==="firmado"?"firmado":"original";const db=await createClient();
  const {data:doc}=await db.from("documentos").select("archivo_original_path,archivo_original_nombre,archivo_firmado_path").eq("id",id).maybeSingle();
  const path=tipo==="firmado"?doc?.archivo_firmado_path:doc?.archivo_original_path;if(!doc||!path)return NextResponse.json({error:"Archivo no disponible."},{status:404});
  const result=await db.storage.from(DOCUMENT_BUCKET).download(path);if(result.error)return NextResponse.json({error:"No se pudo leer el archivo."},{status:404});
  await db.rpc("registrar_descarga_documento",{p_documento_id:id,p_tipo:tipo});
  const disposition=new URL(request.url).searchParams.get("download")==="1"?`attachment; filename="${tipo==="firmado"?"firmado-":""}${doc.archivo_original_nombre}"`:"inline";
  return new NextResponse(result.data,{headers:{"Content-Type":"application/pdf","Content-Disposition":disposition,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}

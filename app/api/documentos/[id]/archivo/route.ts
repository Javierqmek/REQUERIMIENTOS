import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { DOCUMENT_BUCKET,sha256 } from "@/lib/documents/security";
import { resolveDocumentVersion,type RequestedDocumentVersion } from "@/lib/documents/version";

const versions=new Set<RequestedDocumentVersion>(["original","coordinador","firmado","base"]);

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const profile=await getCurrentProfile();if(!profile)return NextResponse.json({error:"Sesión requerida."},{status:401});
  const id=(await params).id;const url=new URL(request.url);const elemento=url.searchParams.get("elemento");const requested=url.searchParams.get("tipo")||"original";if(!versions.has(requested as RequestedDocumentVersion))return NextResponse.json({error:"Versión inválida."},{status:400});const tipo=requested as RequestedDocumentVersion;const db=await createClient();
  if(elemento){
    if(!/^[0-9a-f-]{36}$/i.test(elemento))return NextResponse.json({error:"Elemento inválido."},{status:400});
    const {data}=await db.from("documento_firmas").select("asset_path").eq("id",elemento).eq("documento_id",id).maybeSingle();
    if(!data?.asset_path)return NextResponse.json({error:"Imagen no disponible."},{status:404});
    const image=await db.storage.from(DOCUMENT_BUCKET).download(data.asset_path);if(image.error)return NextResponse.json({error:"Imagen no disponible."},{status:404});
    return new NextResponse(image.data,{headers:{"Content-Type":"image/png","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }
  const {data:doc}=await db.from("documentos").select("archivo_original_path,archivo_original_nombre,archivo_original_sha256,archivo_coordinador_path,archivo_coordinador_sha256,archivo_firmado_path,archivo_firmado_sha256").eq("id",id).maybeSingle();
  const version=doc?resolveDocumentVersion(doc,tipo):null;if(!doc||!version)return NextResponse.json({error:"Archivo no disponible."},{status:404});
  const expectedHash=url.searchParams.get("version");if(expectedHash&&expectedHash!==version.sha256)return NextResponse.json({error:"La versión del documento cambió. Actualiza la página."},{status:409});
  const result=await db.storage.from(DOCUMENT_BUCKET).download(version.path);if(result.error)return NextResponse.json({error:"No se pudo leer el archivo."},{status:404});const bytes=new Uint8Array(await result.data.arrayBuffer());if(sha256(bytes)!==version.sha256)return NextResponse.json({error:"El archivo almacenado no coincide con la versión registrada."},{status:409});
  await db.rpc("registrar_descarga_documento",{p_documento_id:id,p_tipo:version.type});
  const prefix=version.type==="firmado"?"firmado-":version.type==="coordinador"?"coordinador-":"";const disposition=url.searchParams.get("download")==="1"?`attachment; filename="${prefix}${doc.archivo_original_nombre}"`:"inline";
  return new NextResponse(new Blob([bytes],{type:"application/pdf"}),{headers:{"Content-Type":"application/pdf","Content-Disposition":disposition,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Document-Version":version.type,"X-Document-SHA256":version.sha256}});
}
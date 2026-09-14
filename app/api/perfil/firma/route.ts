import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/security/http";
import { DOCUMENT_BUCKET,makeCorporateStamp,normalizeImportedSignatureAsset,normalizeSignature } from "@/lib/documents/security";

export async function GET(request:Request){
  const profile=await getCurrentProfile();if(!profile)return NextResponse.json({error:"Sesión requerida."},{status:401});
  const tipo=new URL(request.url).searchParams.get("tipo");if(tipo!=="firma"&&tipo!=="sello")return NextResponse.json({error:"Tipo inválido."},{status:400});
  const db=await createClient();const {data}=await db.from("perfiles_firma").select("firma_path,sello_path").eq("usuario_id",profile.id).eq("activo",true).maybeSingle();
  const path=tipo==="firma"?data?.firma_path:data?.sello_path;if(!path)return NextResponse.json({error:"Imagen no disponible."},{status:404});
  const result=await db.storage.from(DOCUMENT_BUCKET).download(path);if(result.error)return NextResponse.json({error:"Imagen no disponible."},{status:404});
  return new NextResponse(result.data,{headers:{"Content-Type":"image/png","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const profile=await getCurrentProfile();
    if(!profile||!["coordinador","gerente"].includes(profile.role))return NextResponse.json({error:"No autorizado."},{status:403});
    const length=Number(request.headers.get("content-length"));if(Number.isFinite(length)&&length>3*1024*1024)return NextResponse.json({error:"Solicitud demasiado grande."},{status:413});
    const form=await request.formData();const mode=String(form.get("modo")||"DIBUJADA");
    if(mode!=="DIBUJADA"&&mode!=="IMPORTADA")return NextResponse.json({error:"Modo de firma inválido."},{status:400});
    const signature=form.get("firma");const db=await createClient();const version=crypto.randomUUID();
    const {data:current}=await db.from("perfiles_firma").select("nombre_mostrado,cargo,firma_path,firma_sha256,sello_path,sello_sha256").eq("usuario_id",profile.id).eq("activo",true).maybeSingle();
    const imported=mode==="IMPORTADA";const nombre=imported?(current?.nombre_mostrado||profile.nombre):String(form.get("nombre")||"").trim();const cargo=imported?(current?.cargo||profile.role):String(form.get("cargo")||"").trim();
    if(nombre.length<2||nombre.length>160||cargo.length<2||cargo.length>120)return NextResponse.json({error:imported?"No se pudo identificar al titular del perfil.":"Revisa el nombre y el cargo."},{status:400});
    if(imported){
      if(!(signature instanceof File)||!signature.size){
        if(current?.firma_path&&current.firma_path===current.sello_path)return NextResponse.json({perfil:current});
        return NextResponse.json({error:"Selecciona la imagen PNG o WebP completa."},{status:400});
      }
      const asset=await normalizeImportedSignatureAsset(signature);const assetPath=`firmas/${profile.id}/${version}.png`;
      const upload=await db.storage.from(DOCUMENT_BUCKET).upload(assetPath,asset.bytes,{contentType:"image/png",upsert:false});if(upload.error)throw new Error("No se pudo guardar la imagen de firma.");
      const {data,error}=await db.rpc("guardar_perfil_firma",{p_nombre:nombre,p_cargo:cargo,p_firma_path:assetPath,p_firma_sha256:asset.hash,p_sello_path:assetPath,p_sello_sha256:asset.hash});
      if(error){await db.storage.from(DOCUMENT_BUCKET).remove([assetPath]);throw new Error(error.message);}return NextResponse.json({perfil:data,modo:"IMPORTADA"});
    }
    let firmaPath:string|null=current?.firma_path||null;let firmaHash:string|null=current?.firma_sha256||null;let firmaNuevaPath:string|null=null;let firmaBytes:Uint8Array|null=null;
    if(signature instanceof File&&signature.size){
      const normalized=await normalizeSignature(signature);firmaBytes=normalized.bytes;firmaPath=`firmas/${profile.id}/${version}.png`;firmaNuevaPath=firmaPath;firmaHash=normalized.hash;
      const upload=await db.storage.from(DOCUMENT_BUCKET).upload(firmaPath,normalized.bytes,{contentType:"image/png",upsert:false});if(upload.error)throw new Error("No se pudo guardar la firma.");
    }else if(current?.firma_path===current?.sello_path)return NextResponse.json({error:"Dibuja la firma antes de generar el sello corporativo."},{status:400});
    if(!firmaBytes&&firmaPath){const stored=await db.storage.from(DOCUMENT_BUCKET).download(firmaPath);if(stored.error)throw new Error("No se pudo leer la firma vigente.");firmaBytes=new Uint8Array(await stored.data.arrayBuffer());}
    const stamp=await makeCorporateStamp(nombre,cargo,firmaBytes);const selloPath=`sellos/${profile.id}/${version}.png`;
    const stampUpload=await db.storage.from(DOCUMENT_BUCKET).upload(selloPath,stamp.bytes,{contentType:"image/png",upsert:false});
    if(stampUpload.error){if(firmaNuevaPath)await db.storage.from(DOCUMENT_BUCKET).remove([firmaNuevaPath]);throw new Error("No se pudo guardar el sello.");}
    const {data,error}=await db.rpc("guardar_perfil_firma",{p_nombre:nombre,p_cargo:cargo,p_firma_path:firmaPath,p_firma_sha256:firmaHash,p_sello_path:selloPath,p_sello_sha256:stamp.hash});
    if(error){await db.storage.from(DOCUMENT_BUCKET).remove([selloPath,...(firmaNuevaPath?[firmaNuevaPath]:[])]);throw new Error(error.message);}
    return NextResponse.json({perfil:data,modo:"DIBUJADA"});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"No se pudo guardar el perfil."},{status:400});}
}

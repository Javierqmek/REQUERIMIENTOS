import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/security/http";
import { DOCUMENT_BUCKET,makeCorporateStamp,normalizeSignature } from "@/lib/documents/security";

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const profile=await getCurrentProfile();
    if(!profile||!["coordinador","gerente"].includes(profile.role))return NextResponse.json({error:"No autorizado."},{status:403});
    const length=Number(request.headers.get("content-length"));if(Number.isFinite(length)&&length>3*1024*1024)return NextResponse.json({error:"Solicitud demasiado grande."},{status:413});
    const form=await request.formData();const nombre=String(form.get("nombre")||"").trim();const cargo=String(form.get("cargo")||"").trim();
    if(nombre.length<2||nombre.length>160||cargo.length<2||cargo.length>120)return NextResponse.json({error:"Revisa el nombre y el cargo."},{status:400});
    const signature=form.get("firma");const db=await createClient();const version=crypto.randomUUID();
    let firmaPath:string|null=null;let firmaHash:string|null=null;
    if(signature instanceof File&&signature.size){
      const normalized=await normalizeSignature(signature);firmaPath=`firmas/${profile.id}/${version}.png`;firmaHash=normalized.hash;
      const upload=await db.storage.from(DOCUMENT_BUCKET).upload(firmaPath,normalized.bytes,{contentType:"image/png",upsert:false});
      if(upload.error)throw new Error("No se pudo guardar la firma.");
    }
    const stamp=await makeCorporateStamp(nombre,cargo);const selloPath=`sellos/${profile.id}/${version}.png`;
    const stampUpload=await db.storage.from(DOCUMENT_BUCKET).upload(selloPath,stamp.bytes,{contentType:"image/png",upsert:false});
    if(stampUpload.error){if(firmaPath)await db.storage.from(DOCUMENT_BUCKET).remove([firmaPath]);throw new Error("No se pudo guardar el sello.");}
    const {data,error}=await db.rpc("guardar_perfil_firma",{p_nombre:nombre,p_cargo:cargo,p_firma_path:firmaPath,p_firma_sha256:firmaHash,p_sello_path:selloPath,p_sello_sha256:stamp.hash});
    if(error){await db.storage.from(DOCUMENT_BUCKET).remove([selloPath,...(firmaPath?[firmaPath]:[])]);throw new Error(error.message);}
    return NextResponse.json({perfil:data});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"No se pudo guardar el perfil."},{status:400});}
}

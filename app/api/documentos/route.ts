import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/security/http";
import { DOCUMENT_BUCKET,MAX_PDF_BYTES,validatePdf } from "@/lib/documents/security";
const TYPES=new Set(["VACACIONES","LICENCIA_CON_GOCE","LICENCIA_SIN_GOCE"]);

export async function POST(request:Request){
  let uploadedPath="";
  try{
    assertSameOrigin(request);const profile=await getCurrentProfile();
    if(!profile||profile.role!=="coordinador")return NextResponse.json({error:"Solo coordinadores pueden crear documentos."},{status:403});
    const length=Number(request.headers.get("content-length"));if(Number.isFinite(length)&&length>MAX_PDF_BYTES+256*1024)return NextResponse.json({error:"Solicitud demasiado grande."},{status:413});
    const form=await request.formData();const file=form.get("archivo");if(!(file instanceof File))return NextResponse.json({error:"Selecciona un PDF."},{status:400});
    const tipo=String(form.get("tipo")||"");const trabajadorId=String(form.get("trabajador_id")||"");const firmanteId=String(form.get("firmante_id")||"");
    const observacion=String(form.get("observacion")||"").trim();if(!TYPES.has(tipo)||observacion.length>1000)return NextResponse.json({error:"Datos del documento inválidos."},{status:400});
    const parsed=await validatePdf(file);const id=crypto.randomUUID();uploadedPath=`original/${profile.id}/${id}.pdf`;const db=await createClient();
    const upload=await db.storage.from(DOCUMENT_BUCKET).upload(uploadedPath,parsed.bytes,{contentType:"application/pdf",upsert:false});
    if(upload.error)throw new Error("No se pudo almacenar el PDF original.");
    const {error}=await db.rpc("registrar_documento",{p_id:id,p_tipo:tipo,p_trabajador_id:trabajadorId,p_firmante_id:firmanteId,p_observacion:observacion||null,p_path:uploadedPath,p_nombre:parsed.name,p_sha256:parsed.hash,p_bytes:parsed.bytes.length,p_paginas:parsed.pages});
    if(error){await db.storage.from(DOCUMENT_BUCKET).remove([uploadedPath]);throw new Error(error.message);}
    return NextResponse.json({id},{status:201});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"No se pudo crear el documento."},{status:400});}
}

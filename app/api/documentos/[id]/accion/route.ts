import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { readJsonBody,HttpInputError } from "@/lib/security/http";
import { createSignedPdf } from "@/lib/documents/pdf";
import { DOCUMENT_BUCKET } from "@/lib/documents/security";
import { documentSigningBase } from "@/lib/documents/version";
import type { Placement } from "@/lib/documents/types";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const profile=await getCurrentProfile();if(!profile)return NextResponse.json({error:"Sesión requerida."},{status:401});
  const id=(await params).id;let body:Record<string,unknown>;
  try{body=await readJsonBody(request,64*1024) as Record<string,unknown>;}catch(error){const status=error instanceof HttpInputError?error.status:400;return NextResponse.json({error:error instanceof Error?error.message:"Solicitud inválida."},{status});}
  const action=String(body.accion||"");const db=await createClient();
  try{
    if(action==="colocaciones"){
      const {error}=await db.rpc("guardar_colocaciones_documento",{p_documento_id:id,p_colocaciones:body.colocaciones});if(error)throw new Error(error.message);
    }else if(action==="enviar"){
      const {error}=await db.rpc("enviar_documento_firma",{p_documento_id:id});if(error)throw new Error(error.message);
    }else if(action==="firmar_coordinador"){
      const prepared=await db.rpc("preparar_firma_coordinador",{p_documento_id:id});if(prepared.error)throw new Error(prepared.error.message);
      const token=prepared.data as string;let coordinatorPath="";
      try{
        const {data:doc,error:docError}=await db.from("documentos").select("archivo_original_path,archivo_original_sha256").eq("id",id).single();if(docError)throw docError;
        const {data:placements,error:placementsError}=await db.from("documento_firmas").select("tipo,pagina,x,y,ancho,alto,asset_path").eq("documento_id",id).eq("usuario_id",profile.id);if(placementsError)throw placementsError;
        const result=await createSignedPdf(db,doc.archivo_original_path,(placements||[]).map(row=>({...row,x:Number(row.x),y:Number(row.y),ancho:Number(row.ancho),alto:Number(row.alto)}) as Placement),doc.archivo_original_sha256);
        coordinatorPath=`coordinador/${id}/${crypto.randomUUID()}.pdf`;const upload=await db.storage.from(DOCUMENT_BUCKET).upload(coordinatorPath,result.bytes,{contentType:"application/pdf",upsert:false});if(upload.error)throw upload.error;
        const confirmation=await db.rpc("confirmar_firma_coordinador",{p_documento_id:id,p_token:token,p_path:coordinatorPath,p_sha256:result.hash});
        if(confirmation.error){await db.storage.from(DOCUMENT_BUCKET).remove([coordinatorPath]);throw confirmation.error;}
      }catch(error){await db.rpc("cancelar_preparacion_firma_coordinador",{p_documento_id:id,p_token:token});throw error;}
    }else if(action==="observar"||action==="rechazar"){
      const {error}=await db.rpc("decidir_documento",{p_documento_id:id,p_decision:action.toUpperCase(),p_comentario:String(body.comentario||"")});if(error)throw new Error(error.message);
    }else if(action==="firmar"){
      const prepared=await db.rpc("preparar_firma_documento",{p_documento_id:id});if(prepared.error)throw new Error(prepared.error.message);
      const token=prepared.data as string;let finalPath="";
      try{
        const {data:doc,error:docError}=await db.from("documentos").select("archivo_original_path,archivo_original_sha256,archivo_coordinador_path,archivo_coordinador_sha256").eq("id",id).single();if(docError)throw docError;
        const {data:placements,error:placementsError}=await db.from("documento_firmas").select("tipo,pagina,x,y,ancho,alto,asset_path").eq("documento_id",id).eq("usuario_id",profile.id);if(placementsError)throw placementsError;
        const base=documentSigningBase(doc);const result=await createSignedPdf(db,base.path,(placements||[]).map(row=>({...row,x:Number(row.x),y:Number(row.y),ancho:Number(row.ancho),alto:Number(row.alto)}) as Placement),base.sha256);
        finalPath=`firmado/${id}/${crypto.randomUUID()}.pdf`;const upload=await db.storage.from(DOCUMENT_BUCKET).upload(finalPath,result.bytes,{contentType:"application/pdf",upsert:false});if(upload.error)throw upload.error;
        const confirmation=await db.rpc("confirmar_firma_documento",{p_documento_id:id,p_token:token,p_path:finalPath,p_sha256:result.hash});
        if(confirmation.error){await db.storage.from(DOCUMENT_BUCKET).remove([finalPath]);throw confirmation.error;}
      }catch(error){await db.rpc("cancelar_preparacion_firma",{p_documento_id:id,p_token:token});throw error;}
    }else return NextResponse.json({error:"Acción inválida."},{status:400});
    return NextResponse.json({ok:true});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"No se pudo completar la acción."},{status:400});}
}

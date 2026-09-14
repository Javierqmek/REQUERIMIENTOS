import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { createSignedPdf } from "@/lib/documents/pdf";
import { documentSigningBase } from "@/lib/documents/version";
import type { Placement } from "@/lib/documents/types";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const asArrayBuffer=(bytes:Uint8Array)=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;

export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
 const profile=await getCurrentProfile();if(!profile)return NextResponse.json({error:"Sesión requerida."},{status:401});
 const id=(await params).id;if(!uuid.test(id))return NextResponse.json({error:"Documento inválido."},{status:400});const db=await createClient();
 const {data:document,error}=await db.from("documentos").select("usuario_creador_id,firmante_id,estado,archivo_original_path,archivo_original_sha256,archivo_coordinador_path,archivo_coordinador_sha256").eq("id",id).maybeSingle();
 if(error||!document)return NextResponse.json({error:"Documento no disponible."},{status:404});
 const coordinator=profile.role==="coordinador"&&document.usuario_creador_id===profile.id&&["BORRADOR","OBSERVADO"].includes(document.estado)&&!document.archivo_coordinador_path;
 const manager=profile.role==="gerente"&&document.firmante_id===profile.id&&document.estado==="PENDIENTE_FIRMA";
 if(!coordinator&&!manager)return NextResponse.json({error:"No autorizado para previsualizar."},{status:403});
 const {data:rows,error:placementsError}=await db.from("documento_firmas").select("tipo,pagina,x,y,ancho,alto,asset_path").eq("documento_id",id).eq("usuario_id",profile.id);
 if(placementsError)return NextResponse.json({error:"No se pudieron leer las ubicaciones guardadas."},{status:400});
 try{
  const base=manager?documentSigningBase(document):{type:"original" as const,path:document.archivo_original_path,sha256:document.archivo_original_sha256};
  const result=await createSignedPdf(db,base.path,(rows||[]).map(row=>({...row,x:Number(row.x),y:Number(row.y),ancho:Number(row.ancho),alto:Number(row.alto)}) as Placement),base.sha256);
  return new NextResponse(new Blob([asArrayBuffer(result.bytes)],{type:"application/pdf"}),{headers:{"Content-Type":"application/pdf","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Preview-SHA256":result.hash,"X-Base-Version":base.type,"X-Base-SHA256":base.sha256}});
 }catch(error){
  return NextResponse.json({error:error instanceof Error?error.message:"No se pudo generar la vista previa."},{status:400});
 }
}

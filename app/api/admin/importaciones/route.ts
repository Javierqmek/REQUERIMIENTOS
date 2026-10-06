import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { esAdminUniformes } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/security/http";
import { prepareImport } from "@/lib/admin/maintenance";
import { ImportInputError, preparePrendasImport } from "@/lib/admin/prendas-import";

const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export async function POST(request:Request){
  try{
    if(!esAdminUniformes((await getCurrentProfile())?.role))return response({error:"No autorizado"},403);
    const db=await createClient();const body=await readJsonBody(request,1024*1024);
    // Las prendas se importan por cliente (solo toca las asignaciones de ese cliente); el resto, como siempre.
    if((body as {kind?:unknown})?.kind==="prendas"){
      const {parsed,preview}=await preparePrendasImport(db,body);
      if(parsed.mode==="apply"&&!preview.rows.length)return response({error:"No hay filas válidas para importar.",...preview},422);
      return response(preview);
    }
    const {parsed,preview}=await prepareImport(db,body);
    if(parsed.mode==="preview")return response(preview);
    if(!preview.rows.length)return response({error:"No hay filas válidas para importar.",...preview},422);
    const {data,error}=await db.rpc("admin_importar_catalogo",{p_catalogo:parsed.kind,p_filas:preview.rows});
    if(error)throw error;
    return response({...data,omitidos:preview.omitidos,errores:preview.errores});
  }catch(error){
    return response({error:error instanceof z.ZodError?error.issues[0].message:error instanceof ImportInputError?error.message:"No se pudo procesar la importación."},400);
  }
}

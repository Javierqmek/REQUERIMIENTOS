import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { esAdminUniformes } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/security/http";
import { ImportInputError, preparePrendasImport } from "@/lib/admin/prendas-import";
import { preparePersonalImport } from "@/lib/admin/personal-import";

const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
// Las dos importaciones comparan contra la base y aplican en una sola transacción (RPC): Prendas por cliente y Personal por DNI.
export async function POST(request:Request){
  try{
    if(!esAdminUniformes((await getCurrentProfile())?.role))return response({error:"No autorizado"},403);
    const db=await createClient();const body=await readJsonBody(request,3*1024*1024);
    const kind=(body as {kind?:unknown})?.kind;
    if(kind==="prendas"){
      const {parsed,preview}=await preparePrendasImport(db,body);
      if(parsed.mode==="apply"&&!preview.rows.length)return response({error:"No hay filas válidas para importar.",...preview},422);
      return response(preview);
    }
    if(kind==="personal"){
      const {parsed,preview}=await preparePersonalImport(db,body);
      if(parsed.mode==="apply"&&!preview.rows.length)return response({error:"No hay filas válidas para importar.",...preview},422);
      return response(preview);
    }
    return response({error:"Catálogo de importación inválido."},400);
  }catch(error){
    return response({error:error instanceof z.ZodError?error.issues[0].message:error instanceof ImportInputError?error.message:"No se pudo procesar la importación."},400);
  }
}

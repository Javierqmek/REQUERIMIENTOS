import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { esAdminUniformes } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { HttpInputError, readJsonBody } from "@/lib/security/http";

const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
const schema=z.object({
  id:z.string().uuid(),
  precio:z.number().finite().min(0).max(9999999999.99),
  codigo_almacen:z.string().trim().min(1).max(80),
}).strict();
// Cuántos requerimientos y líneas cambiarían si el precio o el código de almacén pasan a estos valores.
// Solo lectura: el cambio real y su alcance se aplican al guardar la prenda.
export async function POST(request:Request){
  try{
    const profile=await getCurrentProfile();
    if(!esAdminUniformes(profile?.role))return response({error:"No autorizado"},403);
    const input=schema.parse(await readJsonBody(request,2048));
    const {data,error}=await (await createClient()).rpc("admin_impacto_cambio_ficha",{p_prenda_id:input.id,p_precio:input.precio,p_codigo_almacen:input.codigo_almacen});
    if(error)throw error;
    return response(data);
  }catch(error){
    if(error instanceof z.ZodError)return response({error:error.issues[0].message},400);
    if(error instanceof HttpInputError)return response({error:error.message},error.status);
    const code=(error as {code?:string}).code;
    return response({error:code==="P0002"?"La prenda no existe.":"No se pudo calcular el impacto."},code==="42501"?403:400);
  }
}

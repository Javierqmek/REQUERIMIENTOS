import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/security/http";
import { CATALOG_KINDS, getCatalogRows, parseCatalogQuery } from "@/lib/admin/maintenance";

const stateSchema=z.object({catalogo:z.enum(CATALOG_KINDS),id:z.string().uuid(),activo:z.boolean()}).strict();
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export async function GET(request:Request){try{if((await getCurrentProfile())?.role!=="admin")return response({error:"No autorizado"},403);return response(await getCatalogRows(await createClient(),parseCatalogQuery(new URL(request.url).searchParams)));}catch(error){return response({error:error instanceof z.ZodError?error.issues[0].message:"No se pudo consultar el catálogo."},400);}}
export async function PATCH(request:Request){try{if((await getCurrentProfile())?.role!=="admin")return response({error:"No autorizado"},403);const input=stateSchema.parse(await readJsonBody(request,4096));const {data,error}=await (await createClient()).rpc("admin_actualizar_catalogo_activo",{p_catalogo:input.catalogo,p_id:input.id,p_activo:input.activo});if(error)throw error;return response(data);}catch(error){return response({error:error instanceof z.ZodError?error.issues[0].message:"No se pudo actualizar el registro."},400);}}

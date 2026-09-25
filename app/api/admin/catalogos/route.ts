import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { esAdminUniformes } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/security/http";
import { CATALOG_KINDS, catalogCreateSchema, catalogDeleteSchema, catalogUpdateSchema, getCatalogRows, parseCatalogQuery } from "@/lib/admin/maintenance";
import { HttpInputError } from "@/lib/security/http";

const stateSchema=z.object({catalogo:z.enum(CATALOG_KINDS),id:z.string().uuid(),activo:z.boolean()}).strict();
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
function failure(error:unknown,fallback:string){
  if(error instanceof z.ZodError)return response({error:error.issues[0].message},400);
  if(error instanceof HttpInputError)return response({error:error.message},error.status);
  const issue=error as {code?:string;message?:string};
  if(issue.code==="42501")return response({error:"No autorizado"},403);
  if(issue.code==="P0002")return response({error:issue.message??"Registro no encontrado."},404);
  if(issue.code==="23505"||issue.code==="55000"||issue.code==="23503")return response({error:issue.message??fallback},409);
  return response({error:fallback},400);
}
export async function GET(request:Request){try{if(!esAdminUniformes((await getCurrentProfile())?.role))return response({error:"No autorizado"},403);return response(await getCatalogRows(await createClient(),parseCatalogQuery(new URL(request.url).searchParams)));}catch(error){return response({error:error instanceof z.ZodError?error.issues[0].message:"No se pudo consultar el catálogo."},400);}}
export async function POST(request:Request){try{if(!esAdminUniformes((await getCurrentProfile())?.role))return response({error:"No autorizado"},403);const input=catalogCreateSchema.parse(await readJsonBody(request,16384));const {data,error}=await (await createClient()).rpc("admin_guardar_catalogo",{p_catalogo:input.catalogo,p_id:null,p_valores:input.valores});if(error)throw error;return response(data,201);}catch(error){return failure(error,"No se pudo crear el registro.");}}
export async function PUT(request:Request){try{if(!esAdminUniformes((await getCurrentProfile())?.role))return response({error:"No autorizado"},403);const input=catalogUpdateSchema.parse(await readJsonBody(request,16384));const {data,error}=await (await createClient()).rpc("admin_guardar_catalogo",{p_catalogo:input.catalogo,p_id:input.id,p_valores:input.valores});if(error)throw error;return response(data);}catch(error){return failure(error,"No se pudo guardar el registro.");}}
export async function PATCH(request:Request){try{if(!esAdminUniformes((await getCurrentProfile())?.role))return response({error:"No autorizado"},403);const input=stateSchema.parse(await readJsonBody(request,4096));const {data,error}=await (await createClient()).rpc("admin_actualizar_catalogo_activo",{p_catalogo:input.catalogo,p_id:input.id,p_activo:input.activo});if(error)throw error;return response(data);}catch(error){return failure(error,"No se pudo actualizar el registro.");}}
export async function DELETE(request:Request){try{if(!esAdminUniformes((await getCurrentProfile())?.role))return response({error:"No autorizado"},403);const input=catalogDeleteSchema.parse(await readJsonBody(request,4096));const {data,error}=await (await createClient()).rpc("admin_eliminar_catalogo",{p_catalogo:input.catalogo,p_id:input.id});if(error)throw error;return response(data);}catch(error){return failure(error,"No se pudo eliminar el registro.");}}

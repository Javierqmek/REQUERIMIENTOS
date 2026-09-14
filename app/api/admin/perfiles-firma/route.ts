import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readJsonBody,HttpInputError } from "@/lib/security/http";
export async function POST(request:Request){const profile=await getCurrentProfile();if(profile?.role!=="admin")return NextResponse.json({error:"No autorizado."},{status:403});try{const body=await readJsonBody(request,4096) as {usuario_id?:unknown};if(typeof body.usuario_id!=="string"||!/^[0-9a-f-]{36}$/i.test(body.usuario_id))return NextResponse.json({error:"Usuario inválido."},{status:400});const db=await createClient();const {error}=await db.rpc("admin_desactivar_perfil_firma",{p_usuario_id:body.usuario_id});if(error)throw new Error(error.message);return NextResponse.json({ok:true})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"No se pudo actualizar."},{status:error instanceof HttpInputError?error.status:400})}}

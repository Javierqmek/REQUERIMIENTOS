import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { AdminRequirements } from "@/components/admin-requirements";
import type { Requerimiento } from "@/lib/types";

export default async function AdminPage(){const profile=await getCurrentProfile();if(profile?.role!=="admin")redirect("/inicio");const supabase=await createClient();const {data,error}=await supabase.from("requerimientos").select("id,fecha,referencia_interna,estado,personal(nombre,dni,cargo,cliente,unidad),profiles(nombre,email)").order("fecha",{ascending:false}).limit(50);return <section><header className="mb-6"><p className="text-sm font-bold text-blue-600">ADMINISTRACIÓN</p><h1 className="mt-1 text-2xl font-black">Todos los requerimientos</h1><p className="mt-1 text-slate-500">Consulta, filtra, exporta y actualiza el estado.</p></header>{error?<p className="card p-5 text-red-700">No se pudo cargar la información.</p>:<AdminRequirements initial={(data??[]) as unknown as Requerimiento[]}/>}</section>}

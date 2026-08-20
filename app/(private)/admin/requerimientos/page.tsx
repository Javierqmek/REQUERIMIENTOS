import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { AdminRequirements } from "@/components/admin-requirements";
import type { Requerimiento } from "@/lib/types";

export default async function AdminPage(){const profile=await getCurrentProfile();if(profile?.role!=="admin")redirect("/inicio");const supabase=await createClient();const {data,error}=await supabase.from("requerimientos").select("id,fecha,referencia_interna,estado,personal(nombre,dni,cargo,cliente,unidad),profiles(nombre,email)").order("fecha",{ascending:false}).limit(50);return <section><header className="page-header"><p className="page-eyebrow">Administración</p><h1 className="page-title">Todos los requerimientos</h1><p className="page-description">Consulta, filtra, exporta y actualiza el estado.</p></header>{error?<p className="card p-4 text-[#C53030]">No se pudo cargar la información.</p>:<AdminRequirements initial={(data??[]) as unknown as Requerimiento[]}/>}</section>}

import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminSignatureProfiles } from "@/components/admin-signature-profiles";
export default async function AdminSignatureProfilesPage(){const profile=await getCurrentProfile();if(profile?.role!=="superadmin")redirect("/inicio");const db=await createClient();const {data}=await db.from("perfiles_firma").select("id,usuario_id,version,nombre_mostrado,cargo,activo,created_at,profiles(nombre,email)").order("created_at",{ascending:false}).limit(200);return <section className="mx-auto max-w-5xl"><header className="page-header"><p className="page-eyebrow">Administración</p><h1 className="page-title">Perfiles de firma</h1><p className="page-description">Consulta versiones y desactiva perfiles vigentes. Las evidencias históricas no se modifican.</p></header><AdminSignatureProfiles rows={(data||[]) as never[]}/></section>}

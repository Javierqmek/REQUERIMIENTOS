import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminMaintenance } from "@/components/admin-maintenance";

export default async function MaintenancePage(){const profile=await getCurrentProfile();if(profile?.role!=="admin")redirect("/inicio");const {data}=await (await createClient()).from("clientes").select("id,nombre").order("nombre").limit(500);return <AdminMaintenance clients={data??[]}/>}

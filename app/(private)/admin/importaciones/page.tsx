import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { esAdminUniformes } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { AdminImports } from "@/components/admin-imports";

export default async function ImportsPage(){
  if(!esAdminUniformes((await getCurrentProfile())?.role))redirect("/inicio");
  const {data}=await (await createClient()).from("clientes").select("id,nombre,activo").eq("activo",true).order("nombre").limit(500);
  return <AdminImports clients={data??[]}/>;
}

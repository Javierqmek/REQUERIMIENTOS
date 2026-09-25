import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { esAdminUniformes } from "@/lib/roles";
import { AdminImports } from "@/components/admin-imports";

export default async function ImportsPage(){if(!esAdminUniformes((await getCurrentProfile())?.role))redirect("/inicio");return <AdminImports/>}

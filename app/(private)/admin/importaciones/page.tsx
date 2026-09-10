import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { AdminImports } from "@/components/admin-imports";

export default async function ImportsPage(){if((await getCurrentProfile())?.role!=="admin")redirect("/inicio");return <AdminImports/>}

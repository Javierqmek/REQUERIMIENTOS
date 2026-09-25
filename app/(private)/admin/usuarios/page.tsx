import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UsuariosRolesList } from "@/components/usuarios-roles-list";
import { Alert } from "@/components/ui/alert";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function UsuariosRolesPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "superadmin") redirect("/inicio");
  const db = await createClient();
  const { data, error } = await db.rpc("superadmin_listar_usuarios");

  return <section className="mx-auto max-w-3xl">
    <header className="page-header">
      <p className="page-eyebrow">Administración</p>
      <h1 className="page-title">Usuarios y roles</h1>
      <p className="page-description">Cambia el rol de cualquier usuario sin usar SQL. Solo superadmin puede hacerlo.</p>
    </header>
    {error ? <Alert kind="error">No se pudo cargar la lista de usuarios.</Alert>
      : <UsuariosRolesList usuarios={data || []} propioId={profile.id} />}
  </section>;
}

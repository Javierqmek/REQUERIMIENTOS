import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";

// admin quedó restringido (Requerimientos + Administración): Documentos, incluidas Vacaciones y
// Papeletas, es solo para superadmin/coordinador/gerente. Guard de RUTA además del de navegación
// (app-shell ya oculta el enlace) y del de base de datos (RLS/RPC exigen is_superadmin() en vez
// de is_admin() en todo este dominio) -- entrar por URL directa igual redirige.
export default async function DocumentosLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (profile?.role === "admin") redirect("/inicio");
  return children;
}

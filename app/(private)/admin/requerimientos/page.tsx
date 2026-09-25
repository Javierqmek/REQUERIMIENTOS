import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { esAdminUniformes } from "@/lib/roles";
import { AdminRequirements } from "@/components/admin-requirements";
import { Alert } from "@/components/ui/alert";
import { getAdminOptions, getAdminResults } from "@/lib/admin/data";
import { parseAdminQuery } from "@/lib/admin/filters";
import { AdminSectionNav } from "@/components/admin-section-nav";
import { allowTestRequirementDeletion } from "@/lib/admin/config";

async function loadPage(searchParams: Promise<Record<string, string | string[] | undefined>>) {
  try {
    const raw = await searchParams;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) if (typeof value === "string") params.set(key, value);
    const { filters, page } = parseAdminQuery(params);
    const db = await createClient();
    const [options, initial] = await Promise.all([getAdminOptions(db), getAdminResults(db, filters, page)]);
    if (page > 1 && !initial.rows.length) {
      params.set("page", String(Math.max(1, Math.ceil(initial.total / initial.pageSize))));
      // No llamar redirect dentro del catch: el render siguiente conserva el total.
      const corrected = await getAdminResults(db, filters, Number(params.get("page")));
      return { options, initial: corrected, initialFilters: filters };
    }
    return { options, initial, initialFilters: filters };
  } catch {
    return null;
  }
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await getCurrentProfile();
  if (!esAdminUniformes(profile?.role)) redirect("/inicio");
  const props = await loadPage(searchParams);
  if (!props) return <section><header className="page-header"><h1 className="page-title">Administración</h1></header><Alert kind="error">No se pudo cargar Administración. Revisa los filtros y comprueba que la migración administrativa esté aplicada.</Alert><a className="btn btn-secondary mt-3" href="/admin/requerimientos">Reintentar sin filtros</a></section>;
  return <><AdminSectionNav/><AdminRequirements {...props} allowDeletion={allowTestRequirementDeletion()}/></>;
}

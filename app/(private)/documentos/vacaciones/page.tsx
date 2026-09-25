import Link from "next/link";
import { redirect } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { DocumentSectionNav } from "@/components/document-section-nav";
import { VacationPapeletaList } from "@/components/vacation-papeleta-list";
import { VacationFilters } from "@/components/vacation-filters";
import { Alert } from "@/components/ui/alert";
import { getPapeletaList, getPapeletaListOptions } from "@/lib/vacations/list-data";
import { parsePapeletaQuery } from "@/lib/vacations/list-filters";

// No revalidar/cachear esta página: debe reflejar de inmediato cualquier papeleta recién
// registrada, observada o corregida, sin depender de un router.refresh() del cliente.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function VacationRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/documentos");
  const db = await createClient();
  const params = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => v == null ? [] : [[k, Array.isArray(v) ? v[0] : v] as [string, string]]));
  const { filters, page } = parsePapeletaQuery(params);

  let listResult, listError: unknown = null, options;
  try {
    [listResult, options] = await Promise.all([getPapeletaList(db, filters, page), getPapeletaListOptions(db)]);
  } catch (error) {
    listError = error;
    options = { clientes: [], unidades: [], provincias: [], coordinadores: [] };
  }
  const totalPages = listResult ? Math.max(1, Math.ceil(listResult.total / listResult.pageSize)) : 1;

  return <section className="mx-auto max-w-5xl">
    <DocumentSectionNav role={profile.role} />
    <header className="page-header flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="page-eyebrow">Gestión documental · Vacaciones</p>
        <h1 className="page-title">{profile.role === "coordinador" ? "Mis papeletas de vacaciones" : "Papeletas de vacaciones"}</h1>
        <p className="page-description">Registro de vacaciones físicas y venta de vacaciones con su papeleta escaneada.</p>
      </div>
      {profile.role === "coordinador" && <Link href="/documentos/vacaciones/nueva" className="btn btn-primary"><FilePlus2 size={17} />Registrar papeleta</Link>}
    </header>

    <VacationFilters initial={filters} options={options} showCoordinador={profile.role !== "coordinador"} />

    {/* Nunca se oculta un error de consulta como si fuera "sin registros": una lista vacía por
        falla silenciosa es indistinguible de "no hay papeletas" para quien la mira. */}
    {listError || !listResult ? <Alert kind="error">No pudimos consultar las papeletas de vacaciones. Intenta recargar la página.</Alert> : <>
      <p className="mb-2.5 text-xs font-medium text-[#607089]">{listResult.total} resultado{listResult.total === 1 ? "" : "s"}</p>
      <VacationPapeletaList rows={listResult.rows} role={profile.role as "coordinador" | "superadmin" | "gerente"} />
      {listResult.total > 0 && <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Paginación">
        <Link aria-disabled={page <= 1} className={`btn btn-secondary px-3 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
          href={`?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page - 1) })}`}>Anterior</Link>
        <span className="text-xs font-medium text-[#607089]">Página {page} de {totalPages}</span>
        <Link aria-disabled={page >= totalPages} className={`btn btn-secondary px-3 ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
          href={`?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page + 1) })}`}>Siguiente</Link>
      </nav>}
    </>}
  </section>;
}

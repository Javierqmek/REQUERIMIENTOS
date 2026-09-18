import Link from "next/link";
import { redirect } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { DocumentSectionNav } from "@/components/document-section-nav";
import { VacationRequestList } from "@/components/vacation-request-list";
import { Alert } from "@/components/ui/alert";
import { PAPELETA_LIST_SELECT, type PapeletaRow } from "@/lib/vacations/types";

// No revalidar/cachear esta página: debe reflejar de inmediato cualquier papeleta recién
// registrada, observada o corregida, sin depender de un router.refresh() del cliente.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function VacationRequestsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/documentos");
  const db = await createClient();
  let query = db.from("papeletas_vacaciones").select(PAPELETA_LIST_SELECT).order("created_at", { ascending: false }).limit(100);
  // admin y gerente revisan de todos; coordinador solo ve las propias (ver RLS en la migración).
  if (profile.role === "coordinador") query = query.eq("coordinador_id", profile.id);
  const { data, error } = await query;

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
    {/* Nunca se oculta un error de consulta como si fuera "sin registros": una lista vacía por
        falla silenciosa es indistinguible de "no hay papeletas" para quien la mira. */}
    {error ? <Alert kind="error">No pudimos consultar las papeletas de vacaciones. Intenta recargar la página.</Alert>
      : <VacationRequestList rows={(data || []) as unknown as PapeletaRow[]} showCoordinador={profile.role !== "coordinador"} />}
  </section>;
}

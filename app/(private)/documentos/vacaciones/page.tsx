import Link from "next/link";
import { redirect } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { DocumentSectionNav } from "@/components/document-section-nav";
import { VacationRequestList } from "@/components/vacation-request-list";
import { PAPELETA_LIST_SELECT, type PapeletaRow } from "@/lib/vacations/types";

export default async function VacationRequestsPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "gerente") redirect("/documentos");
  const db = await createClient();
  let query = db.from("papeletas_vacaciones").select(PAPELETA_LIST_SELECT).order("created_at", { ascending: false }).limit(100);
  if (profile.role === "coordinador") query = query.eq("coordinador_id", profile.id);
  const { data } = await query;

  return <section className="mx-auto max-w-5xl">
    <DocumentSectionNav role={profile.role} />
    <header className="page-header flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="page-eyebrow">Gestión documental · Vacaciones</p>
        <h1 className="page-title">{profile.role === "admin" ? "Papeletas de vacaciones" : "Mis papeletas de vacaciones"}</h1>
        <p className="page-description">Registro de vacaciones físicas y venta de vacaciones con su papeleta escaneada.</p>
      </div>
      {profile.role === "coordinador" && <Link href="/documentos/vacaciones/nueva" className="btn btn-primary"><FilePlus2 size={17} />Registrar papeleta</Link>}
    </header>
    <VacationRequestList rows={(data || []) as unknown as PapeletaRow[]} showCoordinador={profile.role === "admin"} />
  </section>;
}

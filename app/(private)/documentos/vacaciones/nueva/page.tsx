import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { DocumentSectionNav } from "@/components/document-section-nav";
import { VacationRequestForm } from "@/components/vacation-request-form";

export default async function NewVacationRequestPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "coordinador") redirect("/documentos/vacaciones");
  return <section className="mx-auto max-w-3xl">
    <DocumentSectionNav role={profile.role} />
    <header className="page-header">
      <p className="page-eyebrow">Gestión documental · Vacaciones</p>
      <h1 className="page-title">Registrar papeleta de vacaciones</h1>
      <p className="page-description">Completa cada sección. El colaborador, el reemplazo, el cliente y la unidad se validan contra los catálogos existentes.</p>
    </header>
    <VacationRequestForm coordinadorNombre={profile.nombre} />
  </section>;
}

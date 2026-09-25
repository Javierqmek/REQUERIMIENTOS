import { redirect } from "next/navigation";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";
import { NuevaCapacitacionForm } from "@/components/nueva-capacitacion-form";

export default async function NuevaCapacitacionPage() {
  const profile = await getCurrentCapacitacionProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "superadmin" && profile.role !== "capacitador") redirect("/capacitaciones");

  return <section>
    <header className="page-header">
      <p className="page-eyebrow">Capacitaciones</p>
      <h1 className="page-title">Nueva capacitación</h1>
      <p className="page-description">Se crea en borrador. Podrás subir el video, agregar preguntas y asignarla antes de publicarla.</p>
    </header>
    <NuevaCapacitacionForm />
  </section>;
}

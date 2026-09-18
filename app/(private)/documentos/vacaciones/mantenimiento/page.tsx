import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { DocumentSectionNav } from "@/components/document-section-nav";
import { VacationTestMaintenance } from "@/components/vacation-test-maintenance";
import { VacationStoragePendingCleanup } from "@/components/vacation-storage-pending-cleanup";
import { allowTestPapeletaDeletion } from "@/lib/vacations/config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Solo admin. Nunca se listan papeletas por nombre ni antigüedad: SOLO las que ya fueron
// marcadas explícitamente es_prueba=true desde el detalle (ver VacationTestToggle). A partir de
// esta migración, el ESTADO ya no excluye nada de este listado: una papeleta de prueba puede
// eliminarse incluso si llegó a FIRMADO o es una CONFORME histórica -- la única protección real
// es es_prueba=true (documentos reales, es_prueba=false, nunca aparecen aquí ni son borrables).
export default async function VacationTestMaintenancePage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/documentos/vacaciones");
  const db = await createClient();
  const [{ data }, { data: pending }] = await Promise.all([
    db.from("papeletas_vacaciones").select("id,colaborador_nombre,colaborador_codigo,estado,created_at")
      .eq("es_prueba", true).order("created_at", { ascending: false }).limit(200),
    db.rpc("admin_listar_borrados_pendientes"),
  ]);

  return <section className="mx-auto max-w-3xl">
    <DocumentSectionNav role={profile.role} />
    <header className="page-header">
      <p className="page-eyebrow">Gestión documental · Vacaciones</p>
      <h1 className="page-title">Mantenimiento de pruebas</h1>
      <p className="page-description">Elimina físicamente papeletas de prueba marcadas explícitamente por un administrador, para no consumir espacio de Storage. Nunca elimina documentos reales (es_prueba=false), sin importar su estado.</p>
    </header>
    {/* PostgreSQL y Storage no comparten transacción: si Storage falló al borrar algún PDF tras
        un borrado de prueba, la ruta queda aquí -- nunca se pierde en silencio. */}
    <VacationStoragePendingCleanup pending={(pending || []) as { archivo_path: string; intentos: number; ultimo_error: string | null }[]} />
    <div className="section-card">
      <VacationTestMaintenance rows={(data || []) as { id: string; colaborador_nombre: string; colaborador_codigo: string; estado: string; created_at: string }[]} allowed={allowTestPapeletaDeletion()} />
    </div>
  </section>;
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { DocumentSectionNav } from "@/components/document-section-nav";
import { PapeletaEstadoBadge } from "@/components/papeleta-estado-badge";
import { VacationReviewActions } from "@/components/vacation-review-actions";
import { VacationCorrectionForm } from "@/components/vacation-correction-form";
import { VacationSignWorkspace } from "@/components/vacation-sign-workspace";
import { VacationPdfViewer } from "@/components/vacation-pdf-viewer";
import { VacationTestToggle } from "@/components/vacation-test-toggle";
import { Alert } from "@/components/ui/alert";
import { canCorrect, canReview, canSign } from "@/lib/vacations/review";
import { PAPELETA_DETAIL_SELECT, papeletaVersionTipoLabel, type PapeletaDetailRow, type PapeletaEventoRow, type PapeletaVersionRow } from "@/lib/vacations/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00Z`));
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
const eventLabel: Record<string, string> = {
  REGISTRADO: "Registrado", OBSERVADO: "Observado", CORREGIDO: "Corregido", FIRMADO: "Firmado", CONFORME: "Marcado conforme (histórico)",
};
// El "documento actual" a mostrar en el visor es siempre la versión vigente: si nunca se
// corrigió, el original; si se corrigió, la última corrección; si ya se firmó, la firmada.
// version_actual en la fila principal YA es exactamente ese puntero, así que el visor principal
// no necesita ?version= -- solo el historial lo usa para previsualizar versiones anteriores.
const documentoActualLabel: Record<string, string> = {
  ORIGINAL: "Documento actual: versión original (sin correcciones)",
  CORRECCION: "Documento actual: última corrección",
  FIRMADO: "Documento actual: versión firmada",
};

export default async function VacationRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) notFound();
  const db = await createClient();
  const [{ data }, { data: versionRows }, { data: eventRows }, { data: perfilRow }] = await Promise.all([
    db.from("papeletas_vacaciones").select(PAPELETA_DETAIL_SELECT).eq("id", id).maybeSingle(),
    db.from("papeletas_vacaciones_versiones").select("id,version,tipo,colaborador_nombre,fisicas_fecha_inicio,fisicas_fecha_fin,fisicas_dias,tiene_venta,venta_fecha_inicio,venta_fecha_fin,venta_dias,archivo_nombre,archivo_path,created_at").eq("papeleta_id", id).order("version", { ascending: false }),
    db.from("papeletas_vacaciones_eventos").select("id,accion,estado_anterior,estado_nuevo,version,motivo,created_at,profiles(nombre)").eq("papeleta_id", id).order("created_at", { ascending: false }),
    profile.role === "gerente" ? db.from("perfiles_firma").select("id").eq("usuario_id", profile.id).eq("activo", true).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!data) notFound();
  const row = data as unknown as PapeletaDetailRow;
  const versions = (versionRows || []) as unknown as PapeletaVersionRow[];
  const events = (eventRows || []) as unknown as PapeletaEventoRow[];
  const vigente = versions.find(v => v.version === row.version_actual) ?? versions[0];

  const showReview = canReview(profile.role, row.coordinador_id, profile.id) && row.estado === "REGISTRADO";
  const showCorrection = canCorrect(profile.role, row.coordinador_id, profile.id, row.estado);
  const showSign = canSign(profile.role, row.coordinador_id, profile.id, row.estado);

  const facts: [string, string][] = [
    ["Colaborador", `${row.colaborador_nombre} (${row.colaborador_codigo})`],
    ["Reemplazo", row.reemplazo?.nombre ?? "—"],
    ["Vacaciones físicas", `${formatDate(row.fisicas_fecha_inicio)} → ${formatDate(row.fisicas_fecha_fin)} (${row.fisicas_dias} días)`],
    ["Venta de vacaciones", row.tiene_venta && row.venta_fecha_inicio && row.venta_fecha_fin ? `${formatDate(row.venta_fecha_inicio)} → ${formatDate(row.venta_fecha_fin)} (${row.venta_dias} días)` : "No"],
    ["Provincia", row.provincias?.nombre ?? "—"],
    ["Cliente", row.clientes?.nombre ?? "—"],
    ["Unidad", row.unidades?.nombre ?? "—"],
    ["Coordinador", row.profiles?.nombre ?? "—"],
    ["Registrado", formatDateTime(row.created_at)],
    ["Versión actual", String(row.version_actual)],
    ...(row.estado === "FIRMADO" ? [
      ["Firmado por", row.firmante?.nombre ?? "—"] as [string, string],
      ["Fecha de firma", row.firmado_at ? formatDateTime(row.firmado_at) : "—"] as [string, string],
    ] : []),
  ];

  return <section className="mx-auto max-w-5xl">
    <DocumentSectionNav role={profile.role} />
    <Link href="/documentos/vacaciones" className="btn btn-ghost mb-3 -ml-3"><ArrowLeft size={16} />Volver al listado</Link>
    <header className="page-header flex flex-wrap items-center justify-between gap-3">
      <div><p className="page-eyebrow">Gestión documental · Vacaciones</p><h1 className="page-title">Papeleta de vacaciones</h1></div>
      <PapeletaEstadoBadge estado={row.estado} />
    </header>

    {row.estado === "OBSERVADO" && row.motivo_observacion && <div className="mb-4"><Alert kind="warning"><strong className="block font-semibold">Motivo de observación</strong>{row.motivo_observacion}</Alert></div>}
    {row.es_prueba && <div className="mb-4"><Alert kind="warning"><strong className="block font-semibold">Papeleta de prueba</strong>Marcada explícitamente como prueba por un administrador; no representa un registro real.</Alert></div>}

    <div className="section-card mb-4">
      <h2 className="section-title">Datos de la papeleta</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
        {facts.map(([label, value]) => <div key={label} className="min-w-0 border-t border-[#E8EDF4] py-2">
          <dt className="text-xs font-medium text-[#607089]">{label}</dt><dd className="mt-0.5 break-words text-sm font-medium text-[#172033]">{value}</dd>
        </div>)}
      </dl>
    </div>

    {/* Firmable por el gerente: el visor de solo lectura se reemplaza por el editor interactivo
        (mismo motor de render/arrastre que Documentos), que muestra EXACTAMENTE la versión
        vigente que se va a firmar. Para todos los demás casos, el visor de solo lectura basta. */}
    {showSign
      ? <div className="mb-4"><VacationSignWorkspace papeletaId={row.id} versionActual={row.version_actual} archivoSha256={row.archivo_sha256} profileReady={Boolean(perfilRow)} /></div>
      : <div className="mb-4">
          {vigente && <p className="mb-2 text-xs font-medium text-[#607089]">{documentoActualLabel[vigente.tipo]} · {vigente.archivo_nombre}</p>}
          <VacationPdfViewer papeletaId={row.id} />
        </div>}

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <div className="section-card">
          <h2 className="section-title flex items-center gap-2"><History size={17} />Historial de versiones</h2>
          <div className="mt-3 divide-y divide-[#E8EDF4] border-y border-[#E8EDF4]">
            {versions.map(v => <div key={v.id} className="grid gap-1 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm font-semibold text-[#172033]">Versión {v.version} · {papeletaVersionTipoLabel[v.tipo]}</strong>
                <span className="text-xs text-[#607089]">{formatDateTime(v.created_at)}</span>
                {v.version === row.version_actual && <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">Vigente</span>}
              </div>
              <p className="text-xs text-[#607089]">Documento: {v.archivo_nombre}</p>
              <a target="_blank" rel="noreferrer" href={`/api/documentos/vacaciones/${row.id}/archivo?version=${v.version}`} className="text-xs font-medium text-[#174EA6] underline underline-offset-2">Ver esta versión</a>
            </div>)}
          </div>
        </div>

        <div className="section-card">
          <h2 className="section-title">Trazabilidad</h2>
          <div className="mt-3 divide-y divide-[#E8EDF4] border-y border-[#E8EDF4]">
            {events.map(e => <div key={e.id} className="grid gap-1 py-3">
              <div className="flex flex-wrap items-center gap-2"><strong className="text-sm font-semibold text-[#172033]">{eventLabel[e.accion] ?? e.accion}</strong><span className="text-xs text-[#607089]">{formatDateTime(e.created_at)} · {e.profiles?.nombre ?? "—"}</span></div>
              {e.motivo && <p className="text-xs text-[#607089]">Motivo: {e.motivo}</p>}
            </div>)}
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        {showReview && <VacationReviewActions papeletaId={row.id} />}
        {showCorrection && <div className="space-y-4">
          <div className="section-card"><h2 className="section-title">Corregir papeleta observada</h2><p className="mt-1 text-sm text-[#607089]">Se creará una versión nueva; la anterior se conserva en el historial.</p></div>
          <VacationCorrectionForm papeleta={row} />
        </div>}
        {profile.role === "superadmin" && <VacationTestToggle papeletaId={row.id} esPrueba={row.es_prueba} firmado={row.estado === "FIRMADO"} />}
      </aside>
    </div>
  </section>;
}

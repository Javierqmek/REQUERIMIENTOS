import { redirect } from "next/navigation";
import Link from "next/link";
import { CalendarClock, CheckCircle2, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";
import type { CapacitacionAgenteRow } from "@/lib/capacitaciones/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "medium" }).format(new Date(value));
}

export default async function CapacitacionesAgentePage() {
  const profile = await getCurrentCapacitacionProfile();
  if (!profile) redirect("/login");
  if (profile.role === "superadmin" || profile.role === "capacitador") redirect("/capacitaciones/gestion");
  const db = await createClient();
  const { data, error } = await db.rpc("listar_capacitaciones_agente");
  if (error) console.error("[capacitaciones] listar_capacitaciones_agente falló:", error.message);
  const rows = (data || []) as CapacitacionAgenteRow[];
  const pendientes = rows.filter(r => !r.completada);
  const completadas = rows.filter(r => r.completada);

  return <section>
    <header className="page-header">
      <p className="page-eyebrow">Capacitaciones</p>
      <h1 className="page-title">Hola, {profile.nombre.split(" ")[0]}</h1>
      <p className="page-description">Tienes {pendientes.length} pendiente{pendientes.length === 1 ? "" : "s"} y {completadas.length} completada{completadas.length === 1 ? "" : "s"}.</p>
    </header>
    {error ? <div className="card px-5 py-8 text-center text-sm text-[#C53030]">No pudimos cargar tus capacitaciones. Intenta recargar la página.</div> : <>
      {pendientes.length > 0 && <><h2 className="mb-2 mt-2 text-xs font-semibold uppercase tracking-wide text-[#607089]">Pendientes</h2>
        <div className="grid gap-2.5">{pendientes.map(row => <CapacitacionCard key={row.id} row={row} />)}</div></>}
      {completadas.length > 0 && <><h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-[#607089]">Completadas</h2>
        <div className="grid gap-2.5">{completadas.map(row => <CapacitacionCard key={row.id} row={row} />)}</div></>}
      {!rows.length && <div className="card px-5 py-8 text-center"><FileText className="mx-auto text-[#8794A8]" size={28} /><p className="mt-3 text-sm font-medium text-[#45556D]">No tienes capacitaciones asignadas por ahora.</p></div>}
    </>}
  </section>;
}

function CapacitacionCard({ row }: { row: CapacitacionAgenteRow }) {
  return <Link href={`/capacitaciones/${row.id}`} className="card grid gap-2 p-4 hover:border-[#B9C9DF]">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="text-sm font-semibold text-[#0B1F3A]">{row.titulo}</strong>
      {row.completada
        ? <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800"><CheckCircle2 size={13} />Aprobado{row.ultima_nota != null ? ` (nota ${row.ultima_nota}/20)` : ""}</span>
        : <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700">{row.video_completo ? "Examen pendiente" : "Nuevo"}</span>}
    </div>
    <p className="text-xs text-[#607089]">{row.porcentaje_minimo_visto}% mínimo del video{row.fecha_vencimiento ? <> · <CalendarClock className="inline" size={12} /> Vence el {formatDate(row.fecha_vencimiento)}</> : ""}</p>
  </Link>;
}

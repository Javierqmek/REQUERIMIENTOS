import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";
import type { CapacitacionRow, ReporteAgenteFila } from "@/lib/capacitaciones/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ReporteCapacitacionPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentCapacitacionProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin" && profile.role !== "capacitador") redirect("/capacitaciones");
  const { id } = await params;
  const db = await createClient();

  const { data: capacitacion } = await db.from("capacitaciones").select("id,titulo,capacitador_id").eq("id", id).maybeSingle();
  if (!capacitacion) notFound();
  if (profile.role === "capacitador" && (capacitacion as CapacitacionRow).capacitador_id !== profile.id) redirect("/capacitaciones/gestion");

  const { data, error } = await db.rpc("reporte_capacitacion", { p_capacitacion_id: id });
  const filas = (data || []) as ReporteAgenteFila[];

  return <section>
    <header className="page-header">
      <Link href={`/capacitaciones/gestion/${id}`} className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#607089] hover:text-[#0B1F3A]"><ArrowLeft size={14} />Volver a la capacitación</Link>
      <p className="page-eyebrow">Capacitaciones</p>
      <h1 className="page-title">Reporte — {capacitacion.titulo}</h1>
      <p className="page-description">Avance de video y resultados del examen por agente asignado.</p>
    </header>
    {error ? <div className="card px-5 py-8 text-center text-sm text-[#C53030]">No pudimos cargar el reporte.</div> : filas.length === 0
      ? <div className="card px-5 py-8 text-center text-sm text-[#45556D]">Todavía no hay agentes asignados o con avance registrado.</div>
      : <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-[#E3E9F1] text-xs font-semibold uppercase tracking-wide text-[#8794A8]">
              <tr><th className="px-4 py-3">Agente</th><th className="px-4 py-3">Código</th><th className="px-4 py-3">% video visto</th><th className="px-4 py-3">Video completo</th><th className="px-4 py-3">Intentos</th><th className="px-4 py-3">Mejor nota</th><th className="px-4 py-3">Resultado</th></tr>
            </thead>
            <tbody>
              {filas.map(f => <tr key={f.agente_personal_id} className="border-b border-[#EEF2F7] last:border-0">
                <td className="px-4 py-3 font-medium text-[#0B1F3A]">{f.nombre}</td>
                <td className="px-4 py-3 text-[#607089]">{f.codigo_personal}</td>
                <td className="px-4 py-3">{f.porcentaje_visto}%</td>
                <td className="px-4 py-3">{f.video_completo ? "Sí" : "No"}</td>
                <td className="px-4 py-3">{f.intentos}</td>
                <td className="px-4 py-3">{f.mejor_nota ?? "—"}</td>
                <td className="px-4 py-3">{f.aprobado === null ? <span className="text-[#8794A8]">Sin rendir</span> : f.aprobado ? <span className="font-semibold text-emerald-700">Aprobado</span> : <span className="font-semibold text-[#C53030]">Desaprobado</span>}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
  </section>;
}

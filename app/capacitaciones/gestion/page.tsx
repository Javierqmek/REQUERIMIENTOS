import { redirect } from "next/navigation";
import Link from "next/link";
import { FilePlus2, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";
import type { CapacitacionRow } from "@/lib/capacitaciones/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const estadoLabel: Record<string, string> = { BORRADOR: "Borrador", PUBLICADA: "Publicada", ARCHIVADA: "Archivada" };
const estadoStyle: Record<string, string> = {
  BORRADOR: "border-slate-200 bg-slate-50 text-slate-700",
  PUBLICADA: "border-emerald-200 bg-emerald-50 text-emerald-800",
  ARCHIVADA: "border-slate-300 bg-slate-100 text-slate-500",
};

export default async function GestionCapacitacionesPage() {
  const profile = await getCurrentCapacitacionProfile();
  if (!profile) redirect("/login");
  if (profile.role === "agente") redirect("/capacitaciones");
  const db = await createClient();
  const { data, error } = await db.from("capacitaciones").select("*").order("created_at", { ascending: false }).limit(100);
  const rows = (data || []) as CapacitacionRow[];

  return <section>
    <header className="page-header flex flex-wrap items-end justify-between gap-3">
      <div><p className="page-eyebrow">Capacitaciones</p><h1 className="page-title">Gestión</h1><p className="page-description">Crea, publica y revisa el avance de cada capacitación.</p></div>
      <Link href="/capacitaciones/gestion/nueva" className="btn btn-primary"><FilePlus2 size={17} />Nueva capacitación</Link>
    </header>
    {error ? <div className="card px-5 py-8 text-center text-sm text-[#C53030]">No pudimos cargar las capacitaciones.</div> : rows.length === 0
      ? <div className="card px-5 py-8 text-center"><FileText className="mx-auto text-[#8794A8]" size={28} /><p className="mt-3 text-sm font-medium text-[#45556D]">Todavía no hay capacitaciones.</p></div>
      : <div className="grid gap-2.5">{rows.map(row => <Link key={row.id} href={`/capacitaciones/gestion/${row.id}`} className="card grid gap-1.5 p-4 hover:border-[#B9C9DF]">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm font-semibold text-[#0B1F3A]">{row.titulo}</strong><span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-semibold ${estadoStyle[row.estado]}`}>{estadoLabel[row.estado]}</span></div>
          <p className="text-xs text-[#607089]">{new Intl.DateTimeFormat("es-PE", { dateStyle: "medium" }).format(new Date(row.created_at))} · Nota mínima {row.nota_minima}/20 · {row.porcentaje_minimo_visto}% del video</p>
        </Link>)}</div>}
  </section>;
}

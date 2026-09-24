import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";
import { CapacitacionVideoPlayer } from "@/components/capacitacion-video-player";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CapacitacionDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentCapacitacionProfile();
  if (!profile) redirect("/login");
  const db = await createClient();
  const [{ data: cap }, { data: progreso }] = await Promise.all([
    db.from("capacitaciones").select("id,titulo,descripcion,material_pdf_path,porcentaje_minimo_visto,nota_minima").eq("id", id).maybeSingle(),
    db.from("capacitacion_progreso").select("porcentaje_visto,video_completo").eq("capacitacion_id", id).eq("agente_id", profile.id).maybeSingle(),
  ]);
  if (!cap) notFound();

  return <section className="mx-auto max-w-2xl">
    <Link href="/capacitaciones" className="btn btn-ghost mb-3 -ml-3"><ArrowLeft size={16} />Volver</Link>
    <header className="page-header">
      <p className="page-eyebrow">Capacitación</p>
      <h1 className="page-title">{cap.titulo}</h1>
      {cap.descripcion && <p className="page-description">{cap.descripcion}</p>}
    </header>
    <CapacitacionVideoPlayer
      capacitacionId={cap.id}
      tienePdf={Boolean(cap.material_pdf_path)}
      porcentajeInicial={progreso?.porcentaje_visto ?? 0}
      videoCompleto={progreso?.video_completo ?? false}
      porcentajeMinimo={cap.porcentaje_minimo_visto}
    />
  </section>;
}

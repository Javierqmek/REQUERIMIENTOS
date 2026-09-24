import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";
import { ExamenForm } from "@/components/examen-form";
import { Alert } from "@/components/ui/alert";
import type { ExamenIniciado } from "@/lib/capacitaciones/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ExamenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getCurrentCapacitacionProfile();
  if (!profile) redirect("/login");
  const db = await createClient();
  const { data: cap } = await db.from("capacitaciones").select("titulo").eq("id", id).maybeSingle();
  if (!cap) notFound();
  const { data, error } = await db.rpc("iniciar_examen", { p_capacitacion_id: id });

  return <section className="mx-auto max-w-2xl">
    <Link href={`/capacitaciones/${id}`} className="btn btn-ghost mb-3 -ml-3"><ArrowLeft size={16} />Volver</Link>
    <header className="page-header">
      <p className="page-eyebrow">Examen</p>
      <h1 className="page-title">{cap.titulo}</h1>
    </header>
    {error ? <Alert kind="error">{error.message.includes("mínimo") ? error.message : "No se pudo cargar el examen. Verifica que hayas visto el video."}</Alert>
      : <ExamenForm capacitacionId={id} preguntas={(data as ExamenIniciado).preguntas} />}
  </section>;
}

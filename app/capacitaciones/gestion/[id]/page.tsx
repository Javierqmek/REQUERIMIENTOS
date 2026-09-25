import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";
import { CapacitacionEditor } from "@/components/capacitacion-editor";
import type { CapacitacionRow, ExamenPreguntaAdmin } from "@/lib/capacitaciones/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CapacitacionEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentCapacitacionProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "superadmin" && profile.role !== "capacitador") redirect("/capacitaciones");
  const { id } = await params;
  const db = await createClient();

  const [{ data: capacitacion }, { data: preguntas }, { data: asignaciones }, { data: clientes }] = await Promise.all([
    db.from("capacitaciones").select("*").eq("id", id).maybeSingle(),
    db.from("examen_preguntas").select("id,enunciado,orden,examen_opciones(id,texto,es_correcta,orden)").eq("capacitacion_id", id).order("orden"),
    db.from("capacitacion_asignaciones").select("id,cliente_id").eq("capacitacion_id", id),
    db.from("clientes").select("id,nombre,activo").order("nombre").limit(500),
  ]);
  if (!capacitacion) notFound();
  if (profile.role === "capacitador" && (capacitacion as CapacitacionRow).capacitador_id !== profile.id) redirect("/capacitaciones/gestion");

  const preguntasOrdenadas = ((preguntas || []) as ExamenPreguntaAdmin[]).map(p => ({
    ...p, examen_opciones: [...p.examen_opciones].sort((a, b) => a.orden - b.orden),
  }));

  return <CapacitacionEditor
    capacitacion={capacitacion as CapacitacionRow}
    preguntas={preguntasOrdenadas}
    asignaciones={asignaciones || []}
    clientes={clientes || []}
  />;
}

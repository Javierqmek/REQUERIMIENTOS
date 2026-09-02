import { REQUIREMENT_SELECT } from "@/lib/requerimientos";
import { createClient } from "@/lib/supabase/server";
import { RequirementsList } from "@/components/requirements-list";
import type { Requerimiento } from "@/lib/types";

export default async function RequerimientosPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("requerimientos").select(REQUIREMENT_SELECT).order("fecha", { ascending:false }).limit(100);
  return <section className="mx-auto max-w-5xl"><header className="page-header"><h1 className="page-title">Mis requerimientos</h1><p className="page-description">Consulta el historial de solicitudes registradas.</p></header>{error ? <p className="card p-4 text-[#C53030]">No se pudo cargar la información.</p> : <RequirementsList rows={(data ?? []) as unknown as Requerimiento[]}/>}</section>;
}

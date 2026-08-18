import { createClient } from "@/lib/supabase/server";
import { RequirementsList } from "@/components/requirements-list";
import type { Requerimiento } from "@/lib/types";

export default async function RequerimientosPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("requerimientos").select("id,fecha,referencia_interna,estado,personal(nombre,dni,cargo,cliente,unidad)").order("fecha", { ascending:false }).limit(100);
  return <section><header className="mb-6"><h1 className="text-2xl font-black">Mis requerimientos</h1><p className="mt-1 text-slate-500">Consulta el historial de solicitudes registradas.</p></header>{error ? <p className="card p-5 text-red-700">No se pudo cargar la información.</p> : <RequirementsList rows={(data ?? []) as unknown as Requerimiento[]}/>}</section>;
}

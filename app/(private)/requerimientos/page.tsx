import { createClient } from "@/lib/supabase/server";
import { RequirementsList } from "@/components/requirements-list";
import { getRequirementList, getRequirementListOptions } from "@/lib/requirements/list-data";
import { parseRequirementQuery } from "@/lib/requirements/list-filters";

export default async function RequerimientosPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const raw=await searchParams;const params=new URLSearchParams();for(const [key,value] of Object.entries(raw))if(typeof value==="string")params.set(key,value);
  const {filters,page}=parseRequirementQuery(params);
  const supabase = await createClient();
  let data;
  try {
    data=await Promise.all([getRequirementList(supabase,filters,page),getRequirementListOptions(supabase)]);
  } catch {
    return <section className="mx-auto max-w-5xl"><header className="page-header"><h1 className="page-title">Mis requerimientos</h1></header><p className="card p-4 text-[#C53030]">No se pudo cargar la información. Verifica que la migración de filtros esté aplicada.</p></section>;
  }
  const [initial,options]=data;
  return <section className="mx-auto max-w-5xl"><header className="page-header"><h1 className="page-title">Mis requerimientos</h1><p className="page-description">Consulta y filtra tus solicitudes registradas.</p></header><RequirementsList initial={initial} options={options} initialFilters={filters}/></section>;
}

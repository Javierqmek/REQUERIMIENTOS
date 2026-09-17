import type { SupabaseClient } from "@supabase/supabase-js";
import { requirementRpcArgs, type RequirementFilters } from "./list-filters";
import type { Requerimiento } from "@/lib/types";

export const REQUIREMENTS_PAGE_SIZE=50;
export type RequirementListResult={rows:Requerimiento[];total:number;page:number;pageSize:number};
export type RequirementListOptions={clientes:{id:string;nombre:string}[];unidades:{id:string;cliente_id:string;nombre:string}[]};
export async function getRequirementList(db:SupabaseClient,filters:RequirementFilters,page=1,signal?:AbortSignal):Promise<RequirementListResult>{
  let request=db.rpc("listar_requerimientos_filtrados",{...requirementRpcArgs(filters),p_limite:REQUIREMENTS_PAGE_SIZE,p_offset:(page-1)*REQUIREMENTS_PAGE_SIZE});
  if(signal)request=request.abortSignal(signal);const {data,error}=await request;if(error)throw new Error("No se pudieron cargar los requerimientos.");
  return {...data,page,pageSize:REQUIREMENTS_PAGE_SIZE} as RequirementListResult;
}
export async function getRequirementListOptions(db:SupabaseClient):Promise<RequirementListOptions>{
  const {data,error}=await db.rpc("opciones_requerimientos_propios");if(error)throw new Error("No se pudieron cargar los filtros.");return data as RequirementListOptions;
}

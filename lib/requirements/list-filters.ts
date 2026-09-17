import { z } from "zod";
import { ADMIN_STATES } from "@/lib/admin/filters";

export const REQUIREMENT_GENDERS = ["HOMBRE", "MUJER", "AMBOS"] as const;
export type RequirementGenderFilter = typeof REQUIREMENT_GENDERS[number];
const uuid = z.union([z.literal(""), z.string().uuid()]).default("");
const count = z.string().regex(/^\d*$/, "Usa números enteros positivos").refine(value => !value || Number(value) <= 5000, "El valor máximo es 5000").default("");
export const requirementFiltersSchema = z.object({
  cliente: uuid, unidad: uuid,
  estado: z.union([z.literal(""), z.enum(ADMIN_STATES)]).default(""),
  genero: z.union([z.literal(""), z.enum(REQUIREMENT_GENDERS)]).default(""),
  prendasMin: count, prendasMax: count, unidadesMin: count, unidadesMax: count,
  q: z.string().trim().max(120).default(""),
}).refine(value => !value.prendasMin || !value.prendasMax || Number(value.prendasMin) <= Number(value.prendasMax), {
  message: "El mínimo de prendas no puede superar el máximo", path: ["prendasMax"],
}).refine(value => !value.unidadesMin || !value.unidadesMax || Number(value.unidadesMin) <= Number(value.unidadesMax), {
  message: "El mínimo de unidades no puede superar el máximo", path: ["unidadesMax"],
});
export type RequirementFilters = z.infer<typeof requirementFiltersSchema>;
export const EMPTY_REQUIREMENT_FILTERS: RequirementFilters = {
  cliente:"",unidad:"",estado:"",genero:"",prendasMin:"",prendasMax:"",unidadesMin:"",unidadesMax:"",q:"",
};
export function parseRequirementQuery(params: URLSearchParams) {
  return { filters: requirementFiltersSchema.parse(Object.fromEntries(params)), page: z.coerce.number().int().min(1).max(100000).parse(params.get("page") ?? 1) };
}
export function requirementFilterParams(filters: RequirementFilters,page=1) {
  const params=new URLSearchParams();for(const [key,value] of Object.entries(filters))if(value)params.set(key,value);params.set("page",String(page));return params;
}
export function requirementRpcArgs(filters: RequirementFilters) {
  return {
    p_cliente_id:filters.cliente||null,p_unidad_id:filters.unidad||null,p_estado:filters.estado||null,p_genero:filters.genero||null,
    p_prendas_min:filters.prendasMin?Number(filters.prendasMin):null,p_prendas_max:filters.prendasMax?Number(filters.prendasMax):null,
    p_unidades_min:filters.unidadesMin?Number(filters.unidadesMin):null,p_unidades_max:filters.unidadesMax?Number(filters.unidadesMax):null,
    p_busqueda:filters.q||null,
  };
}

export function genderValuesForFilter(filter: RequirementGenderFilter | "") {
  if (filter === "HOMBRE") return ["HOMBRE", "AMBOS"] as const;
  if (filter === "MUJER") return ["MUJER", "AMBOS"] as const;
  if (filter === "AMBOS") return ["AMBOS"] as const;
  return [] as const;
}

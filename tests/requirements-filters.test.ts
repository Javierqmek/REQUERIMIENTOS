import assert from "node:assert/strict";
import { test } from "node:test";
import { IDS } from "./fixtures/admin";
import {
  EMPTY_REQUIREMENT_FILTERS, genderValuesForFilter, parseRequirementQuery,
  requirementFilterParams, requirementRpcArgs,
} from "../lib/requirements/list-filters";

test("Mis requerimientos conserva cliente, sede y Observado",()=>{
  const filters={...EMPTY_REQUIREMENT_FILTERS,cliente:IDS.cliente,unidad:IDS.unidad,estado:"Observado" as const};
  assert.deepEqual(parseRequirementQuery(requirementFilterParams(filters,2)),{filters,page:2});
});
test("Mis requerimientos convierte rangos de prendas y unidades para la RPC",()=>{
  const filters={...EMPTY_REQUIREMENT_FILTERS,prendasMin:"10",prendasMax:"12",unidadesMin:"12",unidadesMax:"20",q:"Pérez"};
  assert.deepEqual(requirementRpcArgs(filters),{
    p_cliente_id:null,p_unidad_id:null,p_estado:null,p_genero:null,
    p_prendas_min:10,p_prendas_max:12,p_unidades_min:12,p_unidades_max:20,p_busqueda:"Pérez",
  });
});
test("los filtros se combinan sin confundir prendas y unidades",()=>{
  const filters={...EMPTY_REQUIREMENT_FILTERS,cliente:IDS.cliente,unidad:IDS.unidad,estado:"Atendido" as const,genero:"HOMBRE" as const,prendasMin:"2",prendasMax:"3",unidadesMin:"7",unidadesMax:"9"};
  const args=requirementRpcArgs(parseRequirementQuery(requirementFilterParams(filters)).filters);
  assert.equal(args.p_prendas_min,2);assert.equal(args.p_prendas_max,3);
  assert.equal(args.p_unidades_min,7);assert.equal(args.p_unidades_max,9);assert.equal(args.p_genero,"HOMBRE");
});
test("regla de género incluye AMBOS para Hombre y Mujer, pero Unisex es exacto",()=>{
  assert.deepEqual(genderValuesForFilter("HOMBRE"),["HOMBRE","AMBOS"]);
  assert.deepEqual(genderValuesForFilter("MUJER"),["MUJER","AMBOS"]);
  assert.deepEqual(genderValuesForFilter("AMBOS"),["AMBOS"]);
});
for(const query of ["prendasMin=12&prendasMax=10","unidadesMin=20&unidadesMax=12","prendasMin=-1","unidadesMax=1.5","genero=OTRO","page=0"]){
  test("rechaza filtro inválido: "+query,()=>assert.throws(()=>parseRequirementQuery(new URLSearchParams(query))));
}

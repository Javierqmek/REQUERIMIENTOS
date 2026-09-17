"use client";
import { RotateCcw, Search } from "lucide-react";
import { ADMIN_STATES } from "@/lib/admin/filters";
import { REQUIREMENT_GENDERS, type RequirementFilters } from "@/lib/requirements/list-filters";
import type { RequirementListOptions } from "@/lib/requirements/list-data";

const genderLabel={HOMBRE:"Hombre",MUJER:"Mujer",AMBOS:"AMBOS / Unisex"} as const;
export function RequirementsFilters({value,options,disabled,dirty,onChange,onApply,onClear}:{
  value:RequirementFilters;options:RequirementListOptions;disabled:boolean;dirty:boolean;
  onChange:(value:RequirementFilters)=>void;onApply:()=>void;onClear:()=>void;
}){
  const units=value.cliente?options.unidades.filter(unit=>unit.cliente_id===value.cliente):options.unidades;
  const change=(key:keyof RequirementFilters,next:string)=>onChange({...value,[key]:next,...(key==="cliente"?{unidad:""}:{})});
  return <form onSubmit={event=>{event.preventDefault();onApply()}} className="border-t border-[var(--border)] px-4 pb-4 pt-3 sm:px-5">
    <fieldset disabled={disabled} className="min-w-0"><legend className="sr-only">Filtros de mis requerimientos</legend>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div><label className="label" htmlFor="req-cliente">Cliente</label><select id="req-cliente" className="input" value={value.cliente} onChange={event=>change("cliente",event.target.value)}><option value="">Todos los clientes</option>{options.clientes.map(row=><option key={row.id} value={row.id}>{row.nombre}</option>)}</select></div>
        <div><label className="label" htmlFor="req-unidad">Unidad / Sede</label><select id="req-unidad" className="input" value={value.unidad} onChange={event=>change("unidad",event.target.value)}><option value="">Todas las unidades</option>{units.map(row=><option key={row.id} value={row.id}>{row.nombre}</option>)}</select></div>
        <div><label className="label" htmlFor="req-estado">Estado</label><select id="req-estado" className="input" value={value.estado} onChange={event=>change("estado",event.target.value)}><option value="">Todos los estados</option>{ADMIN_STATES.map(state=><option key={state}>{state}</option>)}</select></div>
        <div><label className="label" htmlFor="req-genero">Género de prenda</label><select id="req-genero" className="input" value={value.genero} onChange={event=>change("genero",event.target.value)}><option value="">Todos los géneros</option>{REQUIREMENT_GENDERS.map(gender=><option value={gender} key={gender}>{genderLabel[gender]}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-2"><div><label className="label" htmlFor="req-prendas-min">Prendas mín.</label><input id="req-prendas-min" className="input" inputMode="numeric" value={value.prendasMin} onChange={event=>change("prendasMin",event.target.value)} placeholder="0"/></div><div><label className="label" htmlFor="req-prendas-max">Prendas máx.</label><input id="req-prendas-max" className="input" inputMode="numeric" value={value.prendasMax} onChange={event=>change("prendasMax",event.target.value)} placeholder="Sin límite"/></div></div>
        <div className="grid grid-cols-2 gap-2"><div><label className="label" htmlFor="req-unidades-min">Unidades mín.</label><input id="req-unidades-min" className="input" inputMode="numeric" value={value.unidadesMin} onChange={event=>change("unidadesMin",event.target.value)} placeholder="0"/></div><div><label className="label" htmlFor="req-unidades-max">Unidades máx.</label><input id="req-unidades-max" className="input" inputMode="numeric" value={value.unidadesMax} onChange={event=>change("unidadesMax",event.target.value)} placeholder="Sin límite"/></div></div>
      </div>
      <div className="mt-3 flex flex-col gap-3 border-t border-[var(--border)] pt-3 lg:flex-row lg:items-end"><div className="min-w-0 flex-1"><label className="label" htmlFor="req-q">Buscar requerimiento</label><div className="relative"><Search aria-hidden="true" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/><input id="req-q" className="input !pl-10" value={value.q} maxLength={120} placeholder="Agente, DNI, cliente o sede" onChange={event=>change("q",event.target.value)}/></div></div><div className="flex flex-wrap gap-2"><button type="button" className="btn btn-ghost flex-1 sm:flex-none" onClick={onClear}><RotateCcw size={16}/>Limpiar filtros</button><button className="btn btn-secondary flex-1 sm:flex-none" type="submit">Aplicar filtros</button></div></div>
      <p className="mt-2 text-xs text-[var(--text-secondary)]">{dirty?"Hay cambios sin aplicar.":"Prendas cuenta líneas activas; unidades suma sus cantidades."}</p>
    </fieldset>
  </form>;
}

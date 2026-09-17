"use client";
import { LEGACY_CLIENT, LEGACY_UNIT } from "@/lib/requerimientos";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ClipboardList, LoaderCircle, SlidersHorizontal } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { NavigationLink } from "@/components/ui/navigation-link";
import { Alert } from "@/components/ui/alert";
import { RequirementsFilters } from "@/components/requirements-filters";
import { formatMoney } from "@/lib/requirements/money";
import { EMPTY_REQUIREMENT_FILTERS, requirementFilterParams, requirementFiltersSchema, type RequirementFilters } from "@/lib/requirements/list-filters";
import type { RequirementListOptions, RequirementListResult } from "@/lib/requirements/list-data";

export function RequirementsList({initial,options,initialFilters=EMPTY_REQUIREMENT_FILTERS}:{initial:RequirementListResult;options:RequirementListOptions;initialFilters?:RequirementFilters}) {
  const [result,setResult]=useState(initial);
  const [draft,setDraft]=useState(initialFilters);
  const [applied,setApplied]=useState(initialFilters);
  const [filtersOpen,setFiltersOpen]=useState(()=>Object.values(initialFilters).some(Boolean));
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const requestRef=useRef<AbortController|null>(null);
  const dirty=JSON.stringify(draft)!==JSON.stringify(applied);
  const activeCount=Object.values(applied).filter(Boolean).length;
  useEffect(()=>()=>requestRef.current?.abort(),[]);

  async function load(filters:RequirementFilters,page:number,append=false){
    requestRef.current?.abort();const controller=new AbortController();requestRef.current=controller;setLoading(true);setError("");
    try{const response=await fetch("/api/requerimientos?"+requirementFilterParams(filters,page),{cache:"no-store",signal:controller.signal});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"No se pudo consultar la información.");if(controller.signal.aborted)return;const next=payload as RequirementListResult;setResult(current=>append?{...next,rows:[...current.rows,...next.rows]}:next);setApplied(filters);window.history.replaceState(null,"","/requerimientos?"+requirementFilterParams(filters,page));}
    catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"No se pudo consultar la información.");}
    finally{if(requestRef.current===controller)setLoading(false)}
  }
  function apply(){const parsed=requirementFiltersSchema.safeParse(draft);if(!parsed.success){setError(parsed.error.issues[0].message);return}setDraft(parsed.data);void load(parsed.data,1)}
  function clear(){setDraft(EMPTY_REQUIREMENT_FILTERS);void load(EMPTY_REQUIREMENT_FILTERS,1)}

  return <>
    <div className="card">
      <button onClick={()=>setFiltersOpen(value=>!value)} className="flex min-h-12 w-full items-center gap-2 rounded-xl px-4 text-left text-sm font-medium sm:px-5" aria-expanded={filtersOpen} aria-controls="requirements-filter-panel"><SlidersHorizontal size={17} className="text-[var(--text-secondary)]"/>Filtros<span className="text-xs font-normal text-[var(--text-secondary)]">{activeCount?`· ${activeCount} aplicados`:"· Todos los requerimientos"}</span><ChevronDown size={16} className={`ml-auto shrink-0 ${filtersOpen?"rotate-180":""}`}/></button>
      <div id="requirements-filter-panel" hidden={!filtersOpen}><RequirementsFilters value={draft} options={options} disabled={loading} dirty={dirty} onChange={setDraft} onApply={apply} onClear={clear}/></div>
    </div>
    <div className="mb-3 mt-4 flex min-h-6 flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-[var(--brand-900)]" aria-live="polite">{result.total.toLocaleString("es-PE")} {result.total===1?"requerimiento encontrado":"requerimientos encontrados"}</h2>{loading&&<span className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><LoaderCircle size={15} className="animate-spin"/>Consultando...</span>}</div>
    {error&&<div className="mb-3"><Alert kind="error">{error}</Alert></div>}
    <div className={`overflow-hidden rounded-xl border border-[#DCE3EC] bg-white ${loading?"opacity-60":""}`} aria-busy={loading}>
      {result.rows.length?result.rows.map(row=><NavigationLink href={`/requerimientos/${row.id}`} key={row.id} className="flex w-full items-center gap-3 border-b border-[#E8EDF4] px-4 py-3 text-left last:border-b-0 hover:bg-[#F8FAFD]">
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-[#172033]">{row.personal?.nombre}</h3><StatusBadge estado={row.estado}/></div><p className="mt-0.5 text-xs text-[#607089]">{row.clientes?.nombre??LEGACY_CLIENT} · {row.unidades?.nombre??LEGACY_UNIT}</p><p className="mt-1 text-xs font-medium text-[#607089]">{row.cantidad_prendas??0} prendas · {row.unidades_totales??0} unidades</p><p className="mt-1 text-xs text-[#8794A8]">{new Intl.DateTimeFormat("es-PE",{dateStyle:"medium",timeStyle:"short"}).format(new Date(row.fecha))}</p></div>
        <div className="shrink-0 text-right"><span className="block text-[11px] text-[#607089]">Total</span><strong className="mt-0.5 block text-sm font-semibold tabular-nums text-[#0B1F3A]">{formatMoney(row.total_requerimiento)}</strong></div>
      </NavigationLink>):<div className="p-6 text-center"><ClipboardList className="mx-auto text-[#8794A8]" size={24}/><p className="mt-2 text-sm font-semibold text-[#172033]">No hay requerimientos con estos filtros.</p><p className="mt-0.5 text-xs text-[#607089]">Limpia o ajusta los filtros para ampliar la búsqueda.</p></div>}
    </div>
    {result.rows.length<result.total&&<button className="btn btn-secondary mx-auto mt-3 flex" disabled={loading||dirty} onClick={()=>void load(applied,result.page+1,true)}>{loading&&<LoaderCircle className="animate-spin" size={17}/>} {loading?"Cargando...":"Cargar más"}</button>}
  </>;
}

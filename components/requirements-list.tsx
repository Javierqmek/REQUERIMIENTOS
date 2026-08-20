"use client";
import { useMemo, useState } from "react";
import { ClipboardList, LoaderCircle, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "./status-badge";
import type { Requerimiento } from "@/lib/types";
import { NavigationLink } from "@/components/ui/navigation-link";
import { Alert } from "@/components/ui/alert";

export function RequirementsList({ rows: initial }: { rows: Requerimiento[] }) {
  const [rows,setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [loadingMore,setLoadingMore]=useState(false);
  const [hasMore,setHasMore]=useState(initial.length===100);
  const [error,setError]=useState("");
  const filtered = useMemo(() => { const q=query.toLowerCase().trim(); return !q ? rows : rows.filter(r => [r.personal?.nombre,r.personal?.dni,r.personal?.cliente,r.personal?.unidad].some(v => v?.toLowerCase().includes(q))); }, [rows,query]);
  async function loadMore(){if(loadingMore)return;setLoadingMore(true);setError("");const {data,error:loadError}=await createClient().from("requerimientos").select("id,fecha,referencia_interna,estado,personal(nombre,dni,cargo,cliente,unidad)").order("fecha",{ascending:false}).range(rows.length,rows.length+99);if(loadError){setError("No pudimos cargar más requerimientos.");setLoadingMore(false);return;}const next=(data??[]) as unknown as Requerimiento[];setRows(current=>[...current,...next]);setHasMore(next.length===100);setLoadingMore(false);}
  return <><div className="relative mb-4 max-w-xl"><Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#607089]" size={18}/><input className="input !pl-11" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar requerimiento..." aria-label="Buscar requerimiento"/></div>
    {error&&<div className="mb-3"><Alert kind="error">{error}</Alert></div>}<div className="overflow-hidden rounded-xl border border-[#DCE3EC] bg-white">{filtered.length ? filtered.map(row => <NavigationLink href={`/requerimientos/${row.id}`} key={row.id} className="flex w-full items-center gap-4 border-b border-[#E8EDF4] px-4 py-3 text-left last:border-b-0 hover:bg-[#F8FAFD]"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-[#172033]">{row.personal?.nombre}</h2><StatusBadge estado={row.estado}/></div><p className="mt-0.5 text-xs text-[#607089]">{row.personal?.cliente} · {row.personal?.unidad}</p><p className="mt-1 text-xs text-[#8794A8]">{new Intl.DateTimeFormat("es-PE", { dateStyle:"medium", timeStyle:"short" }).format(new Date(row.fecha))}</p></div></NavigationLink>) : <div className="p-6 text-center"><ClipboardList className="mx-auto text-[#8794A8]" size={24}/><p className="mt-2 text-sm font-semibold text-[#172033]">{query?"No encontramos requerimientos con ese criterio.":"Aún no tienes requerimientos."}</p><p className="mt-0.5 text-xs text-[#607089]">{query?"Prueba con otra palabra.":"Crea tu primer requerimiento desde el inicio."}</p></div>}</div>{hasMore&&<button className="btn btn-secondary mx-auto mt-3 flex" disabled={loadingMore} onClick={loadMore}>{loadingMore&&<LoaderCircle className="animate-spin" size={17}/>} {loadingMore?"Cargando...":"Cargar más"}</button>}</>;
}

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
  return <><div className="relative mb-5"><Search className="absolute left-4 top-3.5 text-slate-400" size={20}/><input className="input pl-12" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar requerimiento..." aria-label="Buscar requerimiento"/></div>
    {error&&<div className="mb-4"><Alert kind="error">{error}</Alert></div>}<div className="space-y-3">{filtered.length ? filtered.map(row => <NavigationLink href={`/requerimientos/${row.id}`} key={row.id} className="card flex w-full items-center gap-4 p-4 text-left transition hover:border-blue-200"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-extrabold">{row.personal?.nombre}</h2><StatusBadge estado={row.estado}/></div><p className="mt-1 text-sm text-slate-500">{row.personal?.cliente} · {row.personal?.unidad}</p><p className="mt-2 text-xs text-slate-400">{new Intl.DateTimeFormat("es-PE", { dateStyle:"medium", timeStyle:"short" }).format(new Date(row.fecha))}</p></div></NavigationLink>) : <div className="card p-10 text-center"><ClipboardList className="mx-auto text-slate-400" size={32}/><p className="mt-3 font-bold text-slate-700">{query?"No encontramos requerimientos con ese criterio.":"Aún no tienes requerimientos."}</p><p className="mt-1 text-sm text-slate-500">{query?"Prueba con otra palabra.":"Crea tu primer requerimiento desde el inicio."}</p></div>}</div>{hasMore&&<button className="btn btn-secondary mx-auto mt-4 flex" disabled={loadingMore} onClick={loadMore}>{loadingMore&&<LoaderCircle className="animate-spin" size={18}/>} {loadingMore?"Cargando...":"Cargar más"}</button>}</>;
}

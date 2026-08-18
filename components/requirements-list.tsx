"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, LoaderCircle, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "./status-badge";
import type { Requerimiento } from "@/lib/types";

export function RequirementsList({ rows: initial }: { rows: Requerimiento[] }) {
  const [rows,setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [loadingMore,setLoadingMore]=useState(false);
  const [hasMore,setHasMore]=useState(initial.length===100);
  const filtered = useMemo(() => { const q=query.toLowerCase().trim(); return !q ? rows : rows.filter(r => [r.personal?.nombre,r.personal?.dni,r.personal?.cliente,r.personal?.unidad].some(v => v?.toLowerCase().includes(q))); }, [rows,query]);
  async function loadMore(){setLoadingMore(true);const {data}=await createClient().from("requerimientos").select("id,fecha,referencia_interna,estado,personal(nombre,dni,cargo,cliente,unidad)").order("fecha",{ascending:false}).range(rows.length,rows.length+99);const next=(data??[]) as unknown as Requerimiento[];setRows(current=>[...current,...next]);setHasMore(next.length===100);setLoadingMore(false);}
  return <><div className="relative mb-5"><Search className="absolute left-4 top-3.5 text-slate-400" size={20}/><input className="input pl-12" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar requerimiento..." aria-label="Buscar requerimiento"/></div>
    <div className="space-y-3">{filtered.length ? filtered.map(row => <Link href={`/requerimientos/${row.id}`} key={row.id} className="card flex items-center gap-4 p-4 transition hover:border-blue-200"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-extrabold">{row.personal?.nombre}</h2><StatusBadge estado={row.estado}/></div><p className="mt-1 text-sm text-slate-500">{row.personal?.cliente} · {row.personal?.unidad}</p><p className="mt-2 text-xs text-slate-400">{new Intl.DateTimeFormat("es-PE", { dateStyle:"medium", timeStyle:"short" }).format(new Date(row.fecha))}</p></div><ChevronRight className="shrink-0 text-slate-400"/></Link>) : <div className="card p-10 text-center text-slate-500">No se encontraron requerimientos.</div>}</div>{hasMore&&<button className="btn mx-auto mt-4 flex bg-white text-blue-700 shadow-sm" disabled={loadingMore} onClick={loadMore}>{loadingMore&&<LoaderCircle className="animate-spin" size={18}/>}Cargar más</button>}</>;
}

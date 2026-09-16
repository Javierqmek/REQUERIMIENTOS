"use client";
import { LEGACY_CLIENT, LEGACY_UNIT } from "@/lib/requerimientos";
import { useMemo, useState } from "react";
import { ClipboardList, LoaderCircle, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "./status-badge";
import type { Requerimiento } from "@/lib/types";
import { NavigationLink } from "@/components/ui/navigation-link";
import { Alert } from "@/components/ui/alert";
import { formatMoney } from "@/lib/requirements/money";

export function RequirementsList({ rows: initial }: { rows: Requerimiento[] }) {
  const [rows,setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [loadingMore,setLoadingMore]=useState(false);
  const [hasMore,setHasMore]=useState(initial.length===100);
  const [error,setError]=useState("");
  const filtered = useMemo(() => {
    const q=query.toLowerCase().trim();
    return !q ? rows : rows.filter(row => [
      row.personal?.nombre,row.personal?.dni,row.clientes?.nombre ?? LEGACY_CLIENT,row.unidades?.nombre ?? LEGACY_UNIT,
    ].some(value => value?.toLowerCase().includes(q)));
  }, [rows,query]);
  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true); setError("");
    const { data, error:loadError } = await createClient().rpc("listar_requerimientos_con_total", { p_limite:100, p_offset:rows.length });
    if (loadError) { setError("No pudimos cargar más requerimientos."); setLoadingMore(false); return; }
    const next=(data??[]) as unknown as Requerimiento[];
    setRows(current=>[...current,...next]); setHasMore(next.length===100); setLoadingMore(false);
  }
  return <>
    <div className="relative mb-4 max-w-xl"><Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#607089]" size={18}/><input className="input !pl-11" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar requerimiento..." aria-label="Buscar requerimiento"/></div>
    {error&&<div className="mb-3"><Alert kind="error">{error}</Alert></div>}
    <div className="overflow-hidden rounded-xl border border-[#DCE3EC] bg-white">
      {filtered.length ? filtered.map(row => <NavigationLink href={`/requerimientos/${row.id}`} key={row.id} className="flex w-full items-center gap-3 border-b border-[#E8EDF4] px-4 py-3 text-left last:border-b-0 hover:bg-[#F8FAFD]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-[#172033]">{row.personal?.nombre}</h2><StatusBadge estado={row.estado}/></div>
          <p className="mt-0.5 text-xs text-[#607089]">{row.clientes?.nombre ?? LEGACY_CLIENT} · {row.unidades?.nombre ?? LEGACY_UNIT}</p>
          <p className="mt-1 text-xs font-medium text-[#607089]">{row.cantidad_prendas ?? 0} prendas · {row.unidades_totales ?? 0} unidades</p>
          <p className="mt-1 text-xs text-[#8794A8]">{new Intl.DateTimeFormat("es-PE", { dateStyle:"medium", timeStyle:"short" }).format(new Date(row.fecha))}</p>
        </div>
        <div className="shrink-0 text-right">
          <span className="block text-[11px] text-[#607089]">Total</span>
          <strong className="mt-0.5 block text-sm font-semibold tabular-nums text-[#0B1F3A]">{formatMoney(row.total_requerimiento)}</strong>
        </div>
      </NavigationLink>) : <div className="p-6 text-center"><ClipboardList className="mx-auto text-[#8794A8]" size={24}/><p className="mt-2 text-sm font-semibold text-[#172033]">{query?"No encontramos requerimientos con ese criterio.":"Aún no tienes requerimientos."}</p><p className="mt-0.5 text-xs text-[#607089]">{query?"Prueba con otra palabra.":"Crea tu primer requerimiento desde el inicio."}</p></div>}
    </div>
    {hasMore&&<button className="btn btn-secondary mx-auto mt-3 flex" disabled={loadingMore} onClick={loadMore}>{loadingMore&&<LoaderCircle className="animate-spin" size={17}/>} {loadingMore?"Cargando...":"Cargar más"}</button>}
  </>;
}

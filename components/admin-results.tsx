"use client";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList, Copy, LoaderCircle, Trash2 } from "lucide-react";
import { ADMIN_STATES, type AdminFilters, type AdminSortField } from "@/lib/admin/filters";
import { LEGACY_CLIENT, LEGACY_UNIT } from "@/lib/requerimientos";
import type { AdminResult, AdminRow } from "@/lib/admin/types";
import type { Estado } from "@/lib/types";
import { formatMoney } from "@/lib/requirements/money";

function StateControl({ row, busy, disabled, onUpdate }: { row: AdminRow; busy: string; disabled: boolean; onUpdate: (id: string, state: Estado) => void }) {
  return <div className="flex min-w-0 items-center gap-1"><select aria-label={`Estado de ${row.personal?.nombre ?? row.id}`} className="input !h-11 min-w-0 !px-2 !text-[13px]" disabled={disabled || Boolean(busy)} value={row.estado} onChange={e => onUpdate(row.id, e.target.value as Estado)}>{ADMIN_STATES.map(s => <option key={s}>{s}</option>)}</select>{busy === row.id && <LoaderCircle aria-label="Actualizando estado" size={16} className="shrink-0 animate-spin text-[var(--brand-600)]"/>}</div>;
}
const dateFormat = new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeZone: "America/Lima" });
export function AdminResults({ result, filters, loading, busy, disabled, onUpdate, onPage, onSort, deletionEnabled=false, selected=new Set(), onSelect=()=>{}, onDelete=()=>{} }: {
  result: AdminResult; filters: AdminFilters; loading: boolean; busy: string; disabled: boolean;
  onUpdate: (id: string, state: Estado) => void; onPage: (page: number) => void;
  onSort: (field: AdminSortField) => void;
  deletionEnabled?: boolean; selected?: ReadonlySet<string>; onSelect?: (id:string,checked:boolean)=>void; onDelete?: (id:string)=>void;
}) {
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const allSelected=Boolean(result.rows.length)&&result.rows.every(row=>selected.has(row.id));
  return <section aria-label="Resultados" aria-busy={loading} className="mt-4">
    <div className="mb-3 flex min-h-6 flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-sm font-semibold text-[var(--brand-900)]" aria-live="polite">{result.total.toLocaleString("es-PE")} {result.total === 1 ? "requerimiento encontrado" : "requerimientos encontrados"}</h2><p className="mt-0.5 text-xs text-[var(--text-secondary)]">{result.duplicateTotal} posibles duplicados en {result.duplicateGroups} grupos</p></div>
      {loading ? <span className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><LoaderCircle size={15} className="animate-spin"/>Consultando...</span> : <span className="text-xs text-[var(--text-secondary)]">Prendas = líneas activas · Unidades = suma de cantidades</span>}
    </div>
    <div className={`card overflow-hidden ${loading ? "opacity-60" : ""}`}>
      {!result.rows.length ? <div className="px-4 py-7 text-center"><ClipboardList aria-hidden="true" size={22} className="mx-auto text-[var(--text-secondary)]"/><p className="mt-2 text-sm font-medium">No hay requerimientos con los filtros seleccionados.</p><p className="mt-1 text-xs text-[var(--text-secondary)]">Prueba otro rango de fechas o limpia los filtros.</p></div> : <>
        <table className="admin-table hidden w-full table-fixed text-left text-[13px] xl:table">
          <caption className="sr-only">Requerimientos administrativos</caption>
          <colgroup>{deletionEnabled&&<col style={{width:"4%"}}/>}{[8, 13, 8, 10, 12, 11, 12, 5, 8, deletionEnabled?9:13].map((width, i) => <col key={i} style={{ width: width + "%" }}/>)}</colgroup>
          <thead><tr>{deletionEnabled&&<th scope="col"><input type="checkbox" aria-label="Seleccionar página" checked={allSelected} onChange={e=>result.rows.forEach(row=>onSelect(row.id,e.target.checked))}/></th>}{([
            ["Fecha","fecha"],["Agente","agente"],["DNI",null],["Cliente","cliente"],["Unidad / Sede","unidad"],["Coordinador","coordinador"],["Estado","estado"],["Prendas","prendas"],["Total","total"],["Acciones",null],
          ] as const).map(([label,field]) => <th scope="col" key={label} aria-sort={field ? (filters.orden===field ? filters.direccion==="asc"?"ascending":"descending" : "none") : undefined}>{field?<button type="button" disabled={disabled||loading} onClick={()=>onSort(field)} className="flex w-full items-center gap-1 text-left font-inherit"><span>{label}</span><span aria-hidden="true">{filters.orden===field?(filters.direccion==="asc"?"↑":"↓"):"↕"}</span><span className="sr-only">Ordenar por {label}</span></button>:label}</th>)}</tr></thead>
          <tbody>{result.rows.map(row => <tr key={row.id}>
            {deletionEnabled&&<td><input type="checkbox" aria-label={`Seleccionar requerimiento de ${row.personal?.nombre??row.id}`} checked={selected.has(row.id)} onChange={e=>onSelect(row.id,e.target.checked)}/></td>}
            <td className="text-[var(--text-secondary)]">{dateFormat.format(new Date(row.fecha))}</td>
            <td className="font-medium">{row.personal?.nombre || "Sin agente"}{row.posible_duplicado&&<span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-700"><Copy size={12}/>Grupo {row.grupo_duplicado_id?.slice(0,8)} · {row.grupo_duplicado_tamano}{row.potencialmente_incompleto?" · incompleto":""}</span>}</td><td>{row.personal?.dni || "—"}</td>
            <td>{row.clientes?.nombre ?? LEGACY_CLIENT}</td><td>{row.unidades?.nombre ?? LEGACY_UNIT}</td>
            <td>{row.profiles?.nombre || row.profiles?.email || "Sin coordinador"}</td>
            <td><StateControl row={row} busy={busy} disabled={disabled || loading} onUpdate={onUpdate}/></td>
            <td className="text-center tabular-nums"><span className="block">{row.cantidad_prendas}</span><span className="text-[11px] text-[var(--text-secondary)]">{row.unidades_totales} unid.</span></td>
            <td className="tabular-nums font-medium">{formatMoney(row.total_requerimiento)}</td>
            <td><div className="flex items-center gap-1"><Link className="inline-flex min-h-11 items-center text-[var(--brand-700)] underline-offset-4 hover:underline" href={`/requerimientos/${row.id}`}>Ver<span className="sr-only"> detalle de {row.personal?.nombre}</span></Link>{deletionEnabled&&<button className="grid h-11 w-9 place-items-center rounded-lg text-[var(--error)] hover:bg-red-50" aria-label={`Eliminar requerimiento de prueba de ${row.personal?.nombre??row.id}`} onClick={()=>onDelete(row.id)}><Trash2 size={16}/></button>}</div></td>
          </tr>)}</tbody>
        </table>
        <div className="divide-y divide-[var(--border)] xl:hidden">{result.rows.map(row => <article key={row.id} className="px-4 py-4">
          <div className="flex items-start gap-3">{deletionEnabled&&<input type="checkbox" className="mt-1" aria-label={`Seleccionar requerimiento de ${row.personal?.nombre??row.id}`} checked={selected.has(row.id)} onChange={e=>onSelect(row.id,e.target.checked)}/>}<div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{row.personal?.nombre || "Sin agente"}</h3>{row.posible_duplicado&&<p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-700"><Copy size={12}/>Posible duplicado · grupo {row.grupo_duplicado_id?.slice(0,8)} ({row.grupo_duplicado_tamano})</p>}</div><time dateTime={row.fecha} className="shrink-0 text-xs text-[var(--text-secondary)]">{dateFormat.format(new Date(row.fecha))}</time></div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            {[["DNI", row.personal?.dni || "—"], ["Prendas", row.cantidad_prendas], ["Unidades", row.unidades_totales], ["Total", formatMoney(row.total_requerimiento)], ["Cliente", row.clientes?.nombre ?? LEGACY_CLIENT], ["Unidad / Sede", row.unidades?.nombre ?? LEGACY_UNIT], ["Coordinador", row.profiles?.nombre || row.profiles?.email || "Sin coordinador"], ["ID", row.id]].map(([label, value]) => <div key={label} className={label === "Coordinador" || label === "ID" ? "col-span-2 min-w-0" : "min-w-0"}><dt className="text-xs text-[var(--text-secondary)]">{label}</dt><dd className="mt-0.5 break-words">{value}</dd></div>)}
          </dl>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-[var(--border)] pt-3">
            <div className="w-[148px]"><p className="mb-1 text-xs text-[var(--text-secondary)]">Estado</p><StateControl row={row} busy={busy} disabled={disabled || loading} onUpdate={onUpdate}/></div>
            <div className="flex gap-1"><Link className="btn btn-ghost !px-2 text-[var(--brand-700)]" href={`/requerimientos/${row.id}`}>Ver detalle<span className="sr-only"> de {row.personal?.nombre}</span></Link>{deletionEnabled&&<button className="btn btn-ghost !px-3 text-[var(--error)]" aria-label={`Eliminar requerimiento de prueba de ${row.personal?.nombre??row.id}`} onClick={()=>onDelete(row.id)}><Trash2 size={16}/></button>}</div>
          </div>
        </article>)}</div>
      </>}
    </div>
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-2" aria-label="Paginación de requerimientos">
      <p className="text-xs text-[var(--text-secondary)]">{result.total ? `${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.total)} de ${result.total}` : "0 resultados"} · Página {result.page} de {pages}</p>
      <div className="flex gap-2"><button className="btn btn-secondary !px-3" aria-label="Página anterior" disabled={disabled || loading || Boolean(busy) || result.page <= 1} onClick={() => onPage(result.page - 1)}><ChevronLeft size={17}/><span className="sr-only sm:not-sr-only">Anterior</span></button><button className="btn btn-secondary !px-3" aria-label="Página siguiente" disabled={disabled || loading || Boolean(busy) || result.page >= pages} onClick={() => onPage(result.page + 1)}><span className="sr-only sm:not-sr-only">Siguiente</span><ChevronRight size={17}/></button></div>
    </nav>
  </section>;
}

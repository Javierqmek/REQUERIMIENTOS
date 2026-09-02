"use client";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList, LoaderCircle } from "lucide-react";
import { ADMIN_STATES } from "@/lib/admin/filters";
import { LEGACY_CLIENT, LEGACY_UNIT } from "@/lib/requerimientos";
import type { AdminResult, AdminRow } from "@/lib/admin/types";
import type { Estado } from "@/lib/types";

function StateControl({ row, busy, disabled, onUpdate }: { row: AdminRow; busy: string; disabled: boolean; onUpdate: (id: string, state: Estado) => void }) {
  return <div className="flex min-w-0 items-center gap-1"><select aria-label={`Estado de ${row.personal?.nombre ?? row.id}`} className="input !h-11 min-w-0 !px-2 !text-[13px]" disabled={disabled || Boolean(busy)} value={row.estado} onChange={e => onUpdate(row.id, e.target.value as Estado)}>{ADMIN_STATES.map(s => <option key={s}>{s}</option>)}</select>{busy === row.id && <LoaderCircle aria-label="Actualizando estado" size={16} className="shrink-0 animate-spin text-[var(--brand-600)]"/>}</div>;
}
const dateFormat = new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeZone: "America/Lima" });
export function AdminResults({ result, loading, busy, disabled, onUpdate, onPage }: {
  result: AdminResult; loading: boolean; busy: string; disabled: boolean;
  onUpdate: (id: string, state: Estado) => void; onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return <section aria-label="Resultados" aria-busy={loading} className="mt-4">
    <div className="mb-3 flex min-h-6 flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-[var(--brand-900)]" aria-live="polite">{result.total.toLocaleString("es-PE")} {result.total === 1 ? "requerimiento encontrado" : "requerimientos encontrados"}</h2>
      {loading ? <span className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><LoaderCircle size={15} className="animate-spin"/>Consultando...</span> : <span className="text-xs text-[var(--text-secondary)]">Prendas = suma de cantidades</span>}
    </div>
    <div className={`card overflow-hidden ${loading ? "opacity-60" : ""}`}>
      {!result.rows.length ? <div className="px-4 py-7 text-center"><ClipboardList aria-hidden="true" size={22} className="mx-auto text-[var(--text-secondary)]"/><p className="mt-2 text-sm font-medium">No hay requerimientos con los filtros seleccionados.</p><p className="mt-1 text-xs text-[var(--text-secondary)]">Prueba otro rango de fechas o limpia los filtros.</p></div> : <>
        <table className="admin-table hidden w-full table-fixed text-left text-[13px] xl:table">
          <caption className="sr-only">Requerimientos administrativos</caption>
          <colgroup>{[9, 15, 8, 12, 14, 13, 13, 6, 10].map((width, i) => <col key={i} style={{ width: width + "%" }}/>)}</colgroup>
          <thead><tr>{["Fecha", "Agente", "DNI", "Cliente", "Unidad / Sede", "Coordinador", "Estado", "Prendas", "Detalle"].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead>
          <tbody>{result.rows.map(row => <tr key={row.id}>
            <td className="text-[var(--text-secondary)]">{dateFormat.format(new Date(row.fecha))}</td>
            <td className="font-medium">{row.personal?.nombre || "Sin agente"}</td><td>{row.personal?.dni || "—"}</td>
            <td>{row.clientes?.nombre ?? LEGACY_CLIENT}</td><td>{row.unidades?.nombre ?? LEGACY_UNIT}</td>
            <td>{row.profiles?.nombre || row.profiles?.email || "Sin coordinador"}</td>
            <td><StateControl row={row} busy={busy} disabled={disabled || loading} onUpdate={onUpdate}/></td>
            <td className="text-center tabular-nums">{row.cantidad_prendas}</td>
            <td><Link className="inline-flex min-h-11 items-center text-[var(--brand-700)] underline-offset-4 hover:underline" href={`/requerimientos/${row.id}`}>Ver detalle<span className="sr-only"> de {row.personal?.nombre}</span></Link></td>
          </tr>)}</tbody>
        </table>
        <div className="divide-y divide-[var(--border)] xl:hidden">{result.rows.map(row => <article key={row.id} className="px-4 py-4">
          <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words text-sm font-semibold">{row.personal?.nombre || "Sin agente"}</h3><time dateTime={row.fecha} className="shrink-0 text-xs text-[var(--text-secondary)]">{dateFormat.format(new Date(row.fecha))}</time></div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            {[["DNI", row.personal?.dni || "—"], ["Prendas", row.cantidad_prendas], ["Cliente", row.clientes?.nombre ?? LEGACY_CLIENT], ["Unidad / Sede", row.unidades?.nombre ?? LEGACY_UNIT], ["Coordinador", row.profiles?.nombre || row.profiles?.email || "Sin coordinador"]].map(([label, value]) => <div key={label} className={label === "Coordinador" ? "col-span-2 min-w-0" : "min-w-0"}><dt className="text-xs text-[var(--text-secondary)]">{label}</dt><dd className="mt-0.5 break-words">{value}</dd></div>)}
          </dl>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-[var(--border)] pt-3">
            <div className="w-[148px]"><p className="mb-1 text-xs text-[var(--text-secondary)]">Estado</p><StateControl row={row} busy={busy} disabled={disabled || loading} onUpdate={onUpdate}/></div>
            <Link className="btn btn-ghost !px-2 text-[var(--brand-700)]" href={`/requerimientos/${row.id}`}>Ver detalle<span className="sr-only"> de {row.personal?.nombre}</span></Link>
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

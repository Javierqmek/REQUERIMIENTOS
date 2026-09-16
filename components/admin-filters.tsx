"use client";
import { Search, RotateCcw } from "lucide-react";
import { ADMIN_STATES, type AdminFilters } from "@/lib/admin/filters";
import type { AdminOptions } from "@/lib/admin/types";

export function AdminFiltersForm({ value, options, disabled, dirty, onChange, onApply, onClear }: {
  value: AdminFilters; options: AdminOptions; disabled: boolean; dirty: boolean;
  onChange: (value: AdminFilters) => void; onApply: () => void; onClear: () => void;
}) {
  const units = value.cliente ? options.unidades.filter(u => u.cliente_id === value.cliente) : options.unidades;
  const change = (key: keyof AdminFilters, field: string) => onChange({ ...value, [key]: field, ...(key === "cliente" ? { unidad: "" } : {}) });
  return <form onSubmit={e => { e.preventDefault(); onApply(); }} className="border-t border-[var(--border)] px-4 pb-4 pt-3 sm:px-5">
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">Filtros de requerimientos</legend>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0"><label className="label" htmlFor="admin-cliente">Cliente</label><select className="input" id="admin-cliente" value={value.cliente} onChange={e => change("cliente", e.target.value)}><option value="">Todos los clientes</option>{options.clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
        <div className="min-w-0"><label className="label" htmlFor="admin-unidad">Unidad / Sede</label><select className="input" id="admin-unidad" value={value.unidad} onChange={e => change("unidad", e.target.value)}><option value="">Todas las unidades</option>{units.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></div>
        <div className="min-w-0"><label className="label" htmlFor="admin-coordinador">Coordinador</label><select className="input" id="admin-coordinador" value={value.coordinador} onChange={e => change("coordinador", e.target.value)}><option value="">Todos los coordinadores</option>{options.coordinadores.map(c => <option key={c.id} value={c.id}>{c.nombre || c.email}</option>)}</select></div>
        <div className="min-w-0"><label className="label" htmlFor="admin-estado">Estado</label><select className="input" id="admin-estado" value={value.estado} onChange={e => change("estado", e.target.value)}><option value="">Todos los estados</option>{ADMIN_STATES.map(s => <option key={s}>{s}</option>)}</select></div>
        <div className="min-w-0"><label className="label" htmlFor="admin-desde">Fecha desde</label><input className="input min-w-0" type="date" id="admin-desde" value={value.desde} onChange={e => change("desde", e.target.value)} max={value.hasta || undefined}/></div>
        <div className="min-w-0"><label className="label" htmlFor="admin-hasta">Fecha hasta</label><input className="input min-w-0" type="date" id="admin-hasta" value={value.hasta} onChange={e => change("hasta", e.target.value)} min={value.desde || undefined}/></div>
      </div>
      <div className="mt-3 flex flex-col gap-3 border-t border-[var(--border)] pt-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1"><label className="label" htmlFor="admin-busqueda">Buscar en todos los requerimientos</label><div className="relative"><Search aria-hidden="true" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"/><input id="admin-busqueda" className="input !pl-10" value={value.q} maxLength={120} placeholder="Agente, DNI, cliente o coordinador" onChange={e => change("q", e.target.value)}/></div></div>
        <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-ghost flex-1 sm:flex-none" onClick={onClear}><RotateCcw size={16}/>Limpiar filtros</button><button className="btn btn-secondary flex-1 sm:flex-none" type="submit">Aplicar filtros</button></div>
      </div>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] px-3 text-sm">
        <input type="checkbox" checked={value.duplicados === "1"} onChange={e => change("duplicados", e.target.checked ? "1" : "")}/>
        <span><strong className="font-medium">Solo posibles duplicados</strong><span className="ml-1 text-xs text-[var(--text-secondary)]">Mismo agente, destino y coordinador dentro de 24 horas.</span></span>
      </label>
      <p className="mt-2 text-xs text-[var(--text-secondary)]">{dirty ? "Hay cambios sin aplicar. Aplica los filtros antes de exportar." : "Fechas según hora de Perú. La exportación incluye todos los resultados filtrados."}</p>
    </fieldset>
  </form>;
}

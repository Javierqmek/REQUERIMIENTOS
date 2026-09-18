"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FilterX, Search } from "lucide-react";
import { EMPTY_PAPELETA_FILTERS, PAPELETA_ESTADOS, papeletaFilterParams, type PapeletaFilters } from "@/lib/vacations/list-filters";
import { papeletaEstadoLabel } from "@/lib/vacations/types";
import type { PapeletaListOptions } from "@/lib/vacations/list-data";

// Filtros combinables resueltos en servidor (ver listar_papeletas_vacaciones_filtradas): cambiar
// un filtro navega con nuevos query params, nunca filtra en el navegador sobre una tabla ya
// cargada. Unidad depende del cliente elegido. showCoordinador solo aplica para admin/gerente.
export function VacationFilters({ initial, options, showCoordinador }: { initial: PapeletaFilters; options: PapeletaListOptions; showCoordinador: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<PapeletaFilters>(initial);
  const unidadesDelCliente = useMemo(
    () => draft.cliente ? options.unidades.filter(u => u.cliente_id === draft.cliente) : options.unidades,
    [draft.cliente, options.unidades],
  );

  function apply(next: PapeletaFilters) {
    setDraft(next);
    router.push(`?${papeletaFilterParams(next, 1)}`);
  }
  function set<K extends keyof PapeletaFilters>(key: K, value: PapeletaFilters[K]) {
    const next = { ...draft, [key]: value };
    if (key === "cliente") next.unidad = ""; // la unidad ya no sería válida para el nuevo cliente
    apply(next);
  }
  function limpiar() {
    setDraft(EMPTY_PAPELETA_FILTERS);
    router.push("?page=1");
  }

  return <div className="section-card mb-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className="label" htmlFor="papeleta-q">Colaborador (nombre o código)</label>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8794A8]" />
          <input id="papeleta-q" className="input pl-9" value={draft.q} placeholder="Buscar…"
            onChange={e => setDraft({ ...draft, q: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") apply(draft); }}
            onBlur={() => apply(draft)} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="papeleta-cliente">Cliente</label>
        <select id="papeleta-cliente" className="input" value={draft.cliente} onChange={e => set("cliente", e.target.value)}>
          <option value="">Todos</option>
          {options.clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="papeleta-unidad">Unidad / Sede</label>
        <select id="papeleta-unidad" className="input" value={draft.unidad} onChange={e => set("unidad", e.target.value)}>
          <option value="">Todas</option>
          {unidadesDelCliente.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="papeleta-provincia">Provincia</label>
        <select id="papeleta-provincia" className="input" value={draft.provincia} onChange={e => set("provincia", e.target.value)}>
          <option value="">Todas</option>
          {options.provincias.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="papeleta-estado">Estado</label>
        <select id="papeleta-estado" className="input" value={draft.estado} onChange={e => set("estado", e.target.value as PapeletaFilters["estado"])}>
          <option value="">Todos</option>
          {PAPELETA_ESTADOS.map(estado => <option key={estado} value={estado}>{papeletaEstadoLabel[estado]}</option>)}
        </select>
      </div>
      {showCoordinador && <div>
        <label className="label" htmlFor="papeleta-coordinador">Coordinador</label>
        <select id="papeleta-coordinador" className="input" value={draft.coordinador} onChange={e => set("coordinador", e.target.value)}>
          <option value="">Todos</option>
          {options.coordinadores.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>}
      <div>
        <label className="label" htmlFor="papeleta-desde">Fecha de registro desde</label>
        <input id="papeleta-desde" type="date" className="input" value={draft.desde} onChange={e => set("desde", e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="papeleta-hasta">Fecha de registro hasta</label>
        <input id="papeleta-hasta" type="date" className="input" value={draft.hasta} onChange={e => set("hasta", e.target.value)} />
      </div>
    </div>
    <button type="button" className="btn btn-ghost mt-3 px-3" onClick={limpiar}><FilterX size={16} />Limpiar filtros</button>
  </div>;
}

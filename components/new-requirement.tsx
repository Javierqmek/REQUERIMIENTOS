"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardList, FilePlus2, Home, LoaderCircle, Plus, Search, Trash2, UserRoundSearch } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { requerimientoSchema } from "@/lib/validations";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { GarmentGenderPicker } from "@/components/garment-gender-picker";
import { RequirementTotal } from "@/components/requirement-total";
import { LoadingState } from "@/components/ui/loading-state";
import { useActiveCatalog } from "@/components/use-active-catalog";
import { genderLabel, isGenderCompatible, type GenderChoice } from "@/lib/garments/gender";
import { catalogTotal, formatMoney } from "@/lib/requirements/money";
import type { Cliente, Personal, Prenda, Unidad } from "@/lib/types";
import { createRequestId } from "@/lib/security/request-id";

export default function NewRequirement() {
  const supabase = useMemo(() => createClient(), []);
  const savingRef = useRef(false);
  const [requestId,setRequestId] = useState(createRequestId);
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [agents, setAgents] = useState<Personal[]>([]);
  const [agent, setAgent] = useState<Personal | null>(null);
  const [clientId, setClientId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [gender, setGender] = useState<GenderChoice | null>(null);
  const [pendingGender, setPendingGender] = useState<GenderChoice | null>(null);
  const [lines, setLines] = useState<Prenda[]>([]);
  const [selected, setSelected] = useState("");
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successId, setSuccessId] = useState("");
  const clients = useActiveCatalog<Cliente>(supabase, "clientes", step === 2);
  const client = clients.rows.find(c => c.id === clientId);
  const units = useActiveCatalog<Unidad>(supabase, "unidades", step === 2 && Boolean(client), { column: "cliente_id", value: clientId });
  const unit = units.rows.find(u => u.id === unitId);
  const genderValues = useMemo(() => gender ? [gender, "AMBOS"] : [], [gender]);
  const garments = useActiveCatalog<Prenda>(supabase, "prendas", step === 2 && Boolean(client && unit && gender), { column: "cliente", value: client?.nombre ?? "" }, { column: "genero", values: genderValues });
  const visibleGarments = garments.rows.filter(garment => gender && isGenderCompatible(garment.genero, gender));
  const chosen = garments.rows.find(g => g.id === selected);
  const ready = Boolean(client && unit && gender) && !garments.loading && !garments.error;
  const total = catalogTotal(lines);

  useEffect(() => {
    const controller = new AbortController();
    const term = query.trim();
    if (term.length < 2) return () => controller.abort();
    const timer = setTimeout(async () => {
      try {
        const { data, error: searchError } = await supabase.rpc("buscar_personal", { p_busqueda: term, p_limite: 20 })
          .select("id,codigo_personal,nombre,dni,cargo,activo").abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        setAgents((data ?? []) as Personal[]);
        if (searchError) setError("No pudimos realizar la búsqueda. Intenta nuevamente.");
      } catch {
        if (!controller.signal.aborted) setError("No pudimos realizar la búsqueda. Intenta nuevamente.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, supabase]);

  function clearDestination() {
    setClientId(""); setUnitId(""); setGender(null); setPendingGender(null); setLines([]); setSelected(""); setError("");
  }
  function reset() {
    if (savingRef.current) return;
    setRequestId(createRequestId());
    clearDestination(); setAgent(null); setStep(1); setSuccessId(""); setQuery(""); setAgents([]); setSearching(false);
  }
  function choose(a: Personal) {
    clearDestination(); setAgent(a); setStep(2);
  }
  function changeClient(id: string) {
    setClientId(id); setUnitId(""); setGender(null); setPendingGender(null); setLines([]); setSelected(""); setError("");
  }
  function applyGender(next: GenderChoice) {
    setGender(next);
    setLines(current => current.filter(garment => isGenderCompatible(garment.genero, next)));
    setSelected("");
    setPendingGender(null);
    setError("");
  }
  function changeGender(next: GenderChoice) {
    if (next === gender) return;
    if (lines.some(garment => !isGenderCompatible(garment.genero, next))) setPendingGender(next);
    else applyGender(next);
  }
  function add() {
    if (!ready || !chosen || savingRef.current) return;
    if (lines.some(p => p.id === chosen.id)) { setError("Esta prenda ya está agregada. La cantidad la define el maestro de prendas."); return; }
    setLines(current => [...current, chosen]); setSelected(""); setError("");
  }
  async function save() {
    if (!agent || savingRef.current) return;
    const parsed = requerimientoSchema.safeParse({
      agente_id: agent.id, cliente_id: clientId, unidad_id: unitId,
      detalles: lines.map(p => ({ prenda_id: p.id })),
    });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (!ready) { setError("Verifica el cliente y la unidad antes de guardar."); return; }
    savingRef.current = true; setSaving(true); setError("");
    try {
      const { data, error: saveError } = await supabase.rpc("crear_requerimiento", {
        p_agente_id: parsed.data.agente_id,
        p_cliente_id: parsed.data.cliente_id,
        p_unidad_id: parsed.data.unidad_id,
        p_detalles: parsed.data.detalles,
        p_request_id: requestId,
      });
      if (saveError || !data) throw saveError ?? new Error("Sin identificador");
      setSuccessId(String(data));
    } catch {
      setError("No se pudo guardar el requerimiento. Verifica que el cliente, la unidad y las prendas sigan activos. Tus selecciones se conservan para reintentar.");
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }

  if (successId) return (
    <section className="mx-auto max-w-2xl py-3 sm:py-8">
      <div className="card p-5 sm:p-7">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-emerald-50 text-[#16803C]"><CheckCircle2 size={23}/></span>
          <div><h1 className="text-xl font-semibold text-[#0B1F3A]">Requerimiento registrado</h1><p className="mt-1 text-sm text-[#607089]">El requerimiento de {agent?.nombre} fue guardado correctamente.</p></div>
        </div>
        <div className="mt-6 flex flex-col gap-2 border-t border-[#DCE3EC] pt-5 sm:flex-row sm:flex-wrap">
          <button className="btn btn-primary" onClick={reset}><FilePlus2 size={17}/>Crear otro requerimiento</button>
          <Link className="btn btn-secondary" href={`/requerimientos/${successId}`}>Ver requerimiento</Link>
          <Link className="btn btn-ghost" href="/requerimientos"><ClipboardList size={17}/>Mis requerimientos</Link>
          <Link className="btn btn-ghost sm:ml-auto" href="/inicio"><Home size={17}/>Inicio</Link>
        </div>
      </div>
    </section>
  );

  if (step === 1) return (
    <section className="mx-auto max-w-[880px]">
      <Link href="/inicio" className="btn btn-ghost mb-3 -ml-3"><ArrowLeft size={16}/>Volver al inicio</Link>
      <header className="page-header"><p className="page-eyebrow">Nuevo requerimiento · Paso 1 de 2</p><h1 className="page-title">Selecciona un agente</h1><p className="page-description">Busca al agente que recibirá las prendas.</p></header>
      <div className="section-card">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#607089]" size={18}/>
          <input autoFocus className="input !pl-11" value={query} onChange={e => { const value = e.target.value; setQuery(value); setAgents([]); setSearching(value.trim().length >= 2); setError(""); }} placeholder="Nombre, DNI o código..." aria-label="Buscar agente"/>
        </div>
        {searching && <LoadingState compact label="Buscando..."/>}
      </div>
      {error && <div className="mt-3"><Alert kind="error">{error}</Alert></div>}
      <div className="mt-3 space-y-2">
        {!searching && !error && query.trim().length >= 2 && !agents.length && <div className="rounded-xl border border-dashed border-[#DCE3EC] bg-white p-5 text-center"><UserRoundSearch className="mx-auto text-[#8794A8]" size={24}/><p className="mt-2 text-sm font-semibold text-[#172033]">No encontramos agentes con ese criterio.</p><p className="mt-1 text-xs text-[#607089]">Prueba con otro nombre, DNI o código.</p></div>}
        {agents.map(a => <button key={a.id} onClick={() => choose(a)} className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-[#DCE3EC] bg-white px-4 py-3 text-left hover:border-[#AFC1D8]"><span className="min-w-0"><strong className="block text-sm font-semibold text-[#172033]">{a.nombre}</strong><span className="mt-0.5 block text-xs text-[#607089]">DNI {a.dni} · {a.codigo_personal}</span></span><span className="text-xs font-semibold text-[#174EA6]">Seleccionar</span></button>)}
      </div>
    </section>
  );

  return (
    <section className="mx-auto max-w-[920px]">
      <button disabled={saving} onClick={reset} className="btn btn-ghost mb-3 -ml-3"><ArrowLeft size={16}/>Cambiar agente</button>
      <header className="page-header"><p className="page-eyebrow">Nuevo requerimiento · Paso 2 de 2</p><h1 className="page-title">Selecciona las prendas</h1></header>
      <div className="section-card">
        <h2 className="section-title">Datos del agente</h2>
        <dl className="mt-3 grid gap-x-8 sm:grid-cols-3">
          {[["Nombre", agent?.nombre], ["DNI", agent?.dni], ["Cargo", agent?.cargo]].map(([k, v]) => <div key={k} className="min-w-0 border-t border-[#E8EDF4] py-2.5"><dt className="text-xs font-medium text-[#607089]">{k}</dt><dd className="mt-0.5 break-words text-sm font-medium text-[#172033]">{v}</dd></div>)}
        </dl>
        <div className="mt-3 grid gap-3 border-t border-[#E8EDF4] pt-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[#45556D]" htmlFor="cliente">Cliente</label>
            <select id="cliente" className="input" value={clientId} disabled={saving || clients.loading || clients.error} onChange={e => changeClient(e.target.value)}>
              <option value="">Selecciona un cliente</option>
              {clients.rows.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            {clients.loading && <LoadingState compact label="Cargando clientes..."/>}
            {clients.error && <div className="mt-2"><Alert kind="error">No pudimos cargar los clientes.</Alert><button className="btn btn-ghost" onClick={clients.retry}>Reintentar</button></div>}
            {!clients.loading && !clients.error && !clients.rows.length && <p className="mt-2 text-sm text-[#607089]">No hay clientes activos configurados.</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[#45556D]" htmlFor="unidad">Unidad</label>
            <select id="unidad" className="input" value={unitId} disabled={saving || !client || units.loading || units.error} onChange={e => { setUnitId(e.target.value); setSelected(""); }}>
              <option value="">Selecciona una unidad</option>
              {units.rows.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
            {units.loading && <LoadingState compact label="Cargando unidades..."/>}
            {units.error && <div className="mt-2"><Alert kind="error">No pudimos cargar las unidades.</Alert><button className="btn btn-ghost" onClick={units.retry}>Reintentar</button></div>}
            {client && !units.loading && !units.error && !units.rows.length && <p className="mt-2 text-sm text-[#607089]">No hay unidades activas para este cliente.</p>}
          </div>
        </div>
        {unit && <GarmentGenderPicker value={gender} disabled={saving} onChange={changeGender}/>}
      </div>
      <div className="section-card mt-4">
        <h2 className="section-title">Prendas solicitadas</h2>
        <p className="mt-1 text-sm text-[#607089]">La cantidad de cada prenda está definida en el maestro de prendas.</p>
        {!client ? <p className="mt-3 text-sm text-[#607089]">Selecciona un cliente</p> : !unit ? <p className="mt-3 text-sm text-[#607089]">Selecciona una unidad</p> : !gender ? <p className="mt-3 text-sm text-[#607089]">Elige Hombre o Mujer para ver las prendas disponibles.</p> : garments.loading ? <LoadingState compact label="Cargando prendas..."/> : garments.error ? <div className="mt-3"><Alert kind="error">No pudimos cargar las prendas del cliente.</Alert><button className="btn btn-ghost" onClick={garments.retry}>Reintentar</button></div> : !visibleGarments.length && <p className="mt-3 text-sm text-[#607089]">No hay prendas configuradas para este cliente y género.</p>}
        <div className="mt-4 grid grid-cols-[88px_minmax(0,1fr)] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_96px_auto]">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <label className="mb-1 block text-xs font-medium text-[#607089]" htmlFor="prenda">Prenda</label>
            <select id="prenda" className="input" disabled={saving || !ready || !garments.rows.length} value={selected} onChange={e => setSelected(e.target.value)}>
              <option value="">Selecciona una prenda</option>
              {visibleGarments.map(g => <option key={g.id} value={g.id} disabled={lines.some(p => p.id === g.id)}>{g.nombre_prenda} · Cant. {g.cantidad}</option>)}
            </select>
          </div>
          <div><span id="cantidad-label" className="mb-1 block text-xs font-medium text-[#607089]">Cantidad fija</span><output aria-labelledby="cantidad-label" className="flex min-h-11 items-center rounded-lg border border-[#DCE3EC] bg-[#F8FAFD] px-3 text-sm">{chosen?.cantidad ?? "—"}</output></div>
          <button disabled={saving || !ready || !chosen} onClick={add} className="btn btn-primary"><Plus size={17}/>Agregar</button>
        </div>
        {chosen && <p className="mt-2 break-words text-xs text-[#607089]">Código {chosen.codigo_almacen} · {genderLabel(chosen.genero)} · Precio unitario S/ {Number(chosen.precio).toFixed(2)}</p>}
        <div className="mt-4 divide-y divide-[#E8EDF4] border-y border-[#E8EDF4]">
          {!lines.length ? <p className="py-4 text-center text-sm text-[#607089]">Todavía no agregaste prendas.</p> : lines.map(p => <div key={p.id} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1"><strong className="break-words text-sm font-medium text-[#172033]">{p.nombre_prenda}</strong><p className="mt-0.5 break-words text-xs text-[#607089]">{p.codigo_almacen} · {genderLabel(p.genero)} · Cantidad {p.cantidad}</p><p className="mt-0.5 text-xs text-[#607089]">Precio unitario {formatMoney(p.precio)} · Subtotal <span className="font-medium text-[#45556D]">{formatMoney(Number(p.precio) * p.cantidad)}</span></p></div><button disabled={saving} aria-label={`Eliminar ${p.nombre_prenda}`} onClick={() => setLines(x => x.filter(i => i.id !== p.id))} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#C53030] hover:bg-red-50"><Trash2 size={17}/></button></div>)}
        </div>
        <RequirementTotal count={lines.length} total={total}/>
      </div>
      {error && <div className="mt-3"><Alert kind="error">{error}</Alert></div>}
      <footer className="mt-4 flex flex-col-reverse gap-2 border-t border-[#DCE3EC] pt-4 sm:flex-row sm:justify-end">
        <button disabled={saving} onClick={reset} className="btn btn-secondary">Cancelar</button>
        <button onClick={save} disabled={saving || !ready || !lines.length} className="btn btn-primary w-full sm:w-auto">{saving ? <LoaderCircle className="animate-spin" size={17}/> : <CheckCircle2 size={17}/>} {saving ? "Guardando requerimiento..." : "Guardar requerimiento"}</button>
      </footer>
      <ConfirmDialog open={Boolean(pendingGender)} busy={false} intent="warning"
        title="¿Cambiar el género de las prendas?"
        description="Al cambiar el género se quitarán las prendas que ya no correspondan. Las prendas unisex se mantendrán."
        confirmLabel="Sí, continuar" onCancel={() => setPendingGender(null)}
        onConfirm={() => pendingGender && applyGender(pendingGender)}/>
    </section>
  );
}

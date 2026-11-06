"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ATTENDED_MESSAGE, canEditRequirement, initialEditLines, newEditLine, type EditPayload, type HeaderLine } from "@/lib/requirements/edit";
import type { Cargo, Profile } from "@/lib/types";
import { RequirementFacts } from "@/components/requirement-facts";
import { StatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { LoadingState } from "@/components/ui/loading-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { GarmentGenderPicker } from "@/components/garment-gender-picker";
import { RenovacionPicker } from "@/components/renovacion-picker";
import { useActiveCatalog } from "@/components/use-active-catalog";
import { RequirementTotal } from "@/components/requirement-total";
import { useClientGarments } from "@/components/use-client-garments";
import { genderLabel, inferGender, isGenderCompatible, type GenderChoice } from "@/lib/garments/gender";
import { garmentChoices, garmentFits, renovacionLabel, type Renovacion } from "@/lib/garments/renovacion";
import { catalogTotal, formatMoney } from "@/lib/requirements/money";

export function EditRequirement({ initial, profile }: { initial: EditPayload; profile: Profile }) {
  const [payload, setPayload] = useState(initial);
  const row = payload.requerimiento;
  const router = useRouter();
  const allowed = canEditRequirement(profile, row);
  const db = useMemo(() => createClient(), []);
  const [lines, setLines] = useState(() => initialEditLines(row));
  const [gender, setGender] = useState<GenderChoice | null>(() => inferGender(initialEditLines(row).map(line => line.genero)));
  const [pendingGender, setPendingGender] = useState<GenderChoice | null>(null);
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const savingRef = useRef(false);
  // Datos editables de la cabecera: SOLO renovación y cargo (se guardan aparte de las prendas).
  const cargos = useActiveCatalog<Cargo>(db, "cargos", allowed);
  const currentCargo = row.personal?.cargo ?? "";
  const [hdrRen, setHdrRen] = useState<Renovacion>(row.renovacion);
  const [hdrCargo, setHdrCargo] = useState(currentCargo);
  const [hdrBusy, setHdrBusy] = useState(false);
  const [hdrError, setHdrError] = useState("");
  const [hdrOk, setHdrOk] = useState("");
  const [pendingHdr, setPendingHdr] = useState<{ lineas: HeaderLine[] } | null>(null);
  const hdrRef = useRef(false);
  const cargoOptions = [...cargos.rows.map(c => c.nombre), ...(currentCargo && !cargos.rows.some(c => c.nombre === currentCargo) ? [currentCargo] : [])];
  const renChanged = hdrRen !== row.renovacion, cargoChanged = hdrCargo !== currentCargo && hdrCargo !== "";
  // La renovación del requerimiento no se edita: solo prendas asignadas a su cliente para esa renovación (o AMBOS).
  const garments = useClientGarments(db, allowed && Boolean(row.cliente_id && row.clientes?.nombre && gender) && !success, row.cliente_id, row.renovacion, row.puesto_id ?? null);
  const visibleGarments = garments.rows.filter(garment => gender && garmentFits(garment, row.renovacion, gender));
  const choices = garmentChoices(visibleGarments, lines.map(line => line.prenda_id));
  const chosen = visibleGarments.find(p => p.id === selected);
  const disabled = saving || conflict;
  const total = catalogTotal(lines);
  function add() {
    if (!chosen || disabled || lines.some(l => l.prenda_id === chosen.id)) return;
    setLines(current => [...current, newEditLine(chosen)]); setSelected(""); setError("");
  }
  function applyGender(next: GenderChoice) {
    setGender(next);
    setLines(current => current.filter(line => isGenderCompatible(line.genero, next)));
    setSelected("");
    setPendingGender(null);
    setError("");
  }
  function changeGender(next: GenderChoice) {
    if (next === gender) return;
    if (lines.some(line => !isGenderCompatible(line.genero, next))) setPendingGender(next);
    else applyGender(next);
  }
  const linesDirty = JSON.stringify(lines.map(line => line.prenda_id)) !== JSON.stringify(initialEditLines(row).map(line => line.prenda_id));
  async function saveHeader(confirmed?: string[]) {
    if (hdrRef.current || !allowed || (!renChanged && !cargoChanged)) return;
    hdrRef.current = true; setHdrBusy(true); setHdrError(""); setHdrOk("");
    try {
      const response = await fetch(`/api/requerimientos/${row.id}/cabecera`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(renChanged ? { renovacion: hdrRen } : {}), ...(cargoChanged ? { cargo: hdrCargo } : {}), ...(confirmed ? { lineas_confirmadas: confirmed } : {}) }) });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Tu sesión pudo haber caducado. Vuelve a iniciar sesión antes de guardar.");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No pudimos guardar los cambios.");
      if (result.requiere_confirmacion) { setPendingHdr({ lineas: result.lineas as HeaderLine[] }); return; }
      const next = result.data as EditPayload | undefined;
      if (!next?.requerimiento || next.requerimiento.id !== row.id) throw new Error("No pudimos confirmar los datos persistidos. Recarga el requerimiento.");
      setPayload(next); setPendingHdr(null);
      const nextLines = initialEditLines(next.requerimiento);
      setLines(nextLines); setGender(inferGender(nextLines.map(line => line.genero))); setSelected("");
      setHdrRen(next.requerimiento.renovacion); setHdrCargo(next.requerimiento.personal?.cargo ?? "");
      setHdrOk(nextLines.length ? "Datos actualizados correctamente." : "Datos actualizados. El requerimiento quedó sin prendas: agrega prendas de la nueva renovación y guarda.");
    } catch (cause) { setPendingHdr(null); setHdrError(cause instanceof Error ? cause.message : "No pudimos guardar los cambios. Intenta nuevamente."); }
    finally { hdrRef.current = false; setHdrBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current || !allowed || conflict || !lines.length) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/requerimientos/${row.id}/prendas`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: payload.version, ...(gender ? { genero: gender } : {}), detalles: lines.map(l => ({ prenda_id: l.prenda_id, ...(l.detalle_id ? { detalle_id: l.detalle_id } : {}) })) }) });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Tu sesión pudo haber caducado. Vuelve a iniciar sesión antes de guardar.");
      const result = await response.json();
      if (!response.ok) { if (response.status === 409) setConflict(true); throw new Error(result.error || "No pudimos guardar los cambios."); }
      if (!result.data?.requerimiento || result.data.requerimiento.id !== row.id) throw new Error("No pudimos confirmar los datos persistidos. Recarga el requerimiento.");
      setSuccess(true);
      router.replace(`/requerimientos/${row.id}`);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos guardar los cambios. Intenta nuevamente."); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <section className="mx-auto max-w-[920px]">
    {!saving && <Link className="btn btn-ghost mb-3 -ml-3" href={`/requerimientos/${row.id}`}><ArrowLeft size={16}/>Volver al detalle</Link>}
    <div className="page-header flex flex-wrap items-start justify-between gap-3"><div><p className="page-eyebrow">Requerimiento</p><h1 className="page-title">Editar prendas</h1></div><StatusBadge estado={row.estado}/></div>
    <RequirementFacts row={row}/>
    {!allowed ? <div className="mt-4"><Alert kind="warning">{row.estado === "Atendido" ? ATTENDED_MESSAGE : "No tienes permiso para editar este requerimiento."}</Alert></div> : success ?
      <div className="section-card mt-4"><Alert kind="success">Prendas actualizadas correctamente.</Alert><p className="mt-3 text-sm text-[#607089]">Las líneas retiradas se conservaron como historial.</p><Link href={`/requerimientos/${row.id}`} className="btn btn-secondary mt-4">Ver requerimiento</Link></div> :
      <>
      <section className="section-card mt-4" aria-labelledby="cabecera-title" aria-busy={hdrBusy}>
        <h2 id="cabecera-title" className="section-title">Renovación y cargo</h2>
        <p className="mt-1 text-sm text-[#607089]">Es lo único de la cabecera que se puede cambiar mientras el requerimiento esté Pendiente u Observado. Cambiar el cargo también lo actualiza en la ficha del trabajador.</p>
        <RenovacionPicker value={hdrRen} disabled={hdrBusy || saving} onChange={setHdrRen}/>
        <div className="mt-4 grid max-w-sm gap-1">
          <label className="text-sm font-medium text-[#45556D]" htmlFor="edit-cargo">Cargo del agente</label>
          <select id="edit-cargo" className="input" value={hdrCargo} disabled={hdrBusy || saving || cargos.loading || cargos.error} onChange={event => setHdrCargo(event.target.value)}>
            {!currentCargo && <option value="">Selecciona un cargo</option>}
            {cargoOptions.map(name => <option key={name} value={name}>{name}{cargos.rows.some(c => c.nombre === name) ? "" : " (inactivo)"}</option>)}
          </select>
          {cargos.error && <p className="text-xs text-[#C53030]">No pudimos cargar los cargos.</p>}
        </div>
        {linesDirty && (renChanged || cargoChanged) && <p className="mt-3 text-xs text-[#B45309]">Tienes cambios de prendas sin guardar: guárdalos o recarga la página antes de cambiar la renovación o el cargo.</p>}
        {hdrError && <div className="mt-3"><Alert kind="error">{hdrError}</Alert></div>}
        {hdrOk && <div className="mt-3"><Alert kind="success">{hdrOk}</Alert></div>}
        <div className="mt-4 flex justify-end"><button type="button" className="btn btn-secondary" disabled={hdrBusy || saving || linesDirty || (!renChanged && !cargoChanged)} onClick={() => void saveHeader()}>{hdrBusy ? <LoaderCircle size={17} className="animate-spin"/> : <CheckCircle2 size={17}/>} {hdrBusy ? "Guardando..." : "Guardar renovación y cargo"}</button></div>
      </section>
      <form onSubmit={save} className="mt-4" aria-busy={saving}>
        <section className="section-card">
          <h2 className="section-title">Prendas solicitadas</h2><p className="mt-1 text-sm text-[#607089]">Puedes agregar o retirar prendas de la renovación {renovacionLabel(row.renovacion)}. Cada prenda se agrega una sola vez y la cantidad es fija; las prendas conservadas mantienen su precio y código históricos.</p>
          {row.clientes && <GarmentGenderPicker value={gender} disabled={disabled} onChange={changeGender}/>}
          {!row.clientes ? <p className="mt-3 text-sm text-[#607089]">Este requerimiento histórico no tiene cliente. Puedes conservar o retirar líneas, pero no agregar prendas.</p> : !gender ? <p className="mt-3 text-sm text-[#607089]">Elige Hombre o Mujer para filtrar las prendas que puedes agregar.</p> : garments.loading ? <LoadingState compact label="Cargando prendas..."/> : garments.error ? <div className="mt-3"><Alert kind="error">No pudimos cargar las prendas del cliente.</Alert><button type="button" onClick={garments.retry} className="btn btn-ghost">Reintentar</button></div> : !visibleGarments.length && <p className="mt-3 text-sm text-[#607089]">No hay prendas configuradas para este cliente, renovación y género.</p>}
          <div className="mt-4 grid grid-cols-[88px_minmax(0,1fr)] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_96px_auto]">
            <div className="col-span-2 min-w-0 sm:col-span-1"><label htmlFor="edit-prenda" className="mb-1 block text-xs font-medium text-[#607089]">Prenda</label><select id="edit-prenda" className="input" value={selected} disabled={disabled || garments.loading || garments.error || !garments.rows.length} onChange={event => setSelected(event.target.value)}>
              <option value="">Selecciona una prenda</option>{choices.map(({ garment: p, added }) => <option key={p.id} value={p.id} disabled={added} className={added ? "text-[#8794A8] line-through" : undefined}>{p.nombre_prenda} · Cant. {p.cantidad}{added ? " · Ya agregada" : ""}</option>)}
            </select></div>
            <div><span id="fixed-quantity" className="mb-1 block text-xs font-medium text-[#607089]">Cantidad fija</span><output aria-labelledby="fixed-quantity" className="flex min-h-11 items-center rounded-lg border border-[#DCE3EC] bg-[#F5F8FD] px-3 text-sm">{chosen?.cantidad ?? "—"}</output></div>
            <button type="button" onClick={add} disabled={disabled || !chosen || lines.some(l => l.prenda_id === chosen.id)} className="btn btn-secondary"><Plus size={17}/>Agregar</button>
          </div>
          <div className="mt-4 divide-y divide-[#E8EDF4] border-y border-[#E8EDF4]">{lines.length ? lines.map(line => <div key={line.prenda_id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-[#172033]">{line.nombre}</p><p className="mt-0.5 break-words text-xs text-[#607089]">{line.codigo} · {genderLabel(line.genero)} · Cantidad {line.cantidad}</p><p className="mt-0.5 text-xs text-[#607089]">Precio unitario {formatMoney(line.precio)} · Subtotal <span className="font-medium text-[#45556D]">{formatMoney(line.precio * line.cantidad)}</span></p></div>
            <button type="button" disabled={disabled} aria-label={`Retirar ${line.nombre}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#C53030] hover:bg-red-50 disabled:opacity-50" onClick={() => setLines(current => current.filter(l => l.prenda_id !== line.prenda_id))}><Trash2 size={17}/></button>
          </div>) : <p className="py-4 text-sm text-[#607089]">Agrega al menos una prenda para guardar los cambios.</p>}</div>
          <RequirementTotal count={lines.length} total={total}/>
          <p className="mt-3 text-xs text-[#607089]">Retirar una prenda conserva su historial. Volver a agregarla crea una nueva línea con los valores actuales del maestro.</p>
        </section>
        {error && <div className="mt-3"><Alert kind="error">{error}</Alert>{conflict && <button type="button" className="btn btn-ghost" onClick={() => window.location.reload()}>Recargar datos</button>}</div>}
        <footer className="mt-4 flex flex-col-reverse gap-2 border-t border-[#DCE3EC] pt-4 sm:flex-row sm:justify-end">
          {saving ? <button type="button" disabled className="btn btn-secondary">Cancelar</button> : <Link href={`/requerimientos/${row.id}`} className="btn btn-secondary">Cancelar</Link>}
          <button type="submit" disabled={disabled || !lines.length} className="btn btn-primary w-full sm:w-auto">{saving ? <LoaderCircle size={17} className="animate-spin"/> : <CheckCircle2 size={17}/>} {saving ? "Guardando cambios..." : "Guardar cambios"}</button>
        </footer>
      </form></>}
    <ConfirmDialog open={Boolean(pendingHdr)} busy={hdrBusy} intent="warning"
      title="¿Quitar las prendas que no corresponden a la nueva renovación?"
      description={`Estas prendas no están asignadas a este cliente para la renovación ${renovacionLabel(hdrRen)} (ni son Ambos) y se desactivarán; se conservan como historial: ${(pendingHdr?.lineas ?? []).map(line => `${line.nombre} (${line.codigo})`).join(", ")}.`}
      confirmLabel="Sí, cambiar y quitar" onCancel={() => setPendingHdr(null)}
      onConfirm={() => void saveHeader((pendingHdr?.lineas ?? []).map(line => line.id))}/>
    <ConfirmDialog open={Boolean(pendingGender)} busy={false} intent="warning"
      title="¿Cambiar el género de las prendas?"
      description="Al cambiar el género se quitarán las prendas que ya no correspondan. Las prendas unisex se mantendrán."
      confirmLabel="Sí, continuar" onCancel={() => setPendingGender(null)}
      onConfirm={() => pendingGender && applyGender(pendingGender)}/>
  </section>;
}

"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ATTENDED_MESSAGE, canEditRequirement, initialEditLines, newEditLine, type EditPayload } from "@/lib/requirements/edit";
import type { Prenda, Profile } from "@/lib/types";
import { RequirementFacts } from "@/components/requirement-facts";
import { StatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { LoadingState } from "@/components/ui/loading-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { GarmentGenderPicker } from "@/components/garment-gender-picker";
import { RequirementTotal } from "@/components/requirement-total";
import { useActiveCatalog } from "@/components/use-active-catalog";
import { genderLabel, inferGender, isGenderCompatible, type GenderChoice } from "@/lib/garments/gender";
import { catalogTotal, formatMoney } from "@/lib/requirements/money";

export function EditRequirement({ initial, profile }: { initial: EditPayload; profile: Profile }) {
  const row = initial.requerimiento;
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
  const genderValues = useMemo(() => gender ? [gender, "AMBOS"] : [], [gender]);
  const garments = useActiveCatalog<Prenda>(db, "prendas", allowed && Boolean(row.clientes?.nombre && gender) && !success,
    { column: "cliente", value: row.clientes?.nombre ?? "" }, { column: "genero", values: genderValues });
  const visibleGarments = garments.rows.filter(garment => gender && isGenderCompatible(garment.genero, gender));
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
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current || !allowed || conflict || !lines.length) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/requerimientos/${row.id}/prendas`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: initial.version, detalles: lines.map(l => ({ prenda_id: l.prenda_id, ...(l.detalle_id ? { detalle_id: l.detalle_id } : {}) })) }) });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Tu sesión pudo haber caducado. Vuelve a iniciar sesión antes de guardar.");
      const result = await response.json();
      if (!response.ok) { if (response.status === 409) setConflict(true); throw new Error(result.error || "No pudimos guardar los cambios."); }
      setSuccess(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos guardar los cambios. Intenta nuevamente."); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <section className="mx-auto max-w-[920px]">
    {!saving && <Link className="btn btn-ghost mb-3 -ml-3" href={`/requerimientos/${row.id}`}><ArrowLeft size={16}/>Volver al detalle</Link>}
    <div className="page-header flex flex-wrap items-start justify-between gap-3"><div><p className="page-eyebrow">Requerimiento</p><h1 className="page-title">Editar prendas</h1></div><StatusBadge estado={row.estado}/></div>
    <RequirementFacts row={row}/>
    {!allowed ? <div className="mt-4"><Alert kind="warning">{row.estado === "Atendido" ? ATTENDED_MESSAGE : "No tienes permiso para editar este requerimiento."}</Alert></div> : success ?
      <div className="section-card mt-4"><Alert kind="success">Prendas actualizadas correctamente.</Alert><p className="mt-3 text-sm text-[#607089]">Las líneas retiradas se conservaron como historial.</p><Link href={`/requerimientos/${row.id}`} className="btn btn-secondary mt-4">Ver requerimiento</Link></div> :
      <form onSubmit={save} className="mt-4" aria-busy={saving}>
        <section className="section-card">
          <h2 className="section-title">Prendas solicitadas</h2><p className="mt-1 text-sm text-[#607089]">Puedes agregar o retirar prendas. La cantidad es fija; las prendas conservadas mantienen su precio y código históricos.</p>
          {row.clientes && <GarmentGenderPicker value={gender} disabled={disabled} onChange={changeGender}/>}
          {!row.clientes ? <p className="mt-3 text-sm text-[#607089]">Este requerimiento histórico no tiene cliente. Puedes conservar o retirar líneas, pero no agregar prendas.</p> : !gender ? <p className="mt-3 text-sm text-[#607089]">Elige Hombre o Mujer para filtrar las prendas que puedes agregar.</p> : garments.loading ? <LoadingState compact label="Cargando prendas..."/> : garments.error ? <div className="mt-3"><Alert kind="error">No pudimos cargar las prendas del cliente.</Alert><button type="button" onClick={garments.retry} className="btn btn-ghost">Reintentar</button></div> : !visibleGarments.length && <p className="mt-3 text-sm text-[#607089]">No hay prendas configuradas para este cliente y género.</p>}
          <div className="mt-4 grid grid-cols-[88px_minmax(0,1fr)] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_96px_auto]">
            <div className="col-span-2 min-w-0 sm:col-span-1"><label htmlFor="edit-prenda" className="mb-1 block text-xs font-medium text-[#607089]">Prenda</label><select id="edit-prenda" className="input" value={selected} disabled={disabled || garments.loading || garments.error || !garments.rows.length} onChange={event => setSelected(event.target.value)}>
              <option value="">Selecciona una prenda</option>{visibleGarments.map(p => <option key={p.id} value={p.id} disabled={lines.some(l => l.prenda_id === p.id)}>{p.nombre_prenda} · Cant. {p.cantidad}</option>)}
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
      </form>}
    <ConfirmDialog open={Boolean(pendingGender)} busy={false} intent="warning"
      title="¿Cambiar el género de las prendas?"
      description="Al cambiar el género se quitarán las prendas que ya no correspondan. Las prendas unisex se mantendrán."
      confirmLabel="Sí, continuar" onCancel={() => setPendingGender(null)}
      onConfirm={() => pendingGender && applyGender(pendingGender)}/>
  </section>;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, MessageSquareWarning, X } from "lucide-react";
import { Alert } from "./ui/alert";

function ObserveDialog({ open, busy, motivo, onMotivo, onCancel, onConfirm }: {
  open: boolean; busy: boolean; motivo: string; onMotivo: (value: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    function close(event: KeyboardEvent) { if (event.key === "Escape" && !busy) onCancel(); }
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, busy, onCancel]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#0B1F3A]/40 p-4" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) onCancel(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="observe-title" className="w-full max-w-md rounded-xl border border-[#DCE3EC] bg-white p-5 shadow-[0_18px_48px_rgba(11,31,58,.18)]">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="observe-title" className="text-lg font-semibold text-[#0B1F3A]">Observar papeleta</h2><p className="mt-1 text-sm text-[#607089]">El coordinador verá este motivo y podrá corregir la papeleta.</p></div>
        <button className="rounded-lg p-2 text-[#607089] hover:bg-[#F5F8FD]" onClick={onCancel} disabled={busy} aria-label="Cerrar"><X size={18} /></button>
      </div>
      <label className="label mt-5" htmlFor="motivo-observacion">Motivo de observación</label>
      <textarea autoFocus id="motivo-observacion" value={motivo} onChange={e => onMotivo(e.target.value)} maxLength={1000}
        className="input min-h-28 resize-y py-3" placeholder="Explica claramente qué debe corregir el coordinador." />
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancelar</button>
        <button className="btn btn-danger" disabled={busy || !motivo.trim()} onClick={onConfirm}>{busy && <LoaderCircle className="animate-spin" size={16} />} Observar</button>
      </div>
    </section>
  </div>;
}

export function VacationReviewActions({ papeletaId }: { papeletaId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [observing, setObserving] = useState(false);
  const [motivo, setMotivo] = useState("");

  async function send(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/documentos/vacaciones/${papeletaId}/revisar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo completar la acción.");
      setObserving(false); setMotivo("");
      router.refresh();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="section-card">
    <h2 className="section-title">Revisión</h2>
    <p className="mt-1 text-sm text-[#607089]">Como administrador o gerente, puedes marcar esta papeleta conforme o devolverla con un motivo de observación.</p>
    {error && <div className="mt-3"><Alert kind="error">{error}</Alert></div>}
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      <button className="btn btn-secondary" disabled={busy} onClick={() => { setError(""); setObserving(true); }}><MessageSquareWarning size={17} />Observar</button>
      <button className="btn btn-primary" disabled={busy} onClick={() => void send({ accion: "conforme" })}>{busy ? <LoaderCircle className="animate-spin" size={17} /> : <CheckCircle2 size={17} />} Marcar conforme</button>
    </div>
    <ObserveDialog open={observing} busy={busy} motivo={motivo} onMotivo={setMotivo}
      onCancel={() => { if (!busy) { setObserving(false); setMotivo(""); } }}
      onConfirm={() => void send({ accion: "observar", motivo })} />
  </div>;
}

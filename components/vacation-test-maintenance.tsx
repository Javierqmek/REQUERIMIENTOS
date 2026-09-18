"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Trash2, X } from "lucide-react";
import { Alert } from "./ui/alert";

type Row = { id: string; colaborador_nombre: string; colaborador_codigo: string; estado: string; created_at: string };
const CONFIRM_WORD = "ELIMINAR";

// Borrado FÍSICO controlado: solo llega aquí lo que un admin ya marcó explícitamente como
// es_prueba=true (ver VacationTestToggle) -- la RPC ya no exige ningún estado en particular:
// REGISTRADO, OBSERVADO, CONFORME (histórico) o FIRMADO son todos borrables si son de prueba.
// Confirmación fuerte: hay que escribir la palabra ELIMINAR, no basta un solo clic.
function ConfirmWordDialog({ open, busy, count, word, onWord, onCancel, onConfirm }: {
  open: boolean; busy: boolean; count: number; word: string; onWord: (value: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#0B1F3A]/40 p-4" role="presentation" onMouseDown={e => { if (e.currentTarget === e.target && !busy) onCancel(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="confirm-eliminar-title" className="w-full max-w-sm rounded-xl border border-[#DCE3EC] bg-white p-5 shadow-[0_18px_48px_rgba(11,31,58,.18)]">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="confirm-eliminar-title" className="text-lg font-semibold text-[#0B1F3A]">Eliminar papeletas de prueba</h2>
          <p className="mt-1 text-sm text-[#607089]">Vas a borrar permanentemente {count} papeleta(s) de prueba, todas sus versiones, metadatos de firma y archivos en Storage. No se puede deshacer.</p></div>
        <button className="rounded-lg p-2 text-[#607089] hover:bg-[#F5F8FD]" onClick={onCancel} disabled={busy} aria-label="Cerrar"><X size={18} /></button>
      </div>
      <label className="label mt-5" htmlFor="confirm-eliminar-word">Escribe <strong>{CONFIRM_WORD}</strong> para confirmar</label>
      <input autoFocus id="confirm-eliminar-word" className="input" value={word} onChange={e => onWord(e.target.value)} placeholder={CONFIRM_WORD} />
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancelar</button>
        <button className="btn btn-danger" disabled={busy || word.trim().toUpperCase() !== CONFIRM_WORD} onClick={onConfirm}>{busy && <LoaderCircle className="animate-spin" size={16} />} Eliminar definitivamente</button>
      </div>
    </section>
  </div>;
}

export function VacationTestMaintenance({ rows, allowed }: { rows: Row[]; allowed: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  function toggle(id: string) {
    setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function remove() {
    setBusy(true); setError(""); setResult("");
    try {
      const response = await fetch("/api/documentos/vacaciones/prueba", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...selected] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron eliminar las papeletas.");
      setResult(`Se eliminaron ${data.eliminados} papeleta(s) y ${data.archivos_borrados} archivo(s) de Storage.`
        + (data.archivos_pendientes ? ` ${data.archivos_pendientes} archivo(s) no se pudieron borrar de Storage y quedaron pendientes de reintento (ver arriba).` : ""));
      setSelected(new Set()); setConfirming(false); setWord("");
      router.refresh();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "No se pudieron eliminar las papeletas.");
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) return <Alert kind="warning">El borrado de papeletas de prueba está deshabilitado en este entorno (ALLOW_TEST_PAPELETA_DELETION).</Alert>;
  if (!rows.length) return <p className="text-sm text-[#607089]">No hay papeletas marcadas como prueba pendientes de eliminar.</p>;

  return <div>
    {error && <div className="mb-3"><Alert kind="error">{error}</Alert></div>}
    {result && <div className="mb-3"><Alert kind="success">{result}</Alert></div>}
    <div className="divide-y divide-[#E8EDF4] border-y border-[#E8EDF4]">
      {rows.map(row => <label key={row.id} className="flex items-center gap-3 py-2.5 text-sm">
        <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
        <span className="min-w-0 flex-1 truncate">{row.colaborador_nombre} ({row.colaborador_codigo}) · {row.estado} · {new Intl.DateTimeFormat("es-PE", { dateStyle: "medium" }).format(new Date(row.created_at))}</span>
      </label>)}
    </div>
    <button className="btn btn-danger mt-4" disabled={busy || selected.size === 0} onClick={() => setConfirming(true)}>
      {busy ? <LoaderCircle className="animate-spin" size={17} /> : <Trash2 size={17} />} Eliminar {selected.size || ""} papeleta(s) de prueba
    </button>
    <ConfirmWordDialog open={confirming} busy={busy} count={selected.size} word={word} onWord={setWord}
      onCancel={() => { if (!busy) { setConfirming(false); setWord(""); } }} onConfirm={remove} />
  </div>;
}

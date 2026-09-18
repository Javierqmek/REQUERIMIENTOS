"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Alert } from "./ui/alert";
import { ConfirmDialog } from "./ui/confirm-dialog";

type Row = { id: string; colaborador_nombre: string; colaborador_codigo: string; estado: string; created_at: string };

// Borrado FÍSICO controlado: solo llega aquí lo que un admin ya marcó explícitamente como
// es_prueba=true (ver VacationTestToggle) y que nunca esté FIRMADO -- ambas reglas también las
// aplica la RPC en el servidor, esto es solo la interfaz. Confirmación fuerte obligatoria.
export function VacationTestMaintenance({ rows, allowed }: { rows: Row[]; allowed: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
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
      setSelected(new Set()); setConfirming(false);
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
    <ConfirmDialog open={confirming} busy={busy} intent="danger" context="delete" title="Eliminar papeletas de prueba"
      description="Esta acción borra permanentemente las papeletas seleccionadas, todas sus versiones y sus archivos PDF en Storage. No se puede deshacer."
      confirmLabel="Eliminar definitivamente" onCancel={() => { if (!busy) setConfirming(false); }} onConfirm={remove} />
  </div>;
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Unlink } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Agente { id: string; nombre: string; dni: string; codigo_personal: string; email: string | null }

export function AgentesVinculadosList({ agentes }: { agentes: Agente[] }) {
  const router = useRouter();
  const [objetivo, setObjetivo] = useState<Agente | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirmarDesvinculacion() {
    if (!objetivo) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/capacitaciones/agentes/${objetivo.id}/desvincular`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo desvincular.");
      setObjetivo(null);
      router.refresh();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "No se pudo desvincular.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid gap-2.5">
    {error && !objetivo && <Alert kind="error">{error}</Alert>}
    {agentes.map(a => <div key={a.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[#0B1F3A]">{a.nombre}</p>
        <p className="truncate text-xs text-[#607089]">DNI {a.dni} · Código {a.codigo_personal}{a.email ? ` · ${a.email}` : " · sin correo registrado"}</p>
      </div>
      <button className="btn btn-secondary shrink-0" onClick={() => { setError(""); setObjetivo(a); }}><Unlink size={16} />Desvincular</button>
    </div>)}
    <ConfirmDialog
      open={objetivo !== null}
      busy={busy}
      error={error}
      onCancel={() => { if (!busy) { setObjetivo(null); setError(""); } }}
      onConfirm={confirmarDesvinculacion}
      title={`¿Desvincular a ${objetivo?.nombre ?? ""}?`}
      description="Su cuenta de Google deja de tener acceso a Capacitaciones y podrá volver a vincularse ingresando su DNI, desde la misma u otra cuenta."
      confirmLabel="Sí, desvincular"
      intent="warning"
      context="delete"
    />
  </div>;
}

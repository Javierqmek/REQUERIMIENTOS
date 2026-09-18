"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Alert } from "./ui/alert";

type Pending = { archivo_path: string; intentos: number; ultimo_error: string | null };

// PostgreSQL y Supabase Storage no comparten transacción: cuando un borrado de prueba confirma en
// BD pero Storage falla en eliminar uno o varios PDFs, la ruta queda registrada aquí (nunca se
// pierde en silencio) hasta que un reintento la confirme eliminada.
export function VacationStoragePendingCleanup({ pending }: { pending: Pending[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function retry() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/documentos/vacaciones/prueba/reintentar-storage", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo reintentar la limpieza.");
      setMessage(`Reintento: ${data.archivos_borrados} archivo(s) confirmados, ${data.archivos_pendientes} siguen pendientes.`);
      router.refresh();
    } catch (ex) {
      setMessage(ex instanceof Error ? ex.message : "No se pudo reintentar la limpieza.");
    } finally {
      setBusy(false);
    }
  }

  if (!pending.length) return null;
  return <div className="section-card mb-4 border-amber-200">
    <h2 className="section-title">Limpieza de Storage pendiente ({pending.length})</h2>
    <p className="mt-1 text-xs leading-5 text-[#607089]">Estas papeletas ya se eliminaron de la base de datos, pero su PDF todavía no se pudo borrar de Storage. No son archivos huérfanos invisibles: quedan aquí hasta reintentar con éxito.</p>
    <ul className="mt-3 grid gap-1 text-xs text-[#607089]">
      {pending.map(row => <li key={row.archivo_path} className="truncate">{row.archivo_path} · {row.intentos} intento(s){row.ultimo_error ? ` · último error: ${row.ultimo_error}` : ""}</li>)}
    </ul>
    {message && <div className="mt-3"><Alert kind={message.includes("No se pudo") ? "error" : "success"}>{message}</Alert></div>}
    <button className="btn btn-secondary mt-3" disabled={busy} onClick={retry}>
      {busy ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />} Reintentar limpieza de Storage
    </button>
  </div>;
}

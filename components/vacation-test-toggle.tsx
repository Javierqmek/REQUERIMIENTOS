"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, LoaderCircle } from "lucide-react";
import { Alert } from "./ui/alert";

// Marcado EXPLÍCITO de "es de prueba", exclusivo de admin. Nunca se infiere por nombre: esta es
// la ÚNICA puerta de entrada al borrado controlado de pruebas (ver /documentos/vacaciones/mantenimiento).
export function VacationTestToggle({ papeletaId, esPrueba, firmado }: { papeletaId: string; esPrueba: boolean; firmado: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/documentos/vacaciones/${papeletaId}/prueba`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ es_prueba: !esPrueba }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo actualizar.");
      router.refresh();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "No se pudo actualizar.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="section-card">
    <h2 className="section-title flex items-center gap-2"><FlaskConical size={16} />Dato de prueba</h2>
    <p className="mt-1 text-xs leading-5 text-[#607089]">Marca esta papeleta como prueba para habilitar su borrado controlado en Mantenimiento. Nunca se infiere automáticamente.</p>
    {error && <div className="mt-2"><Alert kind="error">{error}</Alert></div>}
    <button className="btn btn-secondary mt-3 w-full" disabled={busy || firmado} onClick={toggle}>
      {busy && <LoaderCircle className="animate-spin" size={16} />} {esPrueba ? "Desmarcar como prueba" : "Marcar como prueba"}
    </button>
    {firmado && <p className="mt-2 text-xs text-[#607089]">Una papeleta firmada no puede marcarse como prueba.</p>}
  </div>;
}

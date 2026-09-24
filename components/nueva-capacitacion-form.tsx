"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";
import { Alert } from "./ui/alert";

export function NuevaCapacitacionForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(formData: FormData) {
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/capacitaciones", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: formData.get("titulo"), descripcion: formData.get("descripcion") || null,
          porcentaje_minimo_visto: Number(formData.get("porcentaje_minimo_visto") || 80),
          nota_minima: Number(formData.get("nota_minima") || 3),
          fecha_vencimiento: formData.get("fecha_vencimiento") || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear la capacitación.");
      router.push(`/capacitaciones/gestion/${data.id}`);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "No se pudo crear la capacitación.");
      setBusy(false);
    }
  }
  return <form action={submit} className="section-card space-y-4">
    <div><label className="label" htmlFor="titulo">Título</label><input className="input" id="titulo" name="titulo" required minLength={3} maxLength={200} placeholder="Uso correcto del equipo de protección personal" /></div>
    <div><label className="label" htmlFor="descripcion">Descripción (opcional)</label><textarea className="input min-h-24 resize-y py-3" id="descripcion" name="descripcion" maxLength={2000} /></div>
    <div className="grid gap-4 sm:grid-cols-3">
      <div><label className="label" htmlFor="porcentaje_minimo_visto">% mínimo del video</label><input className="input" id="porcentaje_minimo_visto" name="porcentaje_minimo_visto" type="number" min={1} max={100} defaultValue={80} /></div>
      <div><label className="label" htmlFor="nota_minima">Nota mínima (aciertos)</label><input className="input" id="nota_minima" name="nota_minima" type="number" min={0} defaultValue={3} /></div>
      <div><label className="label" htmlFor="fecha_vencimiento">Vence (opcional)</label><input className="input" id="fecha_vencimiento" name="fecha_vencimiento" type="date" /></div>
    </div>
    {error && <Alert kind="error">{error}</Alert>}
    <button className="btn btn-primary" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={17} /> : <Plus size={17} />}Crear (queda en borrador)</button>
  </form>;
}

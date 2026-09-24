"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, Send, XCircle } from "lucide-react";
import { Alert } from "./ui/alert";
import type { ExamenPregunta, ExamenResultado } from "@/lib/capacitaciones/types";

export function ExamenForm({ capacitacionId, preguntas }: { capacitacionId: string; preguntas: ExamenPregunta[] }) {
  const router = useRouter();
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<ExamenResultado | null>(null);
  const completo = preguntas.every(p => respuestas[p.id]);

  async function enviar() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/capacitaciones/${capacitacionId}/examen`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respuestas: preguntas.map(p => ({ pregunta_id: p.id, opcion_id: respuestas[p.id] })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo enviar el examen.");
      setResultado(data as ExamenResultado);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "No se pudo enviar el examen.");
    } finally {
      setBusy(false);
    }
  }

  if (resultado) return <div className="section-card text-center">
    <div className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${resultado.aprobado ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-[#C53030]"}`}>
      {resultado.aprobado ? <CheckCircle2 size={30} /> : <XCircle size={30} />}
    </div>
    <h2 className="mt-4 text-2xl font-semibold text-[#0B1F3A]">{resultado.puntaje}/{resultado.total}</h2>
    <p className="mt-1 text-sm text-[#607089]">{resultado.aprobado ? `¡Aprobado! Superaste la nota mínima de ${resultado.nota_minima}.` : `No alcanzaste la nota mínima de ${resultado.nota_minima}. Puedes volver a intentarlo.`}</p>
    <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
      {!resultado.aprobado && <button className="btn btn-secondary" onClick={() => { setResultado(null); setRespuestas({}); }}>Reintentar</button>}
      <button className="btn btn-primary" onClick={() => { router.push("/capacitaciones"); router.refresh(); }}>Volver al inicio</button>
    </div>
  </div>;

  return <div className="space-y-4">
    {preguntas.map((pregunta, index) => <div key={pregunta.id} className="section-card">
      <p className="text-sm font-semibold text-[#0B1F3A]">Pregunta {index + 1} de {preguntas.length}</p>
      <p className="mt-1 mb-3 text-sm text-[#172033]">{pregunta.enunciado}</p>
      <div className="grid gap-2">
        {pregunta.opciones.map(opcion => <label key={opcion.id} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${respuestas[pregunta.id] === opcion.id ? "border-[#2563EB] bg-[#EAF2FF]" : "border-[#DCE3EC] hover:bg-[#F5F8FD]"}`}>
          <input type="radio" name={pregunta.id} checked={respuestas[pregunta.id] === opcion.id} onChange={() => setRespuestas(current => ({ ...current, [pregunta.id]: opcion.id }))} />
          {opcion.texto}
        </label>)}
      </div>
    </div>)}
    {error && <Alert kind="error">{error}</Alert>}
    <button className="btn btn-primary w-full" disabled={!completo || busy} onClick={enviar}>{busy ? <LoaderCircle className="animate-spin" size={18} /> : <Send size={18} />}Enviar examen</button>
  </div>;
}

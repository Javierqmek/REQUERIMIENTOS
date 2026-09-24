"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileDown, FileSignature } from "lucide-react";
import { Alert } from "./ui/alert";

// Reporta el progreso real del video (posición actual / duración) al servidor cada vez que el
// usuario pausa o cada ~10s mientras reproduce -- nunca confía en un "clic en play" como
// evidencia de haberlo visto. El servidor decide si eso alcanza el % mínimo (registrar_progreso_video).
export function CapacitacionVideoPlayer({ capacitacionId, tienePdf, porcentajeInicial, videoCompleto: videoCompletoInicial, porcentajeMinimo }: {
  capacitacionId: string; tienePdf: boolean; porcentajeInicial: number; videoCompleto: boolean; porcentajeMinimo: number;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSent = useRef(0);
  const [porcentaje, setPorcentaje] = useState(porcentajeInicial);
  const [videoCompleto, setVideoCompleto] = useState(videoCompletoInicial);
  const [error, setError] = useState("");

  async function reportar(pct: number) {
    if (pct <= lastSent.current) return;
    lastSent.current = pct;
    try {
      const response = await fetch(`/api/capacitaciones/${capacitacionId}/progreso`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ porcentaje: pct }),
      });
      const data = await response.json();
      if (response.ok) {
        setPorcentaje((current) => Math.max(current, data.porcentaje_visto));
        if (data.video_completo && !videoCompleto) { setVideoCompleto(true); router.refresh(); }
      } else {
        lastSent.current = pct - 1;
        setError(data.error || "No se pudo registrar el avance del video.");
      }
    } catch {
      lastSent.current = pct - 1; // si falla el reporte puntual, el siguiente intento lo vuelve a intentar
    }
  }
  function onTimeUpdate() {
    const el = videoRef.current; if (!el || !el.duration) return;
    const pct = Math.floor((el.currentTime / el.duration) * 100);
    if (pct - lastSent.current >= 10) void reportar(pct);
  }
  function onPauseOrEnd() {
    const el = videoRef.current; if (!el || !el.duration) return;
    void reportar(Math.floor((el.currentTime / el.duration) * 100));
  }

  return <div className="space-y-3">
    <div className="overflow-hidden rounded-xl border border-[#DCE3EC] bg-black">
      <video ref={videoRef} controls className="aspect-video w-full" src={`/api/capacitaciones/${capacitacionId}/archivo`} onTimeUpdate={onTimeUpdate} onPause={onPauseOrEnd} onEnded={onPauseOrEnd} />
    </div>
    <div className="flex items-center gap-2 text-xs text-[#607089]">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#E9EEF5]"><div className="h-full bg-[#2563EB]" style={{ width: `${Math.min(100, porcentaje)}%` }} /></div>
      <span>{porcentaje}% visto</span>
    </div>
    {error && <Alert kind="error">{error}</Alert>}
    <div className="grid gap-2 sm:grid-cols-2">
      {tienePdf && <a className="btn btn-secondary" target="_blank" rel="noreferrer" href={`/api/capacitaciones/${capacitacionId}/archivo?tipo=pdf`}><FileDown size={17} />Ver material en PDF</a>}
      {videoCompleto
        ? <Link className="btn btn-primary" href={`/capacitaciones/${capacitacionId}/examen`}><FileSignature size={17} />Rendir examen</Link>
        : <button className="btn btn-secondary" disabled title={`Debes ver al menos el ${porcentajeMinimo}% del video`}>El examen se activa al ver el {porcentajeMinimo}%</button>}
    </div>
  </div>;
}

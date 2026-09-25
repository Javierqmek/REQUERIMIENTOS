"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileDown, FileSignature, RefreshCw, TriangleAlert } from "lucide-react";
import { Alert } from "./ui/alert";

// Tipos mínimos de la YouTube IFrame API (no hay @types oficiales instalados) -- solo lo que
// realmente se usa, para no recurrir a "any".
interface YoutubePlayerInstance {
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}
interface YoutubePlayerOptions {
  host: string;
  videoId: string;
  playerVars: Record<string, number | string>;
  events: { onReady?: () => void; onStateChange?: (event: { data: number }) => void };
}
declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, options: YoutubePlayerOptions) => YoutubePlayerInstance;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number; CUED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Reporta el progreso real del video al servidor -- nunca confía en un "clic en play" como
// evidencia de haberlo visto. El servidor decide si eso alcanza el % mínimo
// (registrar_progreso_video). Para el video subido a Storage se usa la posición del reproductor
// (currentTime/duration); para YouTube se exige algo más estricto: tiempo REALMENTE reproducido
// de forma continua (ver YoutubePlayer), así que saltar la barra hacia el final no cuenta como
// haberlo visto.
export function CapacitacionVideoPlayer({ capacitacionId, tienePdf, porcentajeInicial, videoCompleto: videoCompletoInicial, porcentajeMinimo, videoYoutubeId, nonce }: {
  capacitacionId: string; tienePdf: boolean; porcentajeInicial: number; videoCompleto: boolean; porcentajeMinimo: number;
  videoYoutubeId: string | null; nonce: string | null;
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
      {videoYoutubeId
        ? <YoutubePlayer videoId={videoYoutubeId} nonce={nonce} onPorcentaje={(pct) => void reportar(pct)} />
        : <video ref={videoRef} controls className="aspect-video w-full" src={`/api/capacitaciones/${capacitacionId}/archivo`} onTimeUpdate={onTimeUpdate} onPause={onPauseOrEnd} onEnded={onPauseOrEnd} />}
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

// Reproductor de YouTube en modo privacidad (youtube-nocookie.com, sin cookies de seguimiento),
// rel=0 (sin videos relacionados al terminar), sin anotaciones ni marca de agua clicable, y sin
// mostrar el enlace directo en ningún texto ni atributo visible en pantalla -- solo el div que la
// API reemplaza por el iframe.
//
// El progreso NUNCA se calcula por posición (currentTime/duration): eso permitiría arrastrar la
// barra hasta el final y "fingir" el 80% en un segundo. En su lugar se acumula tiempo REALMENTE
// reproducido -- cada medio segundo se compara currentTime contra la lectura anterior y solo
// suma si el salto es pequeño y hacia adelante (reproducción continua real); un salto grande
// (arrastrar la barra) o hacia atrás no acumula nada. Más estricto que el video subido, que sí
// confía en la posición.
const CARGA_TIMEOUT_MS = 10_000;

// Estado del reproductor: algunas redes (antivirus corporativos, proxies de colegios/empresas)
// bloquean youtube.com/iframe_api directamente -- sin avisar, el navegador solo deja un recuadro
// negro. Si la API no llama a onReady dentro de CARGA_TIMEOUT_MS, se asume bloqueada y se muestra
// un aviso explícito con un botón para reintentar, en vez de dejar el recuadro negro sin ninguna
// explicación.
function YoutubePlayer({ videoId, nonce, onPorcentaje }: { videoId: string; nonce: string | null; onPorcentaje: (pct: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YoutubePlayerInstance | null>(null);
  const accumulatedRef = useRef(0);
  const lastTimeRef = useRef(0);
  const lastPctRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let destroyed = false;

    function calcularYReportar() {
      const player = playerRef.current;
      if (!player) return;
      const duration = player.getDuration();
      if (!duration) return;
      const pct = Math.floor((Math.min(accumulatedRef.current, duration) / duration) * 100);
      if (pct - lastPctRef.current >= 10 || pct >= 80) { lastPctRef.current = pct; onPorcentaje(pct); }
    }
    function detenerSeguimiento() {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      calcularYReportar();
    }
    function iniciarSeguimiento() {
      if (pollRef.current) return;
      lastTimeRef.current = playerRef.current?.getCurrentTime() ?? 0;
      pollRef.current = setInterval(() => {
        const player = playerRef.current; if (!player) return;
        const current = player.getCurrentTime();
        const delta = current - lastTimeRef.current;
        if (delta > 0 && delta < 2) accumulatedRef.current += delta;
        lastTimeRef.current = current;
        calcularYReportar();
      }, 500);
    }
    function crearReproductor() {
      // Guarda extra contra crear el player dos veces (p.ej. si onYouTubeIframeAPIReady llegara a
      // dispararse más de una vez): un segundo iframe en el mismo contenedor es exactamente el
      // tipo de estado inconsistente que puede romper el handshake de postMessage con la API.
      if (destroyed || !containerRef.current || !window.YT || playerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        host: "https://www.youtube-nocookie.com",
        videoId,
        playerVars: { rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1, disablekb: 1, origin: window.location.origin },
        events: {
          onReady: () => { if (!destroyed) { clearTimeout(timeoutId); setEstado("listo"); } },
          onStateChange: (event) => {
            if (window.YT && event.data === window.YT.PlayerState.PLAYING) iniciarSeguimiento();
            else detenerSeguimiento();
          },
        },
      });
    }
    function onFalloDeCarga() { if (!destroyed) setEstado("error"); }

    const timeoutId = setTimeout(onFalloDeCarga, CARGA_TIMEOUT_MS);
    let script: HTMLScriptElement | null = null;
    if (window.YT?.Player) crearReproductor();
    else {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { previous?.(); crearReproductor(); };
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      if (nonce) script.nonce = nonce;
      script.onerror = onFalloDeCarga;
      document.head.appendChild(script);
    }

    return () => {
      destroyed = true;
      clearTimeout(timeoutId);
      detenerSeguimiento();
      playerRef.current?.destroy();
      playerRef.current = null;
      script?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, intento]);

  return <div className="relative aspect-video w-full">
    {/* NUNCA se oculta con visibility/display: el widget de YouTube necesita medir su propio
        layout para el handshake de postMessage con la API -- ocultarlo mientras carga rompía ese
        handshake (origin mismatch en la consola) y el video quedaba en negro para siempre, ni
        siquiera activaba el aviso de "no se pudo cargar". El overlay de abajo lo tapa visualmente
        con un fondo negro sólido mientras no está listo, sin tocar su layout. */}
    <div ref={containerRef} className="h-full w-full" />
    {estado !== "listo" && <div className="absolute inset-0 grid place-items-center bg-black p-4 text-center">
      {estado === "cargando"
        ? <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        : <div className="max-w-xs space-y-3">
            <TriangleAlert className="mx-auto text-amber-400" size={28} />
            <p className="text-sm text-white">No se pudo cargar el video. Es posible que tu red o antivirus bloquee YouTube. Prueba desde tu celular con datos móviles u otra red.</p>
            <button type="button" className="btn btn-secondary" onClick={() => { setEstado("cargando"); setIntento(i => i + 1); }}><RefreshCw size={16} />Reintentar</button>
          </div>}
    </div>}
  </div>;
}

"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { LoaderCircle, Upload, Plus, Trash2, Check, FileText, BarChart3, Link2 } from "lucide-react";
import { Alert } from "./ui/alert";
import { extractYoutubeId } from "@/lib/capacitaciones/youtube";
import type { CapacitacionRow, ExamenPreguntaAdmin } from "@/lib/capacitaciones/types";

interface Cliente { id: string; nombre: string; activo: boolean }
interface Asignacion { id: string; cliente_id: string | null }

const estadoLabel: Record<string, string> = { BORRADOR: "Borrador", PUBLICADA: "Publicada", ARCHIVADA: "Archivada" };
// 50 MB: límite global por archivo del plan gratuito de Supabase (no del bucket ni de la app).
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

// Sube directo del navegador a Supabase Storage con la URL firmada (nunca pasa por una función
// serverless de Vercel, que limita cada request a 4.5 MB -- muy por debajo de un video). Se usa
// XMLHttpRequest en vez de fetch porque fetch no expone progreso de subida en el navegador.
function subirDirectoAStorage(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(`No se pudo subir el archivo (${xhr.status}).`)); };
    xhr.onerror = () => reject(new Error("Error de red al subir el archivo."));
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    xhr.send(form);
  });
}

export function CapacitacionEditor({ capacitacion, preguntas, asignaciones, clientes }: {
  capacitacion: CapacitacionRow; preguntas: ExamenPreguntaAdmin[]; asignaciones: Asignacion[]; clientes: Cliente[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<Partial<Record<"video" | "pdf", number>>>({});
  const [fuenteVideo, setFuenteVideo] = useState<"archivo" | "youtube">(capacitacion.video_youtube_id ? "youtube" : "archivo");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const puedeEditar = capacitacion.estado === "BORRADOR";

  async function subirArchivo(tipo: "video" | "pdf", file: File) {
    setError("");
    const maxBytes = tipo === "video" ? MAX_VIDEO_BYTES : MAX_PDF_BYTES;
    if (file.size > maxBytes) {
      const pesoMb = (file.size / 1024 / 1024).toFixed(1);
      setError(tipo === "video"
        ? `El video pesa ${pesoMb} MB; el máximo permitido es 50 MB. Comprímelo (por ejemplo a 720p) antes de subirlo.`
        : `El archivo pesa ${pesoMb} MB; el máximo permitido es ${maxBytes / 1024 / 1024} MB.`);
      return;
    }
    setBusy(tipo); setProgreso(p => ({ ...p, [tipo]: 0 }));
    try {
      const prep = await fetch(`/api/capacitaciones/${capacitacion.id}/subir`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, nombre: file.name, tamano: file.size, contentType: file.type }),
      });
      const prepData = await prep.json();
      if (!prep.ok) throw new Error(prepData.error || "No se pudo preparar la subida.");

      await subirDirectoAStorage(prepData.signedUrl, file, pct => setProgreso(p => ({ ...p, [tipo]: pct })));

      const confirm = await fetch(`/api/capacitaciones/${capacitacion.id}/subir/confirmar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, nombre: file.name, tamano: file.size, path: prepData.path }),
      });
      const confirmData = await confirm.json();
      if (!confirm.ok) throw new Error(confirmData.error || "No se pudo confirmar la subida.");
      router.refresh();
    } catch (ex) { setError(ex instanceof Error ? ex.message : "No se pudo subir el archivo."); }
    finally { setBusy(null); setProgreso(p => ({ ...p, [tipo]: undefined })); }
  }

  async function guardarYoutube(url: string) {
    setError("");
    if (!extractYoutubeId(url)) { setError("Pega un enlace válido de YouTube (youtube.com o youtu.be)."); return; }
    setBusy("youtube");
    try {
      const response = await fetch(`/api/capacitaciones/${capacitacion.id}/video-youtube`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar el enlace.");
      setYoutubeUrl("");
      router.refresh();
    } catch (ex) { setError(ex instanceof Error ? ex.message : "No se pudo guardar el enlace."); }
    finally { setBusy(null); }
  }

  async function guardarNotaMinima(valor: number) {
    setError("");
    if (!Number.isFinite(valor) || valor < 0 || valor > 20) { setError("La nota mínima debe estar entre 0 y 20."); return; }
    setBusy("nota-minima");
    try {
      const response = await fetch(`/api/capacitaciones/${capacitacion.id}/nota-minima`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nota_minima: valor }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo actualizar la nota mínima.");
      router.refresh();
    } catch (ex) { setError(ex instanceof Error ? ex.message : "No se pudo actualizar la nota mínima."); }
    finally { setBusy(null); }
  }

  async function eliminarPregunta(id: string) {
    setError(""); setBusy(`pregunta-${id}`);
    try {
      const response = await fetch(`/api/capacitaciones/${capacitacion.id}/preguntas/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar la pregunta.");
      router.refresh();
    } catch (ex) { setError(ex instanceof Error ? ex.message : "No se pudo eliminar la pregunta."); }
    finally { setBusy(null); }
  }

  async function agregarPregunta(formData: FormData) {
    setError(""); setBusy("nueva-pregunta");
    try {
      const enunciado = String(formData.get("enunciado") || "").trim();
      const opciones = [0, 1, 2, 3].map(i => String(formData.get(`opcion-${i}`) || "").trim()).filter(Boolean);
      const correctaIndex = Number(formData.get("correcta"));
      if (opciones.length < 2) throw new Error("Agrega al menos 2 opciones.");
      const response = await fetch(`/api/capacitaciones/${capacitacion.id}/preguntas`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enunciado, opciones: opciones.map((texto, i) => ({ texto, es_correcta: i === correctaIndex })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la pregunta.");
      (document.getElementById("form-nueva-pregunta") as HTMLFormElement | null)?.reset();
      router.refresh();
    } catch (ex) { setError(ex instanceof Error ? ex.message : "No se pudo guardar la pregunta."); }
    finally { setBusy(null); }
  }

  async function asignar(clienteId: string | null) {
    setError(""); setBusy("asignar");
    try {
      const response = await fetch(`/api/capacitaciones/${capacitacion.id}/asignacion`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cliente_id: clienteId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo asignar.");
      router.refresh();
    } catch (ex) { setError(ex instanceof Error ? ex.message : "No se pudo asignar."); }
    finally { setBusy(null); }
  }

  async function quitarAsignacion(asignacionId: string) {
    setError(""); setBusy(`asignacion-${asignacionId}`);
    try {
      const response = await fetch(`/api/capacitaciones/${capacitacion.id}/asignacion`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asignacion_id: asignacionId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo quitar la asignación.");
      router.refresh();
    } catch (ex) { setError(ex instanceof Error ? ex.message : "No se pudo quitar la asignación."); }
    finally { setBusy(null); }
  }

  async function publicar() {
    setError(""); setBusy("publicar");
    try {
      const response = await fetch(`/api/capacitaciones/${capacitacion.id}/publicar`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo publicar.");
      router.refresh();
    } catch (ex) { setError(ex instanceof Error ? ex.message : "No se pudo publicar."); }
    finally { setBusy(null); }
  }

  const globalAsignada = asignaciones.some(a => a.cliente_id === null);
  const clientesAsignadosIds = new Set(asignaciones.filter(a => a.cliente_id).map(a => a.cliente_id));
  const clientesDisponibles = clientes.filter(c => c.activo && !clientesAsignadosIds.has(c.id));

  return <div className="grid gap-5">
    <header className="page-header flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="page-eyebrow">Capacitaciones</p>
        <h1 className="page-title">{capacitacion.titulo}</h1>
        <p className="page-description">Estado: <strong>{estadoLabel[capacitacion.estado]}</strong></p>
      </div>
      <div className="flex gap-2">
        <Link href={`/capacitaciones/gestion/${capacitacion.id}/reporte`} className="btn btn-secondary"><BarChart3 size={17} />Reporte</Link>
        {puedeEditar && <button className="btn btn-primary" disabled={busy === "publicar"} onClick={publicar}>
          {busy === "publicar" ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />}Publicar
        </button>}
      </div>
    </header>

    {error && <Alert kind="error">{error}</Alert>}
    {!puedeEditar && <Alert kind="info">Esta capacitación ya está {estadoLabel[capacitacion.estado].toLowerCase()}; el material y las preguntas ya no se pueden modificar.</Alert>}
    {capacitacion.estado === "BORRADOR" && <Alert kind="warning">No publicada: ningún agente puede verla todavía. Publícala cuando tenga video, examen y asignación listos.</Alert>}
    {asignaciones.length === 0 && <Alert kind="warning">Sin asignar: ningún agente la verá hasta que la asignes (a un cliente o de forma global), aunque esté publicada.</Alert>}

    <section className="section-card space-y-3">
      <h2 className="text-sm font-semibold text-[#0B1F3A]">Material</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <span className="label">Video</span>
          <div className="flex gap-1.5 text-xs font-medium">
            <button type="button" className={`btn !px-2.5 !py-1.5 ${fuenteVideo === "archivo" ? "btn-primary" : "btn-secondary"}`} disabled={!puedeEditar} onClick={() => setFuenteVideo("archivo")}>Subir archivo</button>
            <button type="button" className={`btn !px-2.5 !py-1.5 ${fuenteVideo === "youtube" ? "btn-primary" : "btn-secondary"}`} disabled={!puedeEditar} onClick={() => setFuenteVideo("youtube")}><Link2 size={14} />YouTube</button>
          </div>
          {fuenteVideo === "archivo"
            ? <><input className="input" id="video-input" type="file" accept="video/*" disabled={!puedeEditar || busy === "video"}
                onChange={e => { const f = e.target.files?.[0]; if (f) subirArchivo("video", f); }} />
                {capacitacion.video_nombre && <span className="text-xs text-[#607089]">Archivo actual: {capacitacion.video_nombre}</span>}</>
            : <div className="flex gap-1.5">
                <input className="input" type="url" placeholder="https://youtu.be/… (recomendado: no listado)" value={youtubeUrl}
                  onChange={e => setYoutubeUrl(e.target.value)} disabled={!puedeEditar || busy === "youtube"} />
                <button type="button" className="btn btn-secondary shrink-0" disabled={!puedeEditar || busy === "youtube" || !youtubeUrl.trim()} onClick={() => guardarYoutube(youtubeUrl)}>
                  {busy === "youtube" ? <LoaderCircle className="animate-spin" size={16} /> : "Guardar"}
                </button>
              </div>}
          {capacitacion.video_youtube_id && <div className="flex items-center gap-2 text-xs text-[#607089]">
            <Image src={`https://i.ytimg.com/vi/${capacitacion.video_youtube_id}/mqdefault.jpg`} alt="" width={64} height={40} className="rounded object-cover" unoptimized />
            Video de YouTube configurado
          </div>}
        </div>
        <div className="grid gap-1.5">
          <label className="label" htmlFor="pdf-input">Material PDF (opcional) {capacitacion.material_pdf_nombre && <span className="font-normal text-[#607089]">— {capacitacion.material_pdf_nombre}</span>}</label>
          <input className="input" id="pdf-input" type="file" accept="application/pdf" disabled={!puedeEditar || busy === "pdf"}
            onChange={e => { const f = e.target.files?.[0]; if (f) subirArchivo("pdf", f); }} />
        </div>
      </div>
      {(busy === "video" || busy === "pdf") && <div className="flex items-center gap-2 text-xs text-[#607089]">
        <LoaderCircle className="animate-spin shrink-0" size={14} />
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#E9EEF5]"><div className="h-full bg-[#2563EB] transition-[width]" style={{ width: `${progreso[busy as "video" | "pdf"] ?? 0}%` }} /></div>
        <span className="shrink-0">{progreso[busy as "video" | "pdf"] ?? 0}%</span>
      </div>}
    </section>

    <section className="section-card space-y-4">
      <h2 className="text-sm font-semibold text-[#0B1F3A]">Examen ({preguntas.length} pregunta{preguntas.length === 1 ? "" : "s"})</h2>
      <form className="flex flex-wrap items-end gap-2 border-b border-[#E3E9F1] pb-4" onSubmit={e => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem("nota_minima") as HTMLInputElement;
        guardarNotaMinima(Number(input.value));
      }}>
        <div>
          <label className="label" htmlFor="nota-minima-input">Nota mínima para aprobar (0 a 20)</label>
          <input key={capacitacion.nota_minima} className="input w-28" id="nota-minima-input" name="nota_minima" type="number" min={0} max={20}
            defaultValue={capacitacion.nota_minima} disabled={!puedeEditar || busy === "nota-minima"} />
          <p className="mt-1 text-xs text-[#8794A8]">{preguntas.length > 0 ? `Cada pregunta vale ${(20 / preguntas.length).toFixed(1)} puntos.` : "Agrega preguntas para ver cuánto vale cada una."}</p>
        </div>
        {puedeEditar && <button className="btn btn-secondary" disabled={busy === "nota-minima"}>{busy === "nota-minima" ? <LoaderCircle className="animate-spin" size={16} /> : "Guardar"}</button>}
      </form>
      {preguntas.length > 0 && <div className="grid gap-2.5">{preguntas.map(p => <div key={p.id} className="card p-3.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-[#0B1F3A]">{p.enunciado}</p>
          {puedeEditar && <button className="btn btn-ghost !px-2 shrink-0 text-[var(--error)]" disabled={busy === `pregunta-${p.id}`} onClick={() => eliminarPregunta(p.id)} aria-label="Eliminar pregunta">
            {busy === `pregunta-${p.id}` ? <LoaderCircle className="animate-spin" size={15} /> : <Trash2 size={15} />}
          </button>}
        </div>
        <ul className="mt-2 grid gap-1 text-xs text-[#45556D]">{p.examen_opciones.map(o => <li key={o.id} className={o.es_correcta ? "font-semibold text-emerald-700" : ""}>{o.es_correcta ? "✓ " : "· "}{o.texto}</li>)}</ul>
      </div>)}</div>}
      {puedeEditar && <form id="form-nueva-pregunta" action={agregarPregunta} className="grid gap-2.5 border-t border-[#E3E9F1] pt-4">
        <div><label className="label" htmlFor="enunciado">Nueva pregunta</label><input className="input" id="enunciado" name="enunciado" required minLength={3} maxLength={500} placeholder="¿Cuál es el procedimiento correcto...?" /></div>
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="flex items-center gap-2">
            <input type="radio" name="correcta" value={i} required={i === 0} className="h-4 w-4" aria-label={`Opción ${i + 1} es la correcta`} />
            <input className="input" name={`opcion-${i}`} maxLength={300} required={i < 2} placeholder={`Opción ${i + 1}${i < 2 ? "" : " (opcional)"}`} />
          </div>)}
        </div>
        <p className="text-xs text-[#8794A8]">Marca el círculo de la opción correcta.</p>
        <button className="btn btn-secondary w-fit" disabled={busy === "nueva-pregunta"}>{busy === "nueva-pregunta" ? <LoaderCircle className="animate-spin" size={16} /> : <Plus size={16} />}Agregar pregunta</button>
      </form>}
    </section>

    <section className="section-card space-y-3">
      <h2 className="text-sm font-semibold text-[#0B1F3A]">Asignación</h2>
      <div className="grid gap-2">
        {globalAsignada
          ? <div className="card flex items-center justify-between p-3 text-sm"><span>Todos los agentes (global)</span>{puedeEditar && <button className="btn btn-ghost !px-2 text-[var(--error)]" disabled={!!busy} onClick={() => quitarAsignacion(asignaciones.find(a => a.cliente_id === null)!.id)}><Trash2 size={15} /></button>}</div>
          : puedeEditar && <button className="btn btn-secondary w-fit" disabled={!!busy} onClick={() => asignar(null)}><Plus size={16} />Asignar a todos los agentes</button>}
        {asignaciones.filter(a => a.cliente_id).map(a => {
          const cliente = clientes.find(c => c.id === a.cliente_id);
          return <div key={a.id} className="card flex items-center justify-between p-3 text-sm">
            <span>{cliente?.nombre || "Cliente"}</span>
            {puedeEditar && <button className="btn btn-ghost !px-2 text-[var(--error)]" disabled={busy === `asignacion-${a.id}`} onClick={() => quitarAsignacion(a.id)}>{busy === `asignacion-${a.id}` ? <LoaderCircle className="animate-spin" size={15} /> : <Trash2 size={15} />}</button>}
          </div>;
        })}
        {puedeEditar && !globalAsignada && clientesDisponibles.length > 0 && <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); const sel = (e.currentTarget.elements.namedItem("cliente") as HTMLSelectElement); if (sel.value) asignar(sel.value); }}>
          <div className="min-w-[220px]"><label className="label" htmlFor="cliente-select">Asignar a un cliente</label>
            <select className="input" id="cliente-select" name="cliente">
              <option value="">Selecciona…</option>
              {clientesDisponibles.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary" disabled={busy === "asignar"}>{busy === "asignar" ? <LoaderCircle className="animate-spin" size={16} /> : <Plus size={16} />}Asignar</button>
        </form>}
      </div>
    </section>

    {capacitacion.material_pdf_nombre && <p className="flex items-center gap-1.5 text-xs text-[#607089]"><FileText size={14} />Material PDF configurado.</p>}
    <p className="flex items-center gap-1.5 text-xs text-[#607089]"><Upload size={14} />Puedes reemplazar el video o el PDF mientras la capacitación esté en borrador.</p>
  </div>;
}

"use client";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Eye, FileCheck2, FileSignature, LoaderCircle, RotateCcw } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPdfPage } from "./document-workspace";
import { movePlacements, resizePlacements } from "@/lib/documents/placement-client";
import { Alert } from "./ui/alert";
import { ConfirmDialog } from "./ui/confirm-dialog";

type Placement = { pagina: number; x: number; y: number; ancho: number; alto: number };
const serialise = (p: Placement) => JSON.stringify(p);
const initialPlacement = (pagina: number): Placement => ({ pagina, x: 0.58, y: 0.68, ancho: 0.28, alto: 0.12 });

// Editor de firma del gerente para papeletas de vacaciones. Reutiliza LITERALMENTE la técnica de
// render (renderPdfPage, importado de document-workspace.tsx) y la matemática de arrastre/
// redimensión (movePlacements/resizePlacements, lib/documents/placement-client.ts) del editor de
// colocación de Documentos/Firma -- no es un segundo editor de coordenadas, es el mismo mecanismo
// aplicado a un único sello sobre el bucket de papeletas. Sin posición fija: el gerente ve el PDF
// real, arrastra/redimensiona el sello, cambia de página, previsualiza el resultado compuesto y
// solo entonces confirma. Antes de componer (preview y confirmación) se verifica papeleta_id +
// versión + SHA-256 de origen contra el servidor: si algo cambió, se rechaza y se pide recargar.
export function VacationSignWorkspace({ papeletaId, versionActual, archivoSha256, profileReady }: { papeletaId: string; versionActual: number; archivoSha256: string; profileReady: boolean }) {
  const router = useRouter();
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const basePdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderSequence = useRef(0);

  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [placement, setPlacement] = useState<Placement>(() => initialPlacement(1));
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [stale, setStale] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const currentKey = useMemo(() => serialise(placement), [placement]);
  const dirty = currentKey !== previewKey;
  const previewed = currentKey === previewKey;

  const renderDocument = useCallback(async (pdf: PDFDocumentProxy, pageNumber: number) => {
    const host = wrap.current?.parentElement, target = canvas.current;
    if (!host || !target) return;
    const sequence = ++renderSequence.current;
    setLoadingPdf(true);
    try {
      const committed = await renderPdfPage(pdf, pageNumber, host, target, () => sequence === renderSequence.current);
      if (committed) setLoadingPdf(false);
    } catch {
      if (sequence === renderSequence.current) { setMessage("No se pudo mostrar el PDF."); setLoadingPdf(false); }
    }
  }, []);

  useEffect(() => {
    let cancelled = false; let loaded: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
        loaded = await pdfjs.getDocument(`/api/documentos/vacaciones/${papeletaId}/archivo`).promise;
        if (!cancelled) {
          basePdfRef.current = loaded; pdfRef.current = loaded;
          setPageCount(loaded.numPages); setPage(1); setPlacement(initialPlacement(1));
          await renderDocument(loaded, 1);
        }
      } catch {
        if (!cancelled) { setMessage("No se pudo cargar el documento."); setLoadingPdf(false); }
      }
    })();
    return () => { cancelled = true; renderSequence.current += 1; void loaded?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [papeletaId]);

  useEffect(() => { if (pdfRef.current) void renderDocument(pdfRef.current, page); }, [page, renderDocument]);

  useEffect(() => {
    const host = wrap.current?.parentElement; if (!host) return;
    let timer: ReturnType<typeof setTimeout>;
    const redraw = () => { clearTimeout(timer); timer = setTimeout(() => { if (pdfRef.current) void renderDocument(pdfRef.current, page); }, 120); };
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", redraw); return () => { clearTimeout(timer); window.removeEventListener("resize", redraw); }; }
    const observer = new ResizeObserver(redraw); observer.observe(host);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [page, renderDocument]);

  function move(e: React.PointerEvent) {
    if (previewMode) return;
    const box = wrap.current?.getBoundingClientRect(); if (!box) return;
    const startX = e.clientX, startY = e.clientY, snapshot = [placement];
    const onMove = (event: PointerEvent) => { const dx = (event.clientX - startX) / box.width, dy = (event.clientY - startY) / box.height; setPlacement(movePlacements(snapshot, 0, dx, dy)[0]); };
    const finish = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", finish); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", finish);
  }
  function resize(e: React.PointerEvent) {
    e.stopPropagation(); if (previewMode) return;
    const box = wrap.current?.getBoundingClientRect(); if (!box) return;
    const startX = e.clientX, startY = e.clientY, snapshot = [placement];
    const onMove = (event: PointerEvent) => { const dx = (event.clientX - startX) / box.width, dy = (event.clientY - startY) / box.height; setPlacement(resizePlacements(snapshot, 0, dx, dy)[0]); };
    const finish = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", finish); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", finish);
  }
  function changePage(next: number) {
    if (previewMode || next < 1 || next > pageCount) return;
    setPage(next); setPlacement(current => ({ ...current, pagina: next }));
  }

  async function openPreview() {
    setBusy(true); setLoadingPdf(true); setMessage("");
    try {
      const response = await fetch(`/api/documentos/vacaciones/${papeletaId}/firmar/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version_esperada: versionActual, archivo_sha256_origen: archivoSha256, placement }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 409) setStale(true);
        throw new Error(data.error || "No se pudo generar la vista previa.");
      }
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
      pdfRef.current = pdf; setPreviewMode(true);
      await renderDocument(pdf, placement.pagina);
    } catch (error) {
      pdfRef.current = basePdfRef.current; setLoadingPdf(false);
      setMessage(error instanceof Error ? error.message : "No se pudo generar la vista previa.");
    } finally {
      setBusy(false);
    }
  }
  function finishPreview() {
    setPreviewKey(currentKey); setPreviewMode(false); pdfRef.current = basePdfRef.current;
    if (pdfRef.current) void renderDocument(pdfRef.current, placement.pagina);
    setMessage("Vista previa revisada. Ya puedes confirmar la firma.");
  }

  async function confirmSign() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/documentos/vacaciones/${papeletaId}/firmar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version_esperada: versionActual, archivo_sha256_origen: archivoSha256, placement }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) setStale(true);
        throw new Error(data.error || "No se pudo firmar la papeleta.");
      }
      setConfirming(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo firmar la papeleta.");
    } finally {
      setBusy(false);
    }
  }

  if (stale) return <div className="section-card"><Alert kind="warning">La papeleta cambió mientras la firmabas (otra corrección o firma se registró). Recarga la página antes de continuar; nunca se firma una versión desactualizada.</Alert>
    <button className="btn btn-secondary mt-3" onClick={() => router.refresh()}><RotateCcw size={16} />Recargar</button>
  </div>;

  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
    <section className="card min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE3EC] px-3 py-2.5">
        <span className="text-xs font-semibold text-[#0B1F3A]">{previewMode ? "Vista previa de la firma" : "Arrastra el sello sobre el documento"}</span>
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost px-2" disabled={page === 1 || previewMode} onClick={() => changePage(page - 1)} aria-label="Página anterior"><ChevronLeft size={18} /></button>
          <span className="min-w-20 text-center text-xs font-medium text-[#607089]">Página {page} de {pageCount}</span>
          <button className="btn btn-ghost px-2" disabled={page === pageCount || previewMode} onClick={() => changePage(page + 1)} aria-label="Página siguiente"><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className="relative overflow-auto bg-[#E9EEF5] p-2 sm:p-5">
        <div ref={wrap} className="relative mx-auto w-fit max-w-full bg-white shadow-sm">
          <canvas ref={canvas} className="block h-auto max-w-full" />
          {loadingPdf && <div className="absolute inset-0 grid place-items-center bg-white/80 text-sm text-[#607089]"><LoaderCircle className="animate-spin" size={22} />Cargando documento…</div>}
          {!previewMode && !loadingPdf && placement.pagina === page && <div
            onPointerDown={move}
            style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, width: `${placement.ancho * 100}%`, height: `${placement.alto * 100}%` }}
            className="absolute cursor-move select-none outline outline-1 outline-offset-1 outline-[#2563EB]">
            <Image unoptimized fill draggable={false} src="/api/perfil/firma?tipo=sello" alt="Sello del gerente" className="pointer-events-none object-contain" />
            <button type="button" onPointerDown={resize} className="absolute -bottom-2 -right-2 h-5 w-5 cursor-se-resize rounded-full border-2 border-white bg-[#2563EB]" aria-label="Cambiar tamaño del sello" />
          </div>}
        </div>
      </div>
    </section>
    <aside className="section-card xl:sticky xl:top-20">
      <h2 className="section-title flex items-center gap-2"><FileSignature size={16} />Firma</h2>
      <p className="mt-1 text-sm text-[#607089]">Ubica el sello sobre el documento, cambia de página si hace falta, previsualiza el resultado y confirma.</p>
      {!profileReady && <div className="mt-3"><Alert kind="warning">Configura tu perfil de firma antes de firmar.</Alert></div>}
      <ol className="mt-4 grid gap-1.5 text-xs font-medium text-[#45556D]"><li>1. Ubicar el sello</li><li>2. Vista previa</li><li>3. Confirmar firma</li></ol>
      <div className="mt-4 grid gap-2">
        <button className="btn btn-secondary w-full" disabled={busy || previewMode || loadingPdf || !profileReady} onClick={openPreview}>{busy ? <LoaderCircle className="animate-spin" size={17} /> : <Eye size={17} />} Vista previa</button>
        {previewMode && <button className="btn btn-primary w-full" onClick={finishPreview}><FileCheck2 size={17} />He revisado la vista previa</button>}
      </div>
      <button className="btn btn-primary mt-2 w-full" disabled={busy || previewMode || dirty || !previewed || !profileReady} onClick={() => setConfirming(true)}>
        {busy ? <LoaderCircle className="animate-spin" size={17} /> : <FileSignature size={17} />} Confirmar firma
      </button>
      {(dirty || !previewed) && !previewMode && <p className="mt-2 text-xs text-[#607089]">Genera la vista previa para habilitar la confirmación.</p>}
      {message && <div className="mt-4"><Alert kind={message.includes("revisada") ? "success" : "error"}>{message}</Alert></div>}
    </aside>
    <ConfirmDialog open={confirming} busy={busy} intent="warning" title="Confirmar firma"
      description="Vas a incorporar tu sello, en la posición que ubicaste, a esta papeleta. Se generará una versión final firmada que ya no podrá modificarse."
      confirmLabel="Firmar" onCancel={() => { if (!busy) setConfirming(false); }} onConfirm={confirmSign} />
  </div>;
}

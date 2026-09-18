"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, LoaderCircle, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPdfPage as renderPdfPageAtScale } from "./document-workspace";

// Visor de solo lectura para el detalle de una papeleta. Reutiliza literalmente la función de
// render exportada por components/document-workspace.tsx (pdfjs legacy build, canvas intermedio
// para evitar parpadeo/artefactos, guard de secuencia para descartar renders obsoletos, rotación
// de página respetada) -- una sola implementación, sin el editor de colocación (aquí solo se
// muestra el documento). renderPdfPage no soporta zoom variable, así que aquí se envuelve para
// permitir el control de zoom propio del visor de vacaciones sin duplicar el render en sí.
async function renderPdfPage(pdf: PDFDocumentProxy, pageNumber: number, host: HTMLElement, target: HTMLCanvasElement, zoom: number, isCurrent: () => boolean) {
  const zoomedHost = { clientWidth: host.clientWidth * zoom } as HTMLElement;
  return renderPdfPageAtScale(pdf, pageNumber, zoomedHost, target, isCurrent);
}

export function VacationPdfViewer({ papeletaId, version, pages }: { papeletaId: string; version?: number; pages?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderSequence = useRef(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(pages || 1);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const query = version ? `?version=${version}` : "";
  const href = `/api/documentos/vacaciones/${papeletaId}/archivo${query}`;

  const renderDocument = useCallback(async (pdf: PDFDocumentProxy, pageNumber: number) => {
    const host = wrap.current?.parentElement, target = canvas.current;
    if (!host || !target) return;
    const sequence = ++renderSequence.current;
    setLoading(true);
    try {
      const committed = await renderPdfPage(pdf, pageNumber, host, target, zoom, () => sequence === renderSequence.current);
      if (committed) setLoading(false);
    } catch {
      if (sequence === renderSequence.current) { setError("No se pudo mostrar el PDF."); setLoading(false); }
    }
  }, [zoom]);

  useEffect(() => {
    let cancelled = false; let loaded: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
        loaded = await pdfjs.getDocument(href).promise;
        if (!cancelled) { pdfRef.current = loaded; setPageCount(loaded.numPages); setPage(1); await renderDocument(loaded, 1); }
      } catch {
        if (!cancelled) { setError("No se pudo cargar el documento."); setLoading(false); }
      }
    })();
    return () => { cancelled = true; renderSequence.current += 1; void loaded?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);

  useEffect(() => { if (pdfRef.current) void renderDocument(pdfRef.current, page); }, [page, renderDocument]);

  useEffect(() => {
    const host = wrap.current?.parentElement; if (!host) return;
    let timer: ReturnType<typeof setTimeout>;
    const redraw = () => { clearTimeout(timer); timer = setTimeout(() => { if (pdfRef.current) void renderDocument(pdfRef.current, page); }, 120); };
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", redraw); return () => { clearTimeout(timer); window.removeEventListener("resize", redraw); }; }
    const observer = new ResizeObserver(redraw); observer.observe(host);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [page, renderDocument]);

  return <section className="card min-w-0 overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE3EC] px-3 py-2.5">
      <div className="flex items-center gap-1">
        <button className="btn btn-ghost px-2" disabled={page === 1} onClick={() => setPage(value => value - 1)} aria-label="Página anterior"><ChevronLeft size={18} /></button>
        <span className="min-w-20 text-center text-xs font-medium text-[#607089]">Página {page} de {pageCount}</span>
        <button className="btn btn-ghost px-2" disabled={page === pageCount} onClick={() => setPage(value => value + 1)} aria-label="Página siguiente"><ChevronRight size={18} /></button>
      </div>
      <div className="flex items-center gap-1">
        <button className="btn btn-ghost px-2" disabled={zoom <= 0.6} onClick={() => setZoom(value => Math.max(0.6, +(value - 0.2).toFixed(1)))} aria-label="Reducir zoom"><ZoomOut size={16} /></button>
        <span className="min-w-12 text-center text-xs font-medium text-[#607089]">{Math.round(zoom * 100)}%</span>
        <button className="btn btn-ghost px-2" disabled={zoom >= 2.2} onClick={() => setZoom(value => Math.min(2.2, +(value + 0.2).toFixed(1)))} aria-label="Aumentar zoom"><ZoomIn size={16} /></button>
        <a target="_blank" rel="noreferrer" className="btn btn-ghost px-2" href={href} aria-label="Abrir en pestaña nueva"><ExternalLink size={16} /></a>
        <a className="btn btn-ghost px-2" href={`${href}${query ? "&" : "?"}download=1`} aria-label="Descargar"><Download size={16} /></a>
      </div>
    </div>
    <div className="relative overflow-auto bg-[#E9EEF5] p-2 sm:p-5">
      <div ref={wrap} className="relative mx-auto w-fit max-w-full bg-white shadow-sm">
        <canvas ref={canvas} className="block h-auto max-w-full" />
        {loading && <div className="absolute inset-0 grid place-items-center bg-white/80 text-sm text-[#607089]"><LoaderCircle className="animate-spin" size={22} />Cargando documento…</div>}
        {error && !loading && <div className="absolute inset-0 grid place-items-center bg-white/90 p-4 text-center text-sm text-[#C53030]">{error}</div>}
      </div>
    </div>
  </section>;
}

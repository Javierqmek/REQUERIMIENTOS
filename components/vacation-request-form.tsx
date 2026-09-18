"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, FileUp, LoaderCircle } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createClient } from "@/lib/supabase/client";
import { createRequestId } from "@/lib/security/request-id";
import { calendarDays, validatePhysicalRange, validateSaleRange } from "@/lib/vacations/dates";
import { isA4Size } from "@/lib/vacations/paper";
import { papeletaSchema } from "@/lib/vacations/validations";
import type { Cliente, Provincia, Unidad } from "@/lib/types";
import { Alert } from "./ui/alert";
import { LoadingState } from "./ui/loading-state";
import { PersonalSearchPicker, type PersonalOption } from "./personal-search-picker";
import { useActiveCatalog } from "./use-active-catalog";

function nextDay(iso: string) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return pdfjs;
}

export function VacationRequestForm({ coordinadorNombre }: { coordinadorNombre: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  // Evita que un render en curso de un archivo anterior pinte el canvas después de que el
  // usuario ya seleccionó uno nuevo (carrera clásica entre selecciones rápidas de archivo).
  const renderSequence = useRef(0);
  // Generado una sola vez por montaje del formulario: protege contra doble clic, reintento
  // del navegador, timeout o respuesta perdida sin crear una segunda papeleta (ver RPC).
  const [requestId] = useState(createRequestId);

  const [colaborador, setColaborador] = useState<PersonalOption | null>(null);
  const [reemplazo, setReemplazo] = useState<PersonalOption | null>(null);

  const [fisicasInicio, setFisicasInicio] = useState("");
  const [fisicasFin, setFisicasFin] = useState("");
  const physicalError = fisicasInicio || fisicasFin ? validatePhysicalRange(fisicasInicio, fisicasFin) : null;
  const physicalReady = Boolean(fisicasInicio && fisicasFin && !physicalError);
  const fisicasDias = physicalReady ? calendarDays(fisicasInicio, fisicasFin) : null;

  const [tieneVenta, setTieneVenta] = useState(false);
  const [ventaInicio, setVentaInicio] = useState("");
  const [ventaFin, setVentaFin] = useState("");
  const saleError = tieneVenta ? validateSaleRange(true, fisicasFin, ventaInicio, ventaFin) : null;
  const ventaDias = tieneVenta && ventaInicio && ventaFin && !saleError ? calendarDays(ventaInicio, ventaFin) : null;

  const [provinciaId, setProvinciaId] = useState("");
  const provincias = useActiveCatalog<Provincia>(supabase, "provincias", true);
  const [clienteId, setClienteId] = useState("");
  const [unidadId, setUnidadId] = useState("");
  const clientes = useActiveCatalog<Cliente>(supabase, "clientes", true);
  const cliente = clientes.rows.find(c => c.id === clienteId);
  const unidades = useActiveCatalog<Unidad>(supabase, "unidades", Boolean(cliente), { column: "cliente_id", value: clienteId });
  const unidad = unidades.rows.find(u => u.id === unidadId);

  const [file, setFile] = useState<File | null>(null);
  const [pdfPages, setPdfPages] = useState(0);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfLoading, setPdfLoading] = useState(false);
  // Bloqueante: el archivo no es un PDF válido/legible. No incluye el aviso de A4, que es
  // solo informativo y nunca debe impedir el registro (algunos escáneres reales no dan A4 exacto).
  const [pdfError, setPdfError] = useState("");
  const [pdfA4Note, setPdfA4Note] = useState("");
  const [confirmado, setConfirmado] = useState(false);

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [successId, setSuccessId] = useState("");

  async function renderPage(pdf: PDFDocumentProxy, pageNumber: number, sequence: number) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    if (pageNumber === 1) {
      setPdfA4Note(isA4Size(viewport.width, viewport.height) ? "" : "El documento no tiene dimensiones A4 estándar. Verifique que sea legible antes de continuar.");
    }
    const displayScale = Math.min(1.4, Math.max(.4, 520 / viewport.width));
    const displayViewport = page.getViewport({ scale: displayScale });
    // Se dibuja en un canvas fuera de pantalla y recién se copia al visible si este render
    // sigue siendo el vigente: evita que una selección de archivo más nueva quede pisada por
    // un render anterior que termina tarde (carrera clásica de renders asíncronos).
    const buffer = document.createElement("canvas");
    buffer.width = Math.ceil(displayViewport.width);
    buffer.height = Math.ceil(displayViewport.height);
    await page.render({ canvasContext: buffer.getContext("2d")!, viewport: displayViewport }).promise;
    if (sequence !== renderSequence.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = buffer.width;
    canvas.height = buffer.height;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(buffer, 0, 0);
  }

  async function chooseFile(selected: File | null) {
    const sequence = ++renderSequence.current;
    setFile(selected);
    setConfirmado(false);
    setPdfError("");
    setPdfA4Note("");
    setPdfPages(0);
    pdfRef.current?.destroy();
    pdfRef.current = null;
    if (!selected) return;
    if (selected.type && selected.type !== "application/pdf" && !selected.name.toLowerCase().endsWith(".pdf")) {
      setPdfError("Selecciona un archivo PDF.");
      return;
    }
    setPdfLoading(true);
    try {
      const bytes = new Uint8Array(await selected.arrayBuffer());
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") { setPdfError("El archivo no es un PDF válido."); return; }
      const pdfjs = await loadPdfjs();
      const pdf = await pdfjs.getDocument({ data: bytes }).promise;
      if (sequence !== renderSequence.current) { void pdf.destroy(); return; }
      pdfRef.current = pdf;
      setPdfPages(pdf.numPages);
      setPdfPage(1);
      await renderPage(pdf, 1, sequence);
    } catch {
      if (sequence === renderSequence.current) setPdfError("No se pudo leer el PDF. Verifica que no esté dañado o cifrado.");
    } finally {
      if (sequence === renderSequence.current) setPdfLoading(false);
    }
  }

  async function changePage(next: number) {
    if (!pdfRef.current || next < 1 || next > pdfPages) return;
    const sequence = renderSequence.current;
    setPdfPage(next);
    setPdfLoading(true);
    try { await renderPage(pdfRef.current, next, sequence); } finally { if (sequence === renderSequence.current) setPdfLoading(false); }
  }

  const ready = Boolean(colaborador && reemplazo && physicalReady && !saleError && provinciaId && cliente && unidad && file && confirmado);

  async function submit() {
    if (savingRef.current) return;
    setError("");
    const parsed = papeletaSchema.safeParse({
      colaborador_id: colaborador?.id ?? "",
      reemplazo_id: reemplazo?.id ?? "",
      provincia_id: provinciaId,
      cliente_id: clienteId,
      unidad_id: unidadId,
      fisicas_fecha_inicio: fisicasInicio,
      fisicas_fecha_fin: fisicasFin,
      tiene_venta: tieneVenta,
      venta_fecha_inicio: tieneVenta ? ventaInicio || null : null,
      venta_fecha_fin: tieneVenta ? ventaFin || null : null,
    });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (!file) { setError("Adjunta la papeleta escaneada en PDF."); return; }
    if (pdfError) { setError(pdfError); return; }
    if (!confirmado) { setError("Debes confirmar que el documento está completo y legible."); return; }

    savingRef.current = true; setSaving(true);
    try {
      const form = new FormData();
      form.set("archivo", file);
      form.set("request_id", requestId);
      form.set("colaborador_id", parsed.data.colaborador_id);
      form.set("reemplazo_id", parsed.data.reemplazo_id);
      form.set("provincia_id", parsed.data.provincia_id);
      form.set("cliente_id", parsed.data.cliente_id);
      form.set("unidad_id", parsed.data.unidad_id);
      form.set("fisicas_fecha_inicio", parsed.data.fisicas_fecha_inicio);
      form.set("fisicas_fecha_fin", parsed.data.fisicas_fecha_fin);
      form.set("tiene_venta", String(parsed.data.tiene_venta));
      if (parsed.data.venta_fecha_inicio) form.set("venta_fecha_inicio", parsed.data.venta_fecha_inicio);
      if (parsed.data.venta_fecha_fin) form.set("venta_fecha_fin", parsed.data.venta_fecha_fin);
      form.set("confirmacion_legibilidad", "true");
      const response = await fetch("/api/documentos/vacaciones", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar la papeleta.");
      const id = String(data.id || "");
      if (!id) throw new Error("El servidor no devolvió un identificador. No se confirmó el registro.");
      // Nunca mostrar éxito solo porque el servidor respondió 2xx: se confirma leyendo la fila
      // de vuelta con la sesión del propio coordinador antes de declarar la papeleta registrada.
      const confirm = await supabase.from("papeletas_vacaciones").select("id").eq("id", id).maybeSingle();
      if (confirm.error || !confirm.data) {
        throw new Error("La papeleta se registró pero no pudimos confirmarla todavía. Revisa \"Mis papeletas de vacaciones\" en unos segundos; si no aparece, contacta al administrador.");
      }
      // Invalida la caché de navegación del router para que el listado (visitado antes o
      // después) refleje esta papeleta de inmediato, sin depender de una recarga manual.
      router.refresh();
      setSuccessId(id);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "No se pudo registrar la papeleta.");
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }

  if (successId) return (
    <div className="card p-5 sm:p-7">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-emerald-50 text-[#16803C]"><CheckCircle2 size={23} /></span>
        <div><h1 className="text-xl font-semibold text-[#0B1F3A]">Papeleta registrada</h1><p className="mt-1 text-sm text-[#607089]">La papeleta de {colaborador?.nombre} quedó registrada correctamente.</p></div>
      </div>
      <div className="mt-6 flex flex-col gap-2 border-t border-[#DCE3EC] pt-5 sm:flex-row">
        <Link className="btn btn-primary" href="/documentos/vacaciones"><ClipboardList size={17} />Mis papeletas de vacaciones</Link>
        <Link className="btn btn-secondary" href="/documentos/vacaciones/nueva">Registrar otra</Link>
      </div>
    </div>
  );

  return <div className="grid gap-4">
    <section className="section-card">
      <h2 className="section-title">A. Colaborador</h2>
      <p className="mt-1 text-sm text-[#607089]">Busca al colaborador que saldrá de vacaciones. El código se muestra automáticamente y no es editable.</p>
      <div className="mt-4">
        <PersonalSearchPicker label="Colaborador" selected={colaborador} onSelect={setColaborador} onClear={() => { setColaborador(null); if (reemplazo?.id === colaborador?.id) setReemplazo(null); }} />
      </div>
    </section>

    <section className="section-card">
      <h2 className="section-title">B. Vacaciones físicas <span className="ml-1 text-xs font-normal text-[#607089]">(obligatorio)</span></h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div><label className="label" htmlFor="fisicas-inicio">Fecha inicio</label><input id="fisicas-inicio" type="date" className="input" value={fisicasInicio} onChange={e => setFisicasInicio(e.target.value)} /></div>
        <div><label className="label" htmlFor="fisicas-fin">Fecha fin</label><input id="fisicas-fin" type="date" className="input" min={fisicasInicio || undefined} value={fisicasFin} onChange={e => setFisicasFin(e.target.value)} /></div>
        <div><span className="label block">Días calendario</span><output className="flex min-h-11 items-center rounded-lg border border-[#DCE3EC] bg-[#F8FAFD] px-3 text-sm font-medium">{fisicasDias ?? "—"}</output></div>
      </div>
      {physicalError && <p className="mt-2 text-xs font-medium text-[#C53030]">{physicalError}</p>}
    </section>

    <section className="section-card">
      <h2 className="section-title">C. Venta de vacaciones</h2>
      <label className="mt-3 flex items-center gap-2 text-sm font-medium text-[#172033]">
        <input type="checkbox" disabled={!physicalReady} checked={tieneVenta}
          onChange={e => { setTieneVenta(e.target.checked); if (!e.target.checked) { setVentaInicio(""); setVentaFin(""); } }} />
        Registrar venta de vacaciones
      </label>
      {!physicalReady && <p className="mt-1 text-xs text-[#607089]">Completa primero un rango válido de vacaciones físicas.</p>}
      {tieneVenta && <>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div><label className="label" htmlFor="venta-inicio">Fecha inicio venta</label><input id="venta-inicio" type="date" className="input" min={fisicasFin ? nextDay(fisicasFin) : undefined} value={ventaInicio} onChange={e => setVentaInicio(e.target.value)} /></div>
          <div><label className="label" htmlFor="venta-fin">Fecha fin venta</label><input id="venta-fin" type="date" className="input" min={ventaInicio || undefined} value={ventaFin} onChange={e => setVentaFin(e.target.value)} /></div>
          <div><span className="label block">Días calendario</span><output className="flex min-h-11 items-center rounded-lg border border-[#DCE3EC] bg-[#F8FAFD] px-3 text-sm font-medium">{ventaDias ?? "—"}</output></div>
        </div>
        {saleError && <p className="mt-2 text-xs font-medium text-[#C53030]">{saleError}</p>}
      </>}
    </section>

    <section className="section-card">
      <h2 className="section-title">D. Reemplazo</h2>
      <p className="mt-1 text-sm text-[#607089]">Persona que cubrirá al colaborador durante sus vacaciones.</p>
      <div className="mt-4">
        <PersonalSearchPicker label="Reemplazo" selected={reemplazo} onSelect={setReemplazo} onClear={() => setReemplazo(null)}
          excludeId={colaborador?.id}
          error={reemplazo && colaborador && reemplazo.id === colaborador.id ? "El reemplazo no puede ser el mismo colaborador." : undefined} />
      </div>
    </section>

    <section className="section-card">
      <h2 className="section-title">E. Ubicación</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="cliente">Cliente</label>
          <select id="cliente" className="input" value={clienteId} disabled={clientes.loading} onChange={e => { setClienteId(e.target.value); setUnidadId(""); }}>
            <option value="">Selecciona un cliente</option>
            {clientes.rows.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          {clientes.loading && <LoadingState compact label="Cargando clientes..." />}
        </div>
        <div>
          <label className="label" htmlFor="unidad">Unidad / Sede</label>
          <select id="unidad" className="input" value={unidadId} disabled={!cliente || unidades.loading} onChange={e => setUnidadId(e.target.value)}>
            <option value="">Selecciona una unidad</option>
            {unidades.rows.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          {unidades.loading && <LoadingState compact label="Cargando unidades..." />}
          {cliente && !unidades.loading && !unidades.rows.length && <p className="mt-2 text-xs text-[#607089]">No hay unidades activas para este cliente.</p>}
        </div>
        <div>
          <label className="label" htmlFor="provincia">Provincia</label>
          {provincias.loading && <LoadingState compact label="Cargando provincias..." />}
          {!provincias.loading && provincias.error && <Alert kind="error">No pudimos cargar las provincias.</Alert>}
          {!provincias.loading && !provincias.error && !provincias.rows.length && <Alert kind="warning">No hay provincias configuradas. Contacte al administrador.</Alert>}
          {!provincias.loading && !provincias.error && provincias.rows.length > 0 && <select id="provincia" className="input" value={provinciaId} onChange={e => setProvinciaId(e.target.value)}>
            <option value="">Selecciona una provincia</option>
            {provincias.rows.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>}
        </div>
        <div>
          <span className="label block">Coordinador</span>
          <output className="flex min-h-11 items-center rounded-lg border border-[#DCE3EC] bg-[#F8FAFD] px-3 text-sm font-medium">{coordinadorNombre}</output>
        </div>
      </div>
    </section>

    <section className="section-card">
      <h2 className="section-title">F. Documento</h2>
      <p className="mt-1 text-sm text-[#607089]">Papeleta escaneada y firmada, en PDF.</p>
      <div className="mt-4">
        <input className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#EAF2FF] file:px-4 file:py-2.5 file:font-semibold file:text-[#174EA6]"
          type="file" accept="application/pdf,.pdf" onChange={e => void chooseFile(e.target.files?.[0] ?? null)} />
      </div>
      {/* El contenedor se monta apenas hay archivo, sin esperar a que termine de cargar: si el
          canvas solo existiera cuando pdfLoading es false, el primer render corre con la ref
          todavía nula y la vista previa queda en blanco para siempre (bug ya corregido). */}
      {file && !pdfError && <div className="relative mt-4 rounded-xl border border-[#DCE3EC] bg-[#E9EEF5] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-[#45556D]">Vista previa {pdfPages ? `· Página ${pdfPage} de ${pdfPages}` : ""}</span>
          {pdfPages > 1 && <span className="flex items-center gap-1">
            <button type="button" className="btn btn-ghost px-2" disabled={pdfPage === 1 || pdfLoading} onClick={() => void changePage(pdfPage - 1)} aria-label="Página anterior"><ChevronLeft size={16} /></button>
            <button type="button" className="btn btn-ghost px-2" disabled={pdfPage === pdfPages || pdfLoading} onClick={() => void changePage(pdfPage + 1)} aria-label="Página siguiente"><ChevronRight size={16} /></button>
          </span>}
        </div>
        <div className="relative min-h-40 overflow-auto rounded-lg bg-white p-2">
          <canvas ref={canvasRef} className="mx-auto block h-auto max-w-full" />
          {pdfLoading && <div className="absolute inset-0 grid place-items-center bg-white/80"><LoadingState compact label="Procesando PDF..." /></div>}
        </div>
      </div>}
      {pdfError && <div className="mt-3"><Alert kind="error">{pdfError}</Alert></div>}
      {pdfA4Note && <div className="mt-3"><Alert kind="warning">{pdfA4Note}</Alert></div>}
      {file && !pdfError && !pdfLoading && <label className="mt-4 flex items-start gap-2.5 text-sm text-[#172033]">
        <input type="checkbox" className="mt-0.5" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} />
        <span>Confirmo que el documento está completo y legible, y que se visualizan claramente los textos, fechas, firmas, sellos y anotaciones.</span>
      </label>}
    </section>

    <section className="section-card">
      <h2 className="section-title">G. Resumen y registrar</h2>
      <dl className="mt-3 grid gap-x-8 gap-y-1 sm:grid-cols-2">
        {[
          ["Colaborador", colaborador ? `${colaborador.nombre} (${colaborador.codigo_personal})` : "—"],
          ["Reemplazo", reemplazo ? reemplazo.nombre : "—"],
          ["Vacaciones físicas", fisicasInicio && fisicasFin ? `${fisicasInicio} → ${fisicasFin} (${fisicasDias ?? "—"} días)` : "—"],
          ["Venta de vacaciones", tieneVenta ? (ventaInicio && ventaFin ? `${ventaInicio} → ${ventaFin} (${ventaDias ?? "—"} días)` : "Pendiente de completar") : "No"],
          ["Cliente", cliente?.nombre ?? "—"],
          ["Unidad", unidad?.nombre ?? "—"],
          ["Provincia", provincias.rows.find(p => p.id === provinciaId)?.nombre ?? "—"],
          ["Coordinador", coordinadorNombre],
          ["Documento", file?.name ?? "—"],
        ].map(([label, value]) => <div key={label} className="min-w-0 border-t border-[#E8EDF4] py-2">
          <dt className="text-xs font-medium text-[#607089]">{label}</dt><dd className="mt-0.5 break-words text-sm font-medium text-[#172033]">{value}</dd>
        </div>)}
      </dl>
      {error && <div className="mt-4"><Alert kind="error">{error}</Alert></div>}
      <footer className="mt-5 flex flex-col-reverse gap-2 border-t border-[#DCE3EC] pt-4 sm:flex-row sm:justify-end">
        <Link href="/documentos/vacaciones" className="btn btn-secondary">Cancelar</Link>
        <button onClick={() => void submit()} disabled={saving || !ready} className="btn btn-primary w-full sm:w-auto">
          {saving ? <LoaderCircle className="animate-spin" size={17} /> : <FileUp size={17} />} {saving ? "Registrando..." : "Registrar papeleta"}
        </button>
      </footer>
    </section>
  </div>;
}

"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, LoaderCircle, SlidersHorizontal } from "lucide-react";
import { AdminFiltersForm } from "@/components/admin-filters";
import { AdminResults } from "@/components/admin-results";
import { Alert } from "@/components/ui/alert";
import { Toast } from "@/components/ui/toast";
import { adminFiltersSchema, EMPTY_FILTERS, filterParams, type AdminFilters } from "@/lib/admin/filters";
import type { AdminOptions, AdminResult } from "@/lib/admin/types";
import type { IncompleteRequirement } from "@/lib/admin/sidige";
import type { Estado } from "@/lib/types";

type Notice = { kind: "success" | "error" | "info"; text: string; issues?: IncompleteRequirement[]; totalIncomplete?: number };
const sessionMessage = "Tu sesión pudo haber caducado. Vuelve a iniciar sesión y reintenta.";
async function readJson(response: Response) {
  if (response.redirected || response.headers.get("Content-Type")?.includes("text/html")) throw new Error(sessionMessage);
  if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("El servidor no devolvió una respuesta válida. Intenta nuevamente.");
  return response.json();
}
export function AdminRequirements({ initial, options, initialFilters = EMPTY_FILTERS }: {
  initial: AdminResult; options: AdminOptions; initialFilters?: AdminFilters;
}) {
  const [result, setResult] = useState(initial);
  const [draft, setDraft] = useState(initialFilters);
  const [applied, setApplied] = useState(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(() => Object.values(initialFilters).some(Boolean));
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [exporting, setExporting] = useState<"sidige" | "csv" | "">("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [toast, setToast] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const downloadRef = useRef<AbortController | null>(null);
  const updateRef = useRef(false);
  const exportingRef = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const closeToast = useCallback(() => setToast(""), []);
  useEffect(() => () => { requestRef.current?.abort(); downloadRef.current?.abort(); }, []);

  async function load(filters: AdminFilters, page: number) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/requerimientos?" + filterParams(filters, page), { signal: controller.signal, cache: "no-store" });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(payload.error || "No se pudo consultar la información.");
      if (controller.signal.aborted) return;
      const data = payload as AdminResult;
      const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (page > lastPage) { await load(filters, lastPage); return; }
      setResult(data); setApplied(filters);
      window.history.replaceState(null, "", "/admin/requerimientos?" + filterParams(filters, data.page));
    } catch (error) {
      if (!controller.signal.aborted) setNotice({ kind: "error", text: error instanceof Error ? error.message : "No se pudo consultar la información." });
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }
  function apply() {
    const parsed = adminFiltersSchema.safeParse(draft);
    if (!parsed.success) { setNotice({ kind: "error", text: parsed.error.issues[0].message }); return; }
    setDraft(parsed.data); setNotice(null); void load(parsed.data, 1);
  }
  function clear() { setDraft(EMPTY_FILTERS); setNotice(null); void load(EMPTY_FILTERS, 1); }
  async function update(id: string, estado: Estado) {
    if (updateRef.current || exportingRef.current || loading) return;
    updateRef.current = true; setBusy(id); setNotice(null);
    try {
      const response = await fetch("/api/admin/requerimientos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, estado }) });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(payload.error || "No se pudo actualizar el estado.");
      setNotice({ kind: "success", text: "Estado actualizado correctamente." });
      // Recalcular contador y página: la fila puede dejar de cumplir el filtro de estado.
      await load(applied, result.page);
    } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : "No se pudo actualizar el estado." }); }
    finally { updateRef.current = false; setBusy(""); }
  }
  async function download(kind: "sidige" | "csv") {
    if (exportingRef.current || updateRef.current || loading || dirty) return;
    if (!result.total) { setNotice({ kind: "info", text: "No hay requerimientos para exportar con los filtros seleccionados." }); return; }
    exportingRef.current = true; setExporting(kind); setNotice(null);
    const controller = new AbortController();
    downloadRef.current = controller;
    try {
      const response = await fetch(`/api/admin/requerimientos/${kind}?` + filterParams(applied), { signal: controller.signal, cache: "no-store" });
      if (!response.ok) {
        const payload = await readJson(response);
        setNotice({ kind: "error", text: payload.error || "No se pudo generar el archivo.", issues: payload.issues, totalIncomplete: payload.totalIncomplete });
        return;
      }
      const contentType = response.headers.get("Content-Type") ?? "";
      if (response.redirected || contentType.includes("text/html")) throw new Error(sessionMessage);
      if (!contentType.includes(kind === "sidige" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv")) throw new Error("No recibimos un archivo válido. Intenta nuevamente.");
      const blob = await response.blob();
      const filename = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? (kind === "sidige" ? "MIGRADOR_RENOVACION_VERANO.xlsx" : "requerimientos.csv");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice({ kind: "success", text: "Archivo listo: " + filename });
      setToast(kind === "sidige" ? "Excel generado correctamente" : "CSV generado correctamente");
    } catch (error) {
      if (!controller.signal.aborted) setNotice({ kind: "error", text: error instanceof Error ? error.message : "No se pudo descargar el archivo. Intenta nuevamente." });
    } finally { exportingRef.current = false; setExporting(""); }
  }
  const disabled = Boolean(exporting || busy);
  const activeCount = Object.values(applied).filter(Boolean).length;
  return <section className="min-w-0">
    <header className="page-header flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div><h1 className="page-title">Administración</h1><p className="page-description">Consulta requerimientos, actualiza estados y prepara la importación SIDIGE.</p></div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row lg:shrink-0">
        <button className="btn btn-secondary" disabled={disabled || loading || dirty} onClick={() => download("csv")}>{exporting === "csv" ? <LoaderCircle className="animate-spin" size={17}/> : <Download size={17}/>}Exportar CSV</button>
        <button className="btn btn-primary sm:min-w-[219px]" disabled={disabled || loading || dirty} onClick={() => download("sidige")}>{exporting === "sidige" ? <LoaderCircle className="animate-spin" size={17}/> : <FileSpreadsheet size={17}/>} {exporting === "sidige" ? "Generando Excel..." : "Exportar Excel SIDIGE"}</button>
      </div>
    </header>
    <div className="card">
      <button onClick={() => setFiltersOpen(value => !value)} className="flex min-h-12 w-full items-center gap-2 rounded-xl px-4 text-left text-sm font-medium sm:px-5" aria-expanded={filtersOpen} aria-controls="admin-filter-panel"><SlidersHorizontal size={17} className="text-[var(--text-secondary)]"/>Filtros<span className="text-xs font-normal text-[var(--text-secondary)]">{activeCount ? `· ${activeCount} aplicados` : "· Todos los requerimientos"}</span><ChevronDown size={16} className={`ml-auto shrink-0 ${filtersOpen ? "rotate-180" : ""}`}/></button>
      <div id="admin-filter-panel" hidden={!filtersOpen}><AdminFiltersForm value={draft} options={options} disabled={disabled || loading} dirty={dirty} onChange={setDraft} onApply={apply} onClear={clear}/></div>
    </div>
    {notice && <div className="mt-4 break-words"><Alert kind={notice.kind}>
      <p>{notice.text}</p>
      {notice.issues && <ul className="mt-2 list-disc space-y-2 pl-4">{notice.issues.map(issue => <li key={issue.id}><Link className="underline underline-offset-2" href={`/requerimientos/${issue.id}`}>{issue.agente} · {issue.id}</Link><p className="font-normal">{issue.campos.join(", ")}</p></li>)}</ul>}
      {notice.totalIncomplete && notice.totalIncomplete > (notice.issues?.length ?? 0) ? <p className="mt-2 font-normal">Se muestran los primeros {notice.issues?.length} de {notice.totalIncomplete} requerimientos incompletos. Reduce los filtros para revisarlos.</p> : null}
      {notice.kind === "error" && !notice.issues && <button onClick={() => { setNotice(null); void load(applied, result.page); }} disabled={loading || disabled} className="mt-2 underline underline-offset-2">Volver a consultar</button>}
    </Alert></div>}
    <AdminResults result={result} loading={loading} busy={busy} disabled={disabled} onUpdate={update} onPage={page => { setNotice(null); void load(applied, page); }}/>
    <Toast message={toast} onClose={closeToast}/>
  </section>;
}

import type { PapeletaEstado } from "@/lib/vacations/types";
import { papeletaEstadoLabel } from "@/lib/vacations/types";

const styles: Record<PapeletaEstado, string> = {
  REGISTRADO: "border-slate-200 bg-slate-50 text-slate-700",
  OBSERVADO: "border-amber-200 bg-amber-50 text-amber-800",
  // Visualmente distinto de FIRMADO a propósito: es un estado legado sin metadatos de firma real,
  // nunca debe confundirse con una papeleta efectivamente firmada por el nuevo flujo.
  CONFORME: "border-slate-300 bg-slate-100 text-slate-600",
  FIRMADO: "border-emerald-200 bg-emerald-50 text-emerald-800",
};
export function PapeletaEstadoBadge({ estado }: { estado: PapeletaEstado }) {
  return <span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-semibold leading-none ${styles[estado]}`}>{papeletaEstadoLabel[estado]}</span>;
}

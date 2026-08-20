import type { Estado } from "@/lib/types";
export function StatusBadge({ estado }: { estado: Estado }) {
  const cls = { Pendiente: "bg-orange-100 text-orange-800", Atendido: "bg-emerald-100 text-emerald-800", Observado: "bg-red-100 text-red-800" }[estado];
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${cls}`}>{estado}</span>;
}

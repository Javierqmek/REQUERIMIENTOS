import { LEGACY_CLIENT, LEGACY_UNIT } from "@/lib/requerimientos";
import type { Requerimiento } from "@/lib/types";

export function RequirementFacts({ row }: { row: Requerimiento }) {
  const facts = [
    ["Agente", row.personal?.nombre], ["DNI", row.personal?.dni], ["Cargo", row.personal?.cargo],
    ["Cliente", row.clientes?.nombre ?? LEGACY_CLIENT], ["Unidad", row.unidades?.nombre ?? LEGACY_UNIT],
    ["Fecha", new Intl.DateTimeFormat("es-PE", { dateStyle: "long", timeStyle: "short", timeZone: "America/Lima" }).format(new Date(row.fecha))],
    ["Referencia", row.referencia_interna],
  ];
  return <section className="section-card">
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1"><h2 className="section-title">Datos del requerimiento</h2><span className="text-xs text-[#607089]">Solo lectura</span></div>
    <dl className="grid grid-cols-2 gap-x-5 lg:grid-cols-3">{facts.map(([label, value]) => <div key={label} className={`min-w-0 border-t border-[#E8EDF4] py-2.5 ${label === "Agente" ? "col-span-2 sm:col-span-1" : ""}`}>
      <dt className="text-xs font-medium text-[#607089]">{label}</dt><dd className="mt-0.5 break-words text-sm text-[#172033]">{value || "—"}</dd>
    </div>)}</dl>
  </section>;
}

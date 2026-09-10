import { formatMoney } from "@/lib/requirements/money";

export function RequirementTotal({ count, total }: { count: number; total: number }) {
  return <dl aria-label="Resumen del requerimiento" className="mt-3 grid gap-2 rounded-lg border border-[#D7E3F4] bg-[#F5F8FD] px-3.5 py-3 sm:grid-cols-2 sm:items-center">
    <div className="flex items-baseline justify-between gap-3 sm:justify-start">
      <dt className="text-xs text-[#607089]">Prendas seleccionadas</dt>
      <dd className="text-sm font-semibold tabular-nums text-[#172033]">{count}</dd>
    </div>
    <div className="flex items-baseline justify-between gap-3 sm:justify-end">
      <dt className="text-xs text-[#607089]">Total del requerimiento</dt>
      <dd className="text-base font-semibold tabular-nums text-[#0B1F3A]">{formatMoney(total)}</dd>
    </div>
  </dl>;
}

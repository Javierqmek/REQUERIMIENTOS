import Link from "next/link";
import { CalendarDays, FileText, MapPin, PlaneTakeoff, UserRound } from "lucide-react";
import type { PapeletaRow } from "@/lib/vacations/types";
import { PapeletaEstadoBadge } from "./papeleta-estado-badge";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00Z`));
}

export function VacationRequestList({ rows, showCoordinador = false }: { rows: PapeletaRow[]; showCoordinador?: boolean }) {
  if (!rows.length) return <div className="card px-5 py-8 text-center">
    <FileText className="mx-auto text-[#8794A8]" size={28} />
    <p className="mt-3 text-sm font-medium text-[#45556D]">Todavía no hay papeletas de vacaciones registradas.</p>
  </div>;

  return <div className="grid min-w-0 gap-2.5">
    {rows.map(row => <Link href={`/documentos/vacaciones/${row.id}`} key={row.id} className={`card group grid min-w-0 gap-3 p-4 hover:border-[#B9C9DF] ${row.estado === "OBSERVADO" ? "border-amber-300" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#EAF2FF] text-[#174EA6]"><PlaneTakeoff size={18} /></span>
          <span className="min-w-0">
            <strong className="block truncate text-sm font-semibold text-[#0B1F3A]">{row.colaborador_nombre}</strong>
            <span className="block text-xs text-[#607089]">Código {row.colaborador_codigo}{showCoordinador && row.profiles?.nombre ? ` · Coordinador: ${row.profiles.nombre}` : ""}</span>
          </span>
        </span>
        <PapeletaEstadoBadge estado={row.estado} />
      </div>
      {row.estado === "OBSERVADO" && row.motivo_observacion && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><strong className="font-semibold">Motivo: </strong>{row.motivo_observacion}</p>}
      <dl className="grid gap-2 text-xs text-[#607089] sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex items-center gap-1.5"><CalendarDays size={13} /><span>Registrado: {new Intl.DateTimeFormat("es-PE", { dateStyle: "medium" }).format(new Date(row.created_at))}</span></div>
        <div className="flex items-center gap-1.5"><CalendarDays size={13} /><span>Físicas: {formatDate(row.fisicas_fecha_inicio)} → {formatDate(row.fisicas_fecha_fin)} ({row.fisicas_dias} días)</span></div>
        <div className="flex items-center gap-1.5"><CalendarDays size={13} /><span>Venta: {row.tiene_venta && row.venta_fecha_inicio && row.venta_fecha_fin ? `${formatDate(row.venta_fecha_inicio)} → ${formatDate(row.venta_fecha_fin)} (${row.venta_dias} días)` : "No"}</span></div>
        <div className="flex items-center gap-1.5"><UserRound size={13} /><span>Reemplazo: {row.reemplazo?.nombre ?? "—"}</span></div>
        <div className="flex items-center gap-1.5"><MapPin size={13} /><span>Provincia: {row.provincias?.nombre ?? "—"}</span></div>
        <div className="flex items-center gap-1.5"><MapPin size={13} /><span>{row.clientes?.nombre ?? "—"} · {row.unidades?.nombre ?? "—"}</span></div>
      </dl>
    </Link>)}
  </div>;
}

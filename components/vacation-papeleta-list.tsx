import Link from "next/link";
import { CalendarDays, FileSignature, FileText, PlaneTakeoff } from "lucide-react";
import type { PapeletaRow } from "@/lib/vacations/types";
import { PapeletaEstadoBadge } from "./papeleta-estado-badge";

// Tarjeta compacta ÚNICA para los tres roles (coordinador/superadmin/gerente): colaborador, código,
// estado, fecha de registro, coordinador (salvo para el propio coordinador), cliente, unidad y
// "Ver detalle". Todo lo demás (físicas, venta, días, reemplazo, provincia) vive solo en el
// detalle -- nunca se vuelve a mostrar aquí. "Firmar" se ofrece al gerente cuando corresponde.
export function VacationPapeletaList({ rows, role }: { rows: PapeletaRow[]; role: "coordinador" | "superadmin" | "gerente" }) {
  if (!rows.length) return <div className="card px-5 py-8 text-center">
    <FileText className="mx-auto text-[#8794A8]" size={28} />
    <p className="mt-3 text-sm font-medium text-[#45556D]">No hay papeletas de vacaciones para los filtros seleccionados.</p>
  </div>;

  return <div className="grid min-w-0 gap-2.5">
    {rows.map(row => {
      const puedeFirmar = role === "gerente" && row.estado === "REGISTRADO";
      return <div key={row.id} className={`card grid min-w-0 gap-3 p-4 sm:flex sm:items-center sm:justify-between ${row.estado === "OBSERVADO" ? "border-amber-300" : ""}`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#EAF2FF] text-[#174EA6]"><PlaneTakeoff size={18} /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="truncate text-sm font-semibold text-[#0B1F3A]">{row.colaborador_nombre}</strong>
              <span className="text-xs text-[#607089]">({row.colaborador_codigo})</span>
              <PapeletaEstadoBadge estado={row.estado} />
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-[#607089]">
              <CalendarDays size={12} />Registrado: {new Intl.DateTimeFormat("es-PE", { dateStyle: "medium" }).format(new Date(row.created_at))}
              {role !== "coordinador" && row.profiles?.nombre ? ` · Coordinador: ${row.profiles.nombre}` : ""}
            </p>
            <p className="mt-0.5 truncate text-xs text-[#607089]">{row.clientes?.nombre ?? "—"} · {row.unidades?.nombre ?? "—"}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 sm:justify-end">
          <Link href={`/documentos/vacaciones/${row.id}`} className="btn btn-secondary px-3">Ver detalle</Link>
          {puedeFirmar && <Link href={`/documentos/vacaciones/${row.id}`} className="btn btn-primary px-3"><FileSignature size={16} />Firmar</Link>}
        </div>
      </div>;
    })}
  </div>;
}

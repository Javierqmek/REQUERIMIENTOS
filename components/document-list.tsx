import Link from "next/link";
import { FileText,ArrowRight,CalendarDays,UserRound,PenLine } from "lucide-react";
import type { DocumentRow } from "@/lib/documents/types";
import { documentTypeLabel } from "@/lib/documents/types";
import { DocumentStatusBadge } from "./document-status-badge";
export function DocumentList({rows,empty="No hay documentos en esta vista."}:{rows:DocumentRow[];empty?:string}){
 if(!rows.length)return <div className="card px-5 py-8 text-center"><FileText className="mx-auto text-[#8794A8]" size={28}/><p className="mt-3 text-sm font-medium text-[#45556D]">{empty}</p></div>;
 return <div className="grid min-w-0 gap-2.5">{rows.map(row=><Link href={`/documentos/${row.id}`} key={row.id} className="card group grid min-w-0 gap-3 overflow-hidden p-4 hover:border-[#B9C9DF] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
  <span className="flex min-w-0 items-start gap-3"><span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#EAF2FF] text-[#174EA6]"><FileText size={18}/></span>
  <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-[.04em] text-[#174EA6]">{documentTypeLabel[row.tipo]}</span><DocumentStatusBadge status={row.estado}/>{row.coordinador_firmado_at&&<span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold leading-none text-emerald-800">Firmado por coordinador</span>}</span><strong className="mt-1 block truncate text-sm font-semibold text-[#0B1F3A]">{row.personal?.nombre||"Trabajador"}</strong>
  <span className="mt-1.5 grid gap-1 text-xs text-[#607089] sm:grid-cols-2"><span className="flex min-w-0 items-center gap-1.5"><UserRound size={13}/><span className="truncate">Creado por: {row.creador?.nombre||"Sin identificar"}</span></span><span className="flex min-w-0 items-center gap-1.5"><PenLine size={13}/><span className="truncate">Firmante: {row.firmante?.nombre||"Sin asignar"}</span></span><span className="flex items-center gap-1.5"><CalendarDays size={13}/>{new Intl.DateTimeFormat("es-PE",{dateStyle:"medium"}).format(new Date(row.created_at))}</span></span></span></span>
  <span className="btn btn-secondary w-full shrink-0 sm:w-auto">Revisar <ArrowRight size={16}/></span>
 </Link>)}</div>
}

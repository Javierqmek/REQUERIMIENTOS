import Link from "next/link";
import { FileText,ArrowRight } from "lucide-react";
import type { DocumentRow } from "@/lib/documents/types";
import { DocumentStatusBadge } from "./document-status-badge";
export function DocumentList({rows,empty="No hay documentos en esta vista."}:{rows:DocumentRow[];empty?:string}){
 if(!rows.length)return <div className="card px-5 py-8 text-center"><FileText className="mx-auto text-[#8794A8]" size={28}/><p className="mt-3 text-sm font-medium text-[#45556D]">{empty}</p></div>;
 return <div className="grid gap-3">{rows.map(row=><Link href={`/documentos/${row.id}`} key={row.id} className="card group flex items-center gap-4 p-4 hover:border-[#B9C9DF]">
  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EAF2FF] text-[#174EA6]"><FileText size={19}/></span>
  <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm font-semibold text-[#0B1F3A]">{row.personal?.nombre||"Trabajador"}</strong><DocumentStatusBadge status={row.estado}/></span>
  <span className="mt-1 block truncate text-xs text-[#607089]">{row.tipo} · {row.archivo_original_nombre} · {new Intl.DateTimeFormat("es-PE",{dateStyle:"medium"}).format(new Date(row.created_at))}</span></span><ArrowRight size={17} className="shrink-0 text-[#8794A8] group-hover:text-[#174EA6]"/>
 </Link>)}</div>
}

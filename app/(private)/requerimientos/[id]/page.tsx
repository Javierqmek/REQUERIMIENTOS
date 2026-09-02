import { DETAIL_REQUIREMENT_SELECT } from "@/lib/requerimientos";
import { getCurrentProfile } from "@/lib/auth";
import { canEditRequirement, ATTENDED_MESSAGE } from "@/lib/requirements/edit";
import { RequirementFacts } from "@/components/requirement-facts";
import { Alert } from "@/components/ui/alert";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";
import type { Requerimiento } from "@/lib/types";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function DetailPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params; const supabase=await createClient();
  const [{data}, profile]=await Promise.all([
    supabase.from("requerimientos").select(DETAIL_REQUIREMENT_SELECT).eq("id",id).eq("detalle_requerimiento.activo",true).single(),
    getCurrentProfile(),
  ]);
  if(!data)notFound(); const row=data as unknown as Requerimiento;
  return <section className="mx-auto max-w-[920px]"><Link href="/requerimientos" className="btn btn-ghost mb-3 -ml-3"><ArrowLeft size={16}/>Volver a mis requerimientos</Link><div className="page-header flex flex-wrap items-start justify-between gap-3"><h1 className="page-title">Detalle del requerimiento</h1><StatusBadge estado={row.estado}/></div>
    <RequirementFacts row={row}/>
    {canEditRequirement(profile,row) && <div className="mt-4 flex justify-end"><Link href={`/requerimientos/${row.id}/editar`} className="btn btn-secondary">Editar prendas</Link></div>}
    {row.estado === "Atendido" && <div className="mt-4"><Alert kind="info">{ATTENDED_MESSAGE}</Alert></div>}
    <div className="section-card mt-4"><h2 className="section-title mb-3">Prendas solicitadas</h2><div className="divide-y divide-[#E8EDF4] border-y border-[#E8EDF4]">{row.detalle_requerimiento?.map(d=><div key={d.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_90px_130px_110px] sm:items-center"><strong className="text-sm font-medium text-[#172033]">{d.prendas?.nombre_prenda}</strong><span className="text-xs text-[#607089]"><b className="block font-medium text-[#45556D] sm:hidden">Cantidad</b>{d.cantidad}</span><span className="text-xs text-[#607089]"><b className="block font-medium text-[#45556D] sm:hidden">Código</b>{d.codigo_almacen}</span><span className="text-xs text-[#607089]"><b className="block font-medium text-[#45556D] sm:hidden">Precio</b>S/ {Number(d.precio_unitario).toFixed(2)}</span></div>)}</div></div>
  </section>;
}

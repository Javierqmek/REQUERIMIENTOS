import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";
import type { Requerimiento } from "@/lib/types";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function DetailPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params; const supabase=await createClient();
  const {data}=await supabase.from("requerimientos").select("id,fecha,referencia_interna,estado,personal(nombre,dni,cargo,cliente,unidad),profiles(nombre,email),detalle_requerimiento(id,cantidad,precio_unitario,codigo_almacen,prendas(nombre_prenda))").eq("id",id).single();
  if(!data)notFound(); const row=data as unknown as Requerimiento;
  return <section className="mx-auto max-w-[920px]"><Link href="/requerimientos" className="btn btn-ghost mb-3 -ml-3"><ArrowLeft size={16}/>Volver a mis requerimientos</Link><div className="page-header flex flex-wrap items-start justify-between gap-3"><div><p className="page-eyebrow">Detalle del requerimiento</p><h1 className="page-title">{row.personal?.nombre}</h1></div><StatusBadge estado={row.estado}/></div>
    <div className="section-card"><dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">{[["Fecha",new Intl.DateTimeFormat("es-PE",{dateStyle:"long",timeStyle:"short"}).format(new Date(row.fecha))],["DNI",row.personal?.dni],["Cargo",row.personal?.cargo],["Cliente",row.personal?.cliente],["Unidad",row.personal?.unidad],["Estado",row.estado]].map(([k,v])=><div key={k} className="border-t border-[#E8EDF4] py-2.5"><dt className="text-xs font-medium text-[#607089]">{k}</dt><dd className="mt-0.5 text-sm font-medium text-[#172033]">{v}</dd></div>)}</dl></div>
    <div className="section-card mt-4"><h2 className="section-title mb-3">Prendas solicitadas</h2><div className="divide-y divide-[#E8EDF4] border-y border-[#E8EDF4]">{row.detalle_requerimiento?.map(d=><div key={d.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_90px_130px_110px] sm:items-center"><strong className="text-sm font-medium text-[#172033]">{d.prendas?.nombre_prenda}</strong><span className="text-xs text-[#607089]"><b className="block font-medium text-[#45556D] sm:hidden">Cantidad</b>{d.cantidad}</span><span className="text-xs text-[#607089]"><b className="block font-medium text-[#45556D] sm:hidden">Código</b>{d.codigo_almacen}</span><span className="text-xs text-[#607089]"><b className="block font-medium text-[#45556D] sm:hidden">Precio</b>S/ {Number(d.precio_unitario).toFixed(2)}</span></div>)}</div></div>
  </section>;
}

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
  return <section className="mx-auto max-w-3xl"><Link href="/requerimientos" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:underline"><ArrowLeft size={17}/>Volver a mis requerimientos</Link><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold text-blue-600">DETALLE DEL REQUERIMIENTO</p><h1 className="mt-1 text-2xl font-black">{row.personal?.nombre}</h1></div><StatusBadge estado={row.estado}/></div>
    <div className="card mt-5 p-5"><dl className="grid gap-4 text-sm sm:grid-cols-2">{[["Fecha",new Intl.DateTimeFormat("es-PE",{dateStyle:"long",timeStyle:"short"}).format(new Date(row.fecha))],["DNI",row.personal?.dni],["Cargo",row.personal?.cargo],["Cliente",row.personal?.cliente],["Unidad",row.personal?.unidad],["Estado",row.estado]].map(([k,v])=><div key={k}><dt className="font-bold text-slate-500">{k}</dt><dd className="mt-1">{v}</dd></div>)}</dl></div>
    <div className="card mt-5 p-5"><h2 className="mb-4 text-lg font-extrabold">Prendas solicitadas</h2><div className="space-y-3">{row.detalle_requerimiento?.map(d=><div key={d.id} className="rounded-xl border border-slate-200 p-4"><strong>{d.prendas?.nombre_prenda}</strong><div className="mt-2 grid grid-cols-3 gap-2 text-sm"><span><b className="block text-slate-500">Cantidad</b>{d.cantidad}</span><span><b className="block text-slate-500">Código</b>{d.codigo_almacen}</span><span><b className="block text-slate-500">Precio</b>S/ {Number(d.precio_unitario).toFixed(2)}</span></div></div>)}</div></div>
  </section>;
}

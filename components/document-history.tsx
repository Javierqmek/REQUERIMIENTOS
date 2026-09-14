"use client";
import { useMemo,useState } from "react";
import { ChevronDown,ChevronUp,Clock3,Download } from "lucide-react";

type Event={id:string;accion:string;comentario:string|null;created_at:string;profiles:unknown};
const important=new Set(["CREADO","FIRMADO_COORDINADOR","ENVIADO","OBSERVADO","RECHAZADO","FIRMADO"]);
const labels:Record<string,string>={CREADO:"Documento creado",FIRMADO_COORDINADOR:"Firmado por coordinador",ENVIADO:"Enviado al gerente",OBSERVADO:"Documento observado",RECHAZADO:"Documento rechazado",FIRMADO:"Firmado por gerente",COLOCACIONES_ACTUALIZADAS:"Ubicación de firma actualizada",DESCARGADO:"Documento descargado"};
const actor=(event:Event)=>(event.profiles as {nombre?:string}|null)?.nombre||"Usuario";
const date=(value:string)=>new Intl.DateTimeFormat("es-PE",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));

function EventRow({event}:{event:Event}){
 return <li className="relative grid gap-0.5 border-l border-[#DCE3EC] pb-4 pl-5 last:pb-0"><span className="absolute -left-1 top-1 h-2 w-2 rounded-full bg-[#2563EB]"/><strong className="text-sm font-medium text-[#172033]">{labels[event.accion]||event.accion.replaceAll("_"," ").toLowerCase()}</strong><span className="text-xs text-[#607089]">{actor(event)} · {date(event.created_at)}</span>{event.comentario&&<p className="mt-1 text-sm text-[#45556D]">{event.comentario}</p>}</li>
}
export function DocumentHistory({events}:{events:Event[]}){
 const [expanded,setExpanded]=useState(false);
 const summary=useMemo(()=>events.filter(event=>important.has(event.accion)).slice().reverse(),[events]);
 const downloads=events.filter(event=>event.accion==="DESCARGADO");
 const technical=events.filter(event=>!important.has(event.accion)&&event.accion!=="DESCARGADO").slice().reverse();
 return <section className="section-card mt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="section-title">Historial</h2><p className="metadata mt-1">Hitos principales del documento</p></div><button className="btn btn-ghost px-2" onClick={()=>setExpanded(value=>!value)} aria-expanded={expanded}>{expanded?<ChevronUp size={16}/>:<ChevronDown size={16}/>} {expanded?"Ocultar trazabilidad":"Ver trazabilidad completa"}</button></div>
 <ol className="mt-5">{summary.map(event=><EventRow key={event.id} event={event}/>)}</ol>
 {expanded&&<div className="mt-5 border-t border-[#DCE3EC] pt-4"><h3 className="flex items-center gap-2 text-sm font-semibold text-[#0B1F3A]"><Clock3 size={16}/>Trazabilidad técnica</h3>{downloads.length>0&&<details className="mt-3 rounded-lg border border-[#DCE3EC] bg-[#F8FAFC] px-3 py-2"><summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[#45556D]"><Download size={15}/>Documento descargado {downloads.length} {downloads.length===1?"vez":"veces"}</summary><ol className="mt-2 space-y-1 border-t border-[#DCE3EC] pt-2">{downloads.map(event=><li className="text-xs text-[#607089]" key={event.id}>{actor(event)} · {date(event.created_at)}</li>)}</ol></details>}<ol className="mt-4">{technical.map(event=><EventRow key={event.id} event={event}/>)}</ol>{downloads.length===0&&technical.length===0&&<p className="mt-3 text-sm text-[#607089]">No hay eventos técnicos adicionales.</p>}</div>}
 </section>
}

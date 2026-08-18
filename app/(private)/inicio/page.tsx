import Link from "next/link";
import { ArrowRight, ClipboardList, FilePlus2 } from "lucide-react";

const options = [
  { href: "/requerimientos/nuevo", title: "Crear nuevo requerimiento", text: "Registrar prendas para un agente", icon: FilePlus2 },
  { href: "/requerimientos", title: "Mis requerimientos", text: "Ver y consultar tus requerimientos", icon: ClipboardList },
];
export default function InicioPage() {
  return <div className="py-4 sm:py-10">
    <header className="mb-8 max-w-2xl"><p className="mb-2 text-sm font-bold uppercase tracking-[.18em] text-blue-600">Gestión operativa</p><h1 className="text-3xl font-black tracking-tight sm:text-4xl">REQUERIMIENTOS DE UNIFORMES</h1><p className="mt-3 text-slate-600">Gestiona los requerimientos de uniformes de tus agentes</p></header>
    <section className="grid gap-4 md:grid-cols-2">{options.map(({href,title,text,icon:Icon}) => <Link key={href} href={href} className="card group flex min-h-44 items-center gap-5 p-6 transition hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl"><span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700"><Icon size={32}/></span><span className="min-w-0 flex-1"><span className="block text-lg font-extrabold">{title}</span><span className="mt-2 block text-sm text-slate-500">{text}</span></span><ArrowRight className="text-slate-400 transition group-hover:translate-x-1 group-hover:text-blue-600"/></Link>)}</section>
  </div>;
}

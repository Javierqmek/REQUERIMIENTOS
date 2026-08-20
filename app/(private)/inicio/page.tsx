import Link from "next/link";
import { ArrowRight, ClipboardList, FilePlus2 } from "lucide-react";

const options = [
  { href: "/requerimientos/nuevo", title: "Crear nuevo requerimiento", text: "Registrar prendas para un agente", icon: FilePlus2 },
  { href: "/requerimientos", title: "Mis requerimientos", text: "Ver y consultar tus requerimientos", icon: ClipboardList },
];
export default function InicioPage() {
  return <div className="mx-auto max-w-5xl">
    <header className="page-header"><p className="page-eyebrow">Gestión operativa</p><h1 className="page-title">Requerimientos de uniformes</h1><p className="page-description">Gestiona los requerimientos de uniformes de tus agentes.</p></header>
    <section className="grid gap-3 md:grid-cols-2">{options.map(({href,title,text,icon:Icon}) => <Link key={href} href={href} className="card group flex min-h-28 items-center gap-4 p-5 hover:border-[#B9C9DF] hover:shadow-[0_3px_10px_rgba(11,31,58,.07)]"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EAF2FF] text-[#174EA6]"><Icon size={20}/></span><span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold text-[#0B1F3A]">{title}</span><span className="mt-1 block text-sm text-[#607089]">{text}</span></span><ArrowRight size={18} className="text-[#8794A8] group-hover:text-[#174EA6]"/></Link>)}</section>
  </div>;
}

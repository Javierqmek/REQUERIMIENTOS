import Link from "next/link";
import { ArrowRight, ClipboardList, FilePlus2, FileSignature } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";

const uniformOptions = [
  { href: "/requerimientos/nuevo", title: "Crear nuevo requerimiento", text: "Registrar prendas para un agente", icon: FilePlus2 },
  { href: "/requerimientos", title: "Mis requerimientos", text: "Ver y consultar tus requerimientos", icon: ClipboardList },
];
export default async function InicioPage() {
  const profile = await getCurrentProfile();
  const options = profile?.role === "gerente"
    ? [{ href: "/documentos", title: "Documentos por firmar", text: "Revisar, observar o firmar documentos asignados", icon: FileSignature }]
    : [...uniformOptions, { href: "/documentos", title: "Gestión de documentos", text: "Crear, revisar y firmar documentos internos", icon: FileSignature }];
  return <div className="mx-auto max-w-5xl">
    <header className="page-header"><p className="page-eyebrow">Gestión operativa</p><h1 className="page-title">Centro de operaciones</h1><p className="page-description">Accede a los módulos disponibles para tu perfil.</p></header>
    <section className="grid gap-3 md:grid-cols-2">{options.map(({href,title,text,icon:Icon}) => <Link key={href} href={href} className="card group flex min-h-28 items-center gap-4 p-5 hover:border-[#B9C9DF] hover:shadow-[0_3px_10px_rgba(11,31,58,.07)]"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#EAF2FF] text-[#174EA6]"><Icon size={20}/></span><span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold text-[#0B1F3A]">{title}</span><span className="mt-1 block text-sm text-[#607089]">{text}</span></span><ArrowRight size={18} className="text-[#8794A8] group-hover:text-[#174EA6]"/></Link>)}</section>
  </div>;
}

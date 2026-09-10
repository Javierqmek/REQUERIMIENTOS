"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const sections=[{href:"/admin/requerimientos",label:"Requerimientos"},{href:"/admin/mantenimiento",label:"Mantenimiento"},{href:"/admin/importaciones",label:"Importaciones"}];
export function AdminSectionNav(){const pathname=usePathname();return <nav aria-label="Secciones de Administración" className="mb-5 overflow-x-auto border-b border-[var(--border)]"><div className="flex min-w-max gap-1">{sections.map(item=><Link key={item.href} href={item.href} aria-current={pathname===item.href?"page":undefined} className={`border-b-2 px-3 py-2.5 text-sm font-medium ${pathname===item.href?"border-[var(--brand-600)] text-[var(--brand-700)]":"border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>{item.label}</Link>)}</div></nav>}

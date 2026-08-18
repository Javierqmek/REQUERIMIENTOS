"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, Home, LogOut, ShieldCheck, Shirt, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useState } from "react";

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter();
  const [confirming,setConfirming]=useState(false); const [loggingOut,setLoggingOut]=useState(false);
  const links = [{ href: "/inicio", label: "Inicio", icon: Home }, { href: "/requerimientos", label: "Mis requerimientos", icon: ClipboardList }];
  async function logout() { setLoggingOut(true); await createClient().auth.signOut(); router.replace("/login"); router.refresh(); }
  return <div className="min-h-screen pb-24">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/inicio" className="flex items-center gap-3 font-extrabold text-blue-700"><span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white"><Shirt size={23}/></span><span className="hidden sm:block">Uniformes</span></Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {profile.role === "admin" && <Link className="btn bg-blue-50 text-blue-700" href="/admin/requerimientos"><ShieldCheck size={18}/><span className="hidden sm:inline">Administración</span></Link>}
          <div className="hidden border-l border-slate-200 pl-3 md:block"><p className="max-w-40 truncate text-sm font-bold text-slate-700">{profile.nombre}</p><p className="text-xs capitalize text-slate-500">{profile.role}</p></div>
          <button className="btn btn-secondary px-3 sm:px-4" onClick={()=>setConfirming(true)}><UserRound size={18}/><span className="hidden lg:inline">{profile.nombre}</span><LogOut size={17}/><span className="hidden sm:inline">Cerrar sesión</span></button>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden"><div className="grid grid-cols-2">
      {links.map(({href,label,icon:Icon}) => <Link key={href} href={href} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-bold ${pathname === href ? "text-blue-700" : "text-slate-500"}`}><Icon size={21}/>{label}</Link>)}
    </div></nav>
    <ConfirmDialog open={confirming} busy={loggingOut} onCancel={()=>setConfirming(false)} onConfirm={logout}/>
  </div>;
}

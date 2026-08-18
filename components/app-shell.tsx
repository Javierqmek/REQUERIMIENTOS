"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, Home, LogOut, ShieldCheck, Shirt } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter();
  const links = [{ href: "/inicio", label: "Inicio", icon: Home }, { href: "/requerimientos", label: "Mis requerimientos", icon: ClipboardList }];
  async function logout() { await createClient().auth.signOut(); router.replace("/login"); router.refresh(); }
  return <div className="min-h-screen pb-24">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/inicio" className="flex items-center gap-3 font-extrabold text-blue-700"><span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white"><Shirt size={23}/></span><span className="hidden sm:block">Uniformes</span></Link>
        <div className="flex items-center gap-2">
          {profile.role === "admin" && <Link className="btn bg-blue-50 text-blue-700" href="/admin/requerimientos"><ShieldCheck size={18}/><span className="hidden sm:inline">Administración</span></Link>}
          <button aria-label="Cerrar sesión" className="btn text-slate-600 hover:bg-slate-100" onClick={logout}><LogOut size={19}/></button>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden"><div className="grid grid-cols-2">
      {links.map(({href,label,icon:Icon}) => <Link key={href} href={href} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-bold ${pathname === href ? "text-blue-700" : "text-slate-500"}`}><Icon size={21}/>{label}</Link>)}
    </div></nav>
  </div>;
}

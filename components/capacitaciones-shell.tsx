"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { GraduationCap, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// Shell PROPIA del módulo de Capacitaciones -- deliberadamente distinta de AppShell (que asume
// roles admin/coordinador/gerente y enlaces a Requerimientos/Documentos, irrelevantes aquí).
export function CapacitacionesShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const gestor = profile.role === "admin" || profile.role === "capacitador";
  const links = gestor
    ? [
        { href: "/capacitaciones/gestion", label: "Gestión" },
        ...(profile.role === "admin" ? [{ href: "/capacitaciones/gestion/agentes", label: "Agentes" }] : []),
      ]
    : [{ href: "/capacitaciones", label: "Mis capacitaciones" }];
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    await createClient().auth.signOut();
    router.replace("/login"); router.refresh();
  }
  return <div className="min-h-screen pb-6">
    <header className="sticky top-0 z-30 border-b border-[#DCE3EC] bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-6 px-4 sm:px-6">
        <span className="flex items-center gap-2.5 text-[#0B1F3A]"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#0B1F3A] text-white"><GraduationCap size={19} /></span><span className="text-[16px] font-semibold tracking-tight">Capacitaciones</span></span>
        <nav className="hidden h-full items-center gap-1 sm:flex" aria-label="Navegación">
          {links.map(({ href, label }) => <Link key={href} href={href} className={`flex h-full items-center border-b-2 px-3 text-sm font-medium ${pathname === href || pathname.startsWith(`${href}/`) ? "border-[#2563EB] text-[#174EA6]" : "border-transparent text-[#607089] hover:text-[#172033]"}`}>{label}</Link>)}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-2 sm:flex"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#EAF2FF] text-[#174EA6]"><UserRound size={17} /></span><span className="max-w-[160px] truncate text-sm font-medium text-[#172033]">{profile.nombre}</span></span>
          <button className="btn btn-ghost px-2" onClick={() => setConfirming(true)} aria-label="Cerrar sesión"><LogOut size={17} /></button>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-7">{children}</main>
    <ConfirmDialog open={confirming} busy={loggingOut} onCancel={() => setConfirming(false)} onConfirm={logout} />
  </div>;
}

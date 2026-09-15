"use client";
import Link from "next/link";
import { usePathname,useRouter } from "next/navigation";
import { ChevronDown,ClipboardList,FileSignature,Home,LogOut,PenLine,ShieldCheck,Shirt,UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useEffect,useRef,useState } from "react";

export function AppShell({profile,children}:{profile:Profile;children:React.ReactNode}){
  const pathname=usePathname();const router=useRouter();const menuRef=useRef<HTMLDivElement>(null);
  const [menuOpen,setMenuOpen]=useState(false);const [confirming,setConfirming]=useState(false);
  const [loggingOut,setLoggingOut]=useState(false);const [logoutError,setLogoutError]=useState("");
  const links=[
    {href:"/inicio",label:"Inicio",icon:Home},
    ...(["admin","coordinador"].includes(profile.role)?[{href:"/requerimientos",label:"Mis requerimientos",icon:ClipboardList}]:[]),
    {href:"/documentos",label:"Documentos",icon:FileSignature},
    ...(profile.role==="admin"?[{href:"/admin/requerimientos",label:"Administración",icon:ShieldCheck}]:[]),
  ];
  useEffect(()=>{function close(event:MouseEvent){if(menuRef.current&&!menuRef.current.contains(event.target as Node))setMenuOpen(false)}document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close)},[]);
  async function logout(){if(loggingOut)return;setLoggingOut(true);setLogoutError("");try{const {error}=await createClient().auth.signOut();if(error)throw error;router.replace("/login");router.refresh()}catch{setLogoutError("No pudimos cerrar la sesión. Reintenta antes de abandonar este equipo.");setLoggingOut(false)}}
  function active(href:string){return pathname===href||pathname.startsWith(`${href}/`)||(href==="/admin/requerimientos"&&pathname.startsWith("/admin/"))}
  return <div className="min-h-screen pb-20 lg:pb-0">
    <header className="sticky top-0 z-30 border-b border-[#DCE3EC] bg-white/95 backdrop-blur"><div className="mx-auto flex h-16 max-w-7xl items-center gap-7 px-4 sm:px-6">
      <Link href="/inicio" className="flex shrink-0 items-center gap-2.5 text-[#0B1F3A]"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#0B1F3A] text-white"><Shirt size={19}/></span><span className="text-[16px] font-semibold tracking-tight">Uniformes</span></Link>
      <nav className="hidden h-full items-center gap-1 lg:flex" aria-label="Navegación principal">{links.map(({href,label})=><Link key={href} href={href} className={`flex h-full items-center border-b-2 px-3 text-sm font-medium ${active(href)?"border-[#2563EB] text-[#174EA6]":"border-transparent text-[#607089] hover:text-[#172033]"}`}>{label}</Link>)}</nav>
      <div className="relative ml-auto" ref={menuRef}><button aria-expanded={menuOpen} aria-haspopup="menu" onClick={()=>setMenuOpen(v=>!v)} className="flex h-10 max-w-[210px] items-center gap-2 rounded-lg border border-transparent px-2 text-left hover:border-[#DCE3EC] hover:bg-[#F5F8FD]"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#EAF2FF] text-[#174EA6]"><UserRound size={17}/></span><span className="hidden min-w-0 sm:block"><span className="block truncate text-sm font-medium text-[#172033]">{profile.nombre}</span></span><ChevronDown size={16} className="shrink-0 text-[#607089]"/></button>
        {menuOpen&&<div role="menu" className="absolute right-0 top-12 w-64 rounded-xl border border-[#DCE3EC] bg-white p-2 shadow-[0_12px_32px_rgba(11,31,58,.12)]"><div className="border-b border-[#DCE3EC] px-3 py-2.5"><p className="truncate text-xs text-[#607089]">{profile.email}</p><p className="mt-1 text-xs capitalize text-[#607089]">{profile.role}</p></div>
          {profile.role==="admin"&&<Link role="menuitem" href="/admin/perfiles-firma" onClick={()=>setMenuOpen(false)} className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-[#45556D] hover:bg-[#F5F8FD]"><PenLine size={17}/>Perfiles de firma</Link>}
          {profile.role!=="admin"&&<Link role="menuitem" href="/perfil/firma" onClick={()=>setMenuOpen(false)} className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-[#45556D] hover:bg-[#F5F8FD]"><PenLine size={17}/>Firma y sello</Link>}
          <button role="menuitem" className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-[#C53030] hover:bg-red-50" onClick={()=>{setMenuOpen(false);setConfirming(true)}}><LogOut size={17}/>Cerrar sesión</button>
        </div>}
      </div>
    </div></header>
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7">{children}</main>
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-[#DCE3EC] bg-white lg:hidden" aria-label="Navegación móvil"><div className="grid" style={{gridTemplateColumns:`repeat(${links.length},minmax(0,1fr))`}}>{links.map(({href,label,icon:Icon})=><Link key={href} href={href} className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium ${active(href)?"text-[#174EA6]":"text-[#607089]"}`}><Icon size={19}/><span className="max-w-full truncate">{label}</span></Link>)}</div></nav>
    <ConfirmDialog error={logoutError} open={confirming} busy={loggingOut} onCancel={()=>setConfirming(false)} onConfirm={logout}/>
  </div>;
}

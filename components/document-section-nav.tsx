import Link from "next/link";
import { FolderOpen,FilePlus2,Clock3,PlaneTakeoff,Wrench } from "lucide-react";
import type { Role } from "@/lib/types";
// El módulo Documentos pasa a organizarse por TIPO documental (Vacaciones primero; Licencias
// con/sin goce, Descuentos y Renuncias se agregarán aquí más adelante, cada uno con su propia
// bandeja y detalle, igual que Vacaciones). "Mis documentos"/"Historial"/"Pendientes" eran la
// navegación genérica del módulo de Documentos/Firma original: se mantienen (no se borra nada
// ni se pierde el histórico/auditoría que ya contienen) pero dejan de ser la entrada principal,
// por eso se muestran después de los tipos documentales en vez de primero.
export function DocumentSectionNav({role}:{role:Role}){
  const documentTypes=[{href:"/documentos/vacaciones",label:"Vacaciones",icon:PlaneTakeoff},...(role==="superadmin"?[{href:"/documentos/vacaciones/mantenimiento",label:"Mantenimiento",icon:Wrench}]:[])];
  const legacyGeneric=[{href:"/documentos",label:role==="gerente"?"Historial":"Mis documentos",icon:FolderOpen},...(role==="coordinador"?[{href:"/documentos/nuevo",label:"Nuevo documento",icon:FilePlus2}]:[]),...(role==="gerente"?[{href:"/documentos/pendientes",label:"Pendientes",icon:Clock3}]:[])];
  const links=[...documentTypes,...legacyGeneric];
  return <nav aria-label="Secciones de documentos" className="mb-5 flex gap-1 overflow-x-auto border-b border-[#DCE3EC]">{links.map(({href,label,icon:Icon})=><Link key={href} href={href} className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-[#607089] hover:border-[#B9C9DF] hover:text-[#174EA6]"><Icon size={16}/>{label}</Link>)}</nav>;
}

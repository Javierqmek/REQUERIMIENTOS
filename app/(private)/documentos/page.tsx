import Link from "next/link";
import { FilePlus2,PenLine } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { DocumentList } from "@/components/document-list";
import { DocumentSectionNav } from "@/components/document-section-nav";
import type { DocumentRow } from "@/lib/documents/types";

const select="id,tipo,trabajador_id,usuario_creador_id,firmante_id,estado,observacion,comentario_decision,archivo_original_nombre,archivo_original_path,archivo_coordinador_path,archivo_coordinador_sha256,coordinador_firmado_at,coordinador_firmante_id,archivo_firmado_path,paginas,created_at,enviado_at,firmado_at,personal(nombre,dni,cargo),creador:profiles!documentos_usuario_creador_id_fkey(nombre),firmante:profiles!documentos_firmante_id_fkey(nombre)";
export default async function DocumentsPage(){
 const profile=await getCurrentProfile();const db=await createClient();let query=db.from("documentos").select(select).order("created_at",{ascending:false}).limit(100);
 if(profile?.role==="gerente")query=query.eq("firmante_id",profile.id);else if(profile?.role==="coordinador")query=query.eq("usuario_creador_id",profile.id);
 const {data}=await query;return <section className="mx-auto max-w-5xl">{profile&&<DocumentSectionNav role={profile.role}/>}<header className="page-header flex flex-wrap items-end justify-between gap-3"><div><p className="page-eyebrow">Gestión documental</p><h1 className="page-title">{profile?.role==="gerente"?"Historial documental":"Mis documentos"}</h1><p className="page-description">Documentos internos, trazabilidad y firma electrónica.</p></div><div className="flex gap-2">{profile?.role==="coordinador"&&<Link href="/documentos/nuevo" className="btn btn-primary"><FilePlus2 size={17}/>Nuevo documento</Link>}{profile&&profile.role!=="admin"&&<Link href="/perfil/firma" className="btn btn-secondary"><PenLine size={17}/>Firma y sello</Link>}</div></header><DocumentList rows={(data||[]) as unknown as DocumentRow[]}/></section>
}

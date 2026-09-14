import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { DocumentList } from "@/components/document-list";
import { DocumentSectionNav } from "@/components/document-section-nav";
import type { DocumentRow } from "@/lib/documents/types";

export default async function PendingDocumentsPage(){
 const profile=await getCurrentProfile();if(profile?.role!=="gerente")redirect("/documentos");const db=await createClient();
 const {data}=await db.from("documentos").select("id,tipo,trabajador_id,usuario_creador_id,firmante_id,estado,observacion,comentario_decision,archivo_original_nombre,archivo_original_path,archivo_coordinador_path,archivo_coordinador_sha256,coordinador_firmado_at,coordinador_firmante_id,archivo_firmado_path,paginas,created_at,enviado_at,firmado_at,personal(nombre,dni,cargo),creador:profiles!documentos_usuario_creador_id_fkey(nombre),firmante:profiles!documentos_firmante_id_fkey(nombre)").eq("firmante_id",profile.id).eq("estado","PENDIENTE_FIRMA").order("enviado_at",{ascending:true}).limit(100);
 return <section className="mx-auto max-w-5xl"><DocumentSectionNav role={profile.role}/><header className="page-header"><p className="page-eyebrow">Bandeja de firma</p><h1 className="page-title">Pendientes de firma</h1><p className="page-description">Revisa el contenido y la colocación antes de firmar.</p></header><DocumentList rows={(data||[]) as unknown as DocumentRow[]} empty="No tienes documentos pendientes de firma."/></section>
}

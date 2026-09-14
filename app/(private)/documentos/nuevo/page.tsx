import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NewDocumentForm } from "@/components/new-document-form";
import { DocumentSectionNav } from "@/components/document-section-nav";
export default async function NewDocumentPage(){const profile=await getCurrentProfile();if(profile?.role!=="coordinador")redirect("/documentos");const db=await createClient();const {data}=await db.rpc("listar_gerentes_firma");return <section className="mx-auto max-w-5xl"><DocumentSectionNav role={profile.role}/><header className="page-header"><p className="page-eyebrow">Gestión documental</p><h1 className="page-title">Nuevo documento</h1><p className="page-description">Carga el original y asigna al gerente responsable de la firma.</p></header><NewDocumentForm managers={(data||[]) as {id:string;nombre:string}[]}/></section>}

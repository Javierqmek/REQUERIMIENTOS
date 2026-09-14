import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignatureProfileForm } from "@/components/signature-profile-form";

export default async function SignaturePage(){
 const profile=await getCurrentProfile();if(!profile||!["coordinador","gerente"].includes(profile.role))redirect("/documentos");
 const db=await createClient();const {data}=await db.from("perfiles_firma").select("nombre_mostrado,cargo,firma_path,created_at").eq("usuario_id",profile.id).eq("activo",true).maybeSingle();
 return <section className="mx-auto max-w-5xl"><header className="page-header"><p className="page-eyebrow">Mi perfil</p><h1 className="page-title">Mi firma y sello</h1><p className="page-description">Configura la evidencia visual que se incorporará a tus documentos internos.</p></header><SignatureProfileForm initialName={data?.nombre_mostrado||profile.nombre} initialRole={data?.cargo||profile.role} configured={Boolean(data)} hasSignature={Boolean(data?.firma_path)} updatedAt={data?.created_at}/><p className="mt-4 text-xs text-[#607089]">Esta es una firma electrónica interna. No constituye una firma digital certificada.</p></section>
}

import { redirect } from "next/navigation";
import { UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";
import { AgentesVinculadosList } from "@/components/agentes-vinculados-list";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AgentesVinculadosPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const profile = await getCurrentCapacitacionProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "superadmin") redirect("/capacitaciones/gestion");
  const { q } = await searchParams;
  const busqueda = q?.trim() || "";
  const db = await createClient();
  let query = db.from("personal").select("id,nombre,dni,codigo_personal,email").not("profile_id", "is", null).order("nombre").limit(200);
  if (busqueda) query = query.or(`nombre.ilike.%${busqueda}%,dni.ilike.%${busqueda}%,codigo_personal.ilike.%${busqueda}%`);
  const { data, error } = await query;

  return <section>
    <header className="page-header">
      <p className="page-eyebrow">Capacitaciones</p>
      <h1 className="page-title">Agentes vinculados</h1>
      <p className="page-description">Cuentas de Google ya vinculadas a un colaborador. Desvincula para corregir un vínculo indebido.</p>
    </header>
    <form className="mb-4" action="/capacitaciones/gestion/agentes">
      <input className="input" type="search" name="q" defaultValue={busqueda} placeholder="Buscar por nombre, DNI o código de personal..." />
    </form>
    {error ? <div className="card px-5 py-8 text-center text-sm text-[#C53030]">No pudimos cargar los agentes.</div>
      : !data?.length ? <div className="card px-5 py-8 text-center"><UserRound className="mx-auto text-[#8794A8]" size={28} /><p className="mt-3 text-sm font-medium text-[#45556D]">{busqueda ? "Ningún agente vinculado coincide con la búsqueda." : "Todavía no hay agentes vinculados."}</p></div>
      : <AgentesVinculadosList agentes={data} />}
  </section>;
}

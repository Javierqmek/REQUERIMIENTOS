import { assertSameOrigin } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });

// Corrige una vinculación indebida (DNI equivocado, cuenta de Google incorrecta, etc.): quita
// personal.profile_id y le retira el rol agente al perfil que estaba vinculado -- solo admin.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const profile = await getCurrentCapacitacionProfile();
    if (!profile || profile.role !== "superadmin") return json({ error: "No autorizado." }, 403);
    const { id } = await params;
    const db = await createClient();
    const { error } = await db.rpc("desvincular_agente", { p_personal_id: id });
    if (error) return json({ error: error.code === "P0002" ? "Colaborador no encontrado." : "No se pudo desvincular." }, error.code === "P0002" ? 404 : 400);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo desvincular." }, 400);
  }
}

import { assertSameOrigin } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; preguntaId: string }> }) {
  try {
    assertSameOrigin(request);
    const profile = await getCurrentCapacitacionProfile();
    if (!profile || (profile.role !== "superadmin" && profile.role !== "capacitador")) return json({ error: "No autorizado." }, 403);
    const { preguntaId } = await params;
    const db = await createClient();
    const { error } = await db.from("examen_preguntas").delete().eq("id", preguntaId);
    if (error) return json({ error: "No se pudo eliminar la pregunta." }, 400);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo eliminar la pregunta." }, 400);
  }
}

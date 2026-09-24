import { assertSameOrigin } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const profile = await getCurrentCapacitacionProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "capacitador")) return json({ error: "No autorizado." }, 403);
    const id = (await params).id;
    const db = await createClient();
    const { data, error } = await db.rpc("publicar_capacitacion", { p_capacitacion_id: id });
    if (error) return json({ error: error.message }, error.code === "P0002" ? 404 : 400);
    return json(data);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo publicar la capacitación." }, 400);
  }
}

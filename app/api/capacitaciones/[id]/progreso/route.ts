import { assertSameOrigin, readJsonBody } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const id = (await params).id;
    const body = await readJsonBody(request, 1024) as { porcentaje?: number };
    const porcentaje = Number(body.porcentaje);
    if (!Number.isFinite(porcentaje)) return json({ error: "Progreso inválido." }, 400);
    const db = await createClient();
    const { data, error } = await db.rpc("registrar_progreso_video", { p_capacitacion_id: id, p_porcentaje: Math.round(porcentaje) });
    if (error) return json({ error: error.message }, error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400);
    return json(data);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo registrar el progreso." }, 400);
  }
}

import { z } from "zod";
import { assertSameOrigin, readJsonBody } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const schema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["superadmin", "admin", "coordinador", "gerente", "capacitador", "agente", "sin_vincular"]),
});

// Solo superadmin puede cambiar roles -- la RPC vuelve a validar server-side (nunca confía en
// este chequeo del lado de la ruta) y evita que un superadmin se quite su propio rol por accidente.
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const profile = await getCurrentProfile();
    if (!profile || profile.role !== "superadmin") return json({ error: "No autorizado." }, 403);
    const parsed = schema.safeParse(await readJsonBody(request, 512));
    if (!parsed.success) return json({ error: "Datos inválidos." }, 400);
    const db = await createClient();
    const { error } = await db.rpc("superadmin_cambiar_rol", { p_user_id: parsed.data.user_id, p_role: parsed.data.role });
    if (error) {
      if (error.code === "P0002") return json({ error: "Usuario no encontrado." }, 404);
      if (error.code === "22023") return json({ error: error.message }, 400);
      return json({ error: "No se pudo cambiar el rol." }, 400);
    }
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo cambiar el rol." }, 400);
  }
}

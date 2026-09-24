import { z } from "zod";
import { HttpInputError, readJsonBody } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const schema = z.object({ nota_minima: z.number().int().min(0).max(20) });

// Ajusta la nota mínima para aprobar (escala 0-20) mientras la capacitación esté en borrador --
// a diferencia del resto del material, esto se puede editar en cualquier momento, no solo al
// crearla. La RPC vuelve a validar rango + estado + dueño server-side, nunca confía en el cliente.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profile = await getCurrentCapacitacionProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "capacitador")) return json({ error: "No autorizado." }, 403);
    const id = (await params).id;
    const parsed = schema.safeParse(await readJsonBody(request, 512));
    if (!parsed.success) return json({ error: "La nota mínima debe estar entre 0 y 20." }, 400);
    const db = await createClient();
    const { error } = await db.rpc("actualizar_nota_minima", { p_capacitacion_id: id, p_nota_minima: parsed.data.nota_minima });
    if (error) return json({ error: error.code === "P0002" ? "No se pudo actualizar (revisa que siga en borrador)." : "No se pudo actualizar la nota mínima." }, error.code === "P0002" ? 409 : 400);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : "No se pudo actualizar la nota mínima." }, 400);
  }
}

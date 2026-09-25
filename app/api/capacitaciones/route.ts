import { z } from "zod";
import { assertSameOrigin, readJsonBody } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const schema = z.object({
  titulo: z.string().trim().min(3).max(200),
  descripcion: z.string().trim().max(2000).optional().nullable(),
  porcentaje_minimo_visto: z.number().int().min(1).max(100).default(80),
  nota_minima: z.number().int().min(0).max(20).default(14),
  fecha_vencimiento: z.string().optional().nullable(),
});

// Crea una capacitación en BORRADOR. El capacitador/admin la completa (video, examen, asignación)
// antes de publicarla -- ver /api/capacitaciones/[id]/publicar.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const profile = await getCurrentCapacitacionProfile();
    if (!profile || (profile.role !== "superadmin" && profile.role !== "capacitador")) return json({ error: "No autorizado." }, 403);
    const parsed = schema.safeParse(await readJsonBody(request, 8192));
    if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
    const db = await createClient();
    const { data, error } = await db.from("capacitaciones").insert({
      titulo: parsed.data.titulo, descripcion: parsed.data.descripcion || null,
      porcentaje_minimo_visto: parsed.data.porcentaje_minimo_visto, nota_minima: parsed.data.nota_minima,
      fecha_vencimiento: parsed.data.fecha_vencimiento || null, capacitador_id: profile.id,
    }).select("id").single();
    if (error || !data) return json({ error: "No se pudo crear la capacitación." }, 400);
    return json({ id: data.id }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo crear la capacitación." }, 400);
  }
}

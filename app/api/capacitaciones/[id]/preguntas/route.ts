import { z } from "zod";
import { assertSameOrigin, readJsonBody } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const schema = z.object({
  enunciado: z.string().trim().min(3).max(500),
  opciones: z.array(z.object({ texto: z.string().trim().min(1).max(300), es_correcta: z.boolean() })).min(2).max(6),
}).refine(v => v.opciones.filter(o => o.es_correcta).length === 1, { message: "Marca exactamente una opción correcta.", path: ["opciones"] });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const profile = await getCurrentCapacitacionProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "capacitador")) return json({ error: "No autorizado." }, 403);
    const id = (await params).id;
    const parsed = schema.safeParse(await readJsonBody(request, 16384));
    if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);
    const db = await createClient();
    const { data: pregunta, error } = await db.from("examen_preguntas").insert({ capacitacion_id: id, enunciado: parsed.data.enunciado }).select("id").single();
    if (error || !pregunta) return json({ error: "No se pudo guardar la pregunta." }, 400);
    const { error: opcionesError } = await db.from("examen_opciones").insert(
      parsed.data.opciones.map((o, i) => ({ pregunta_id: pregunta.id, texto: o.texto, es_correcta: o.es_correcta, orden: i })),
    );
    if (opcionesError) { await db.from("examen_preguntas").delete().eq("id", pregunta.id); return json({ error: "No se pudieron guardar las opciones." }, 400); }
    return json({ id: pregunta.id }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo guardar la pregunta." }, 400);
  }
}

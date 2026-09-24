import { assertSameOrigin, readJsonBody } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";

const json = (body: unknown, status = 200) => Response.json(body, { status });

function statusFor(code: string | undefined) {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "55000") return 409;
  return 400;
}

// La calificación siempre ocurre en la RPC (server-side, security definer): esta ruta solo
// reenvía las respuestas del agente, nunca calcula ni confía en una nota calculada en el cliente.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const id = (await params).id;
    const body = await readJsonBody(request, 8192) as { respuestas?: unknown };
    if (!Array.isArray(body.respuestas)) return json({ error: "Respuestas inválidas." }, 400);
    const db = await createClient();
    const { data, error } = await db.rpc("enviar_examen", { p_capacitacion_id: id, p_respuestas: body.respuestas });
    if (error) return json({ error: error.message }, statusFor(error.code));
    return json(data);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo enviar el examen." }, 400);
  }
}

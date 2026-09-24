import { z } from "zod";
import { HttpInputError, readJsonBody } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";
import { extractYoutubeId } from "@/lib/capacitaciones/youtube";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const schema = z.object({ url: z.string().trim().min(1).max(500) });

// Alternativa a /subir para cuando el video pesa más de lo que permite el plan gratuito de
// Supabase (50 MB por archivo, más un tope mensual de almacenamiento/transferencia): en vez de
// subir el archivo, se guarda solo el ID de un video de YouTube (se recomienda "no listado") y
// el agente lo reproduce con la IFrame Player API -- no se sube nada ni se consume Storage.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profile = await getCurrentCapacitacionProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "capacitador")) return json({ error: "No autorizado." }, 403);
    const id = (await params).id;
    const db = await createClient();
    const { data: cap } = await db.from("capacitaciones").select("id,capacitador_id,estado").eq("id", id).maybeSingle();
    if (!cap) return json({ error: "Capacitación no encontrada." }, 404);
    if (cap.capacitador_id !== profile.id && profile.role !== "admin") return json({ error: "No autorizado." }, 403);
    if (cap.estado !== "BORRADOR") return json({ error: "Solo se puede reemplazar el material mientras está en borrador." }, 409);

    const parsed = schema.safeParse(await readJsonBody(request, 2048));
    if (!parsed.success) return json({ error: "Enlace inválido." }, 400);
    const videoId = extractYoutubeId(parsed.data.url);
    if (!videoId) return json({ error: "Pega un enlace válido de YouTube (youtube.com o youtu.be)." }, 400);

    // Un enlace de YouTube reemplaza cualquier video subido a Storage antes (una sola fuente a la vez).
    const { error } = await db.from("capacitaciones").update({
      video_youtube_id: videoId, video_path: null, video_nombre: null, video_bytes: null, updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return json({ error: "No se pudo guardar el enlace." }, 400);
    return json({ ok: true, video_youtube_id: videoId });
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : "No se pudo guardar el enlace." }, 400);
  }
}

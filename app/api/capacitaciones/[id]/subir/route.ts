import { z } from "zod";
import { HttpInputError, readJsonBody } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const BUCKET = "capacitaciones";
// 50 MB: límite global por archivo del plan gratuito de Supabase (no del bucket ni de la app).
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const VIDEO_TOO_BIG_MESSAGE = "El video debe pesar como máximo 50 MB. Comprímelo (por ejemplo a 720p) antes de subirlo.";

const schema = z.object({
  tipo: z.enum(["video", "pdf"]),
  nombre: z.string().trim().min(1).max(255),
  tamano: z.number().int().positive(),
  contentType: z.string().trim().min(1).max(200),
});

// Genera una URL de subida firmada: el navegador sube el archivo DIRECTO a Supabase Storage
// (ver /subir/confirmar), no a través de esta función serverless -- en Vercel cada request a una
// función tiene un límite de tamaño (4.5 MB) muy por debajo de un video, incluso con el límite
// de 50 MB de este módulo (el máximo por archivo del plan gratuito de Supabase).
// createSignedUploadUrl exige permiso "insert" vía RLS al momento de generarla (mismo chequeo
// capacitador_id=auth.uid() que antes), así que la autorización no cambia, solo el transporte.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profile = await getCurrentCapacitacionProfile();
    if (!profile || (profile.role !== "superadmin" && profile.role !== "capacitador")) return json({ error: "No autorizado." }, 403);
    const id = (await params).id;
    const db = await createClient();
    const { data: cap } = await db.from("capacitaciones").select("id,capacitador_id,estado").eq("id", id).maybeSingle();
    if (!cap) return json({ error: "Capacitación no encontrada." }, 404);
    if (cap.capacitador_id !== profile.id && profile.role !== "superadmin") return json({ error: "No autorizado." }, 403);
    if (cap.estado !== "BORRADOR") return json({ error: "Solo se puede reemplazar el material mientras está en borrador." }, 409);

    const parsed = schema.safeParse(await readJsonBody(request, 4096));
    if (!parsed.success) return json({ error: "Datos de archivo inválidos." }, 400);
    const { tipo, nombre, tamano, contentType } = parsed.data;

    if (tipo === "video") {
      if (tamano > MAX_VIDEO_BYTES) return json({ error: VIDEO_TOO_BIG_MESSAGE }, 413);
      if (!contentType.startsWith("video/")) return json({ error: "El archivo debe ser un video." }, 400);
      const ext = (nombre.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const path = `${id}/video.${ext}`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error || !data) return json({ error: "No se pudo preparar la subida del video." }, 400);
      return json({ signedUrl: data.signedUrl, token: data.token, path: data.path });
    }
    if (tipo === "pdf") {
      if (tamano > MAX_PDF_BYTES) return json({ error: "El PDF debe pesar como máximo 20 MB." }, 413);
      if (contentType !== "application/pdf") return json({ error: "El archivo debe ser un PDF." }, 400);
      const path = `${id}/material.pdf`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error || !data) return json({ error: "No se pudo preparar la subida del material." }, 400);
      return json({ signedUrl: data.signedUrl, token: data.token, path: data.path });
    }
    return json({ error: "Tipo de archivo inválido." }, 400);
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : "No se pudo preparar la subida." }, 400);
  }
}

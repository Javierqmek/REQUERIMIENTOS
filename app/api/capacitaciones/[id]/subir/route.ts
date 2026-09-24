import { assertSameOrigin } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const BUCKET = "capacitaciones";
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

// Sube el video o el PDF de apoyo a Storage (ruta determinista por capacitación) y actualiza la
// fila. No se sobreescribe silenciosamente: un archivo nuevo reemplaza al anterior en Storage
// (misma ruta fija, no versionado -- una capacitación en BORRADOR se puede corregir libremente;
// una vez PUBLICADA, el capacitador ya no puede cambiar el video, ver RLS de capacitaciones_update
// más la validación de estado aquí abajo).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const profile = await getCurrentCapacitacionProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "capacitador")) return json({ error: "No autorizado." }, 403);
    const id = (await params).id;
    const db = await createClient();
    const { data: cap } = await db.from("capacitaciones").select("id,capacitador_id,estado").eq("id", id).maybeSingle();
    if (!cap) return json({ error: "Capacitación no encontrada." }, 404);
    if (cap.capacitador_id !== profile.id && profile.role !== "admin") return json({ error: "No autorizado." }, 403);
    if (cap.estado !== "BORRADOR") return json({ error: "Solo se puede reemplazar el material mientras está en borrador." }, 409);

    const form = await request.formData();
    const tipo = String(form.get("tipo") || "");
    const file = form.get("archivo");
    if (!(file instanceof File)) return json({ error: "Selecciona un archivo." }, 400);
    if (tipo === "video") {
      if (file.size > MAX_VIDEO_BYTES) return json({ error: "El video debe pesar como máximo 500 MB." }, 413);
      if (!file.type.startsWith("video/")) return json({ error: "El archivo debe ser un video." }, 400);
      const path = `${id}/video.${(file.name.split(".").pop() || "mp4").toLowerCase()}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const upload = await db.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: true });
      if (upload.error) return json({ error: "No se pudo subir el video." }, 400);
      await db.from("capacitaciones").update({ video_path: path, video_nombre: file.name, video_bytes: bytes.length, updated_at: new Date().toISOString() }).eq("id", id);
      return json({ ok: true });
    }
    if (tipo === "pdf") {
      if (file.size > MAX_PDF_BYTES) return json({ error: "El PDF debe pesar como máximo 20 MB." }, 413);
      if (file.type !== "application/pdf") return json({ error: "El archivo debe ser un PDF." }, 400);
      const path = `${id}/material.pdf`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const upload = await db.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (upload.error) return json({ error: "No se pudo subir el material." }, 400);
      await db.from("capacitaciones").update({ material_pdf_path: path, material_pdf_nombre: file.name, updated_at: new Date().toISOString() }).eq("id", id);
      return json({ ok: true });
    }
    return json({ error: "Tipo de archivo inválido." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo subir el archivo." }, 400);
  }
}

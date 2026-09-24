import { z } from "zod";
import { HttpInputError, readJsonBody } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });

const schema = z.object({
  tipo: z.enum(["video", "pdf"]),
  nombre: z.string().trim().min(1).max(255),
  tamano: z.number().int().positive(),
  path: z.string().trim().min(1).max(500),
});

// Se llama DESPUÉS de que el navegador subió el archivo directo a Storage con la URL firmada
// (ver /subir). Solo registra la ruta en la fila -- vuelve a validar todo por si el estado
// cambió entre generar la URL y terminar de subir (misma disciplina que el resto del módulo:
// nunca confiar en lo que hizo el cliente sin revalidar server-side).
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

    const parsed = schema.safeParse(await readJsonBody(request, 4096));
    if (!parsed.success) return json({ error: "Datos de confirmación inválidos." }, 400);
    const { tipo, nombre, tamano, path } = parsed.data;

    const expectedPath = tipo === "video" ? new RegExp(`^${id}/video\\.[a-z0-9]+$`) : `${id}/material.pdf`;
    const pathOk = tipo === "video" ? (expectedPath as RegExp).test(path) : path === expectedPath;
    if (!pathOk) return json({ error: "La ruta del archivo subido no coincide con lo esperado." }, 400);

    // Confirma que el objeto realmente existe en Storage (no confía en que el navegador diga
    // "terminé" -- podría haber fallado a mitad de camino sin que el cliente lo reportara).
    const folder = path.split("/").slice(0, -1).join("/");
    const filename = path.split("/").pop()!;
    const { data: listado } = await db.storage.from("capacitaciones").list(folder, { search: filename });
    if (!listado?.some(f => f.name === filename)) return json({ error: "No encontramos el archivo subido. Intenta de nuevo." }, 409);

    if (tipo === "video") {
      await db.from("capacitaciones").update({ video_path: path, video_nombre: nombre, video_bytes: tamano, updated_at: new Date().toISOString() }).eq("id", id);
    } else {
      await db.from("capacitaciones").update({ material_pdf_path: path, material_pdf_nombre: nombre, updated_at: new Date().toISOString() }).eq("id", id);
    }
    return json({ ok: true });
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : "No se pudo confirmar la subida." }, 400);
  }
}

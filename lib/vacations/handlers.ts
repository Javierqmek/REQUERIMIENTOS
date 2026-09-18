import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { assertSameOrigin } from "@/lib/security/http";
import { papeletaSchema } from "./validations";
import { MAX_PAPELETA_BYTES, PAPELETA_BUCKET, validatePapeletaPdf } from "./pdf";
import { isValidRequestId, papeletaStoragePath } from "./storage-path";

type Dependencies = { getProfile: () => Promise<Profile | null>; getDb: () => Promise<SupabaseClient> };
const json = (body: unknown, status = 200) => Response.json(body, { status });

// Extraído a una fábrica inyectable (mismo patrón que lib/requirements/handlers.ts) para
// poder probar la idempotencia con un cliente Supabase simulado, sin sesión ni red real.
export function makeRegisterPapeletaHandler(deps: Dependencies) {
  return async (request: Request) => {
    let uploadedPath = "";
    let uploadedNewFile = false;
    try {
      assertSameOrigin(request);
      const profile = await deps.getProfile();
      if (!profile || profile.role !== "coordinador") {
        return json({ error: "Solo coordinadores pueden registrar papeletas de vacaciones." }, 403);
      }
      const length = Number(request.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_PAPELETA_BYTES + 256 * 1024) {
        return json({ error: "Solicitud demasiado grande." }, 413);
      }
      const form = await request.formData();
      const file = form.get("archivo");
      if (!(file instanceof File)) return json({ error: "Selecciona un PDF." }, 400);
      if (form.get("confirmacion_legibilidad") !== "true") {
        return json({ error: "Debes confirmar que el documento está completo y legible." }, 400);
      }
      const requestId = String(form.get("request_id") || "");
      if (!isValidRequestId(requestId)) return json({ error: "Solicitud inválida." }, 400);

      const raw = {
        colaborador_id: String(form.get("colaborador_id") || ""),
        reemplazo_id: String(form.get("reemplazo_id") || ""),
        provincia_id: String(form.get("provincia_id") || ""),
        cliente_id: String(form.get("cliente_id") || ""),
        unidad_id: String(form.get("unidad_id") || ""),
        fisicas_fecha_inicio: String(form.get("fisicas_fecha_inicio") || ""),
        fisicas_fecha_fin: String(form.get("fisicas_fecha_fin") || ""),
        tiene_venta: form.get("tiene_venta") === "true",
        venta_fecha_inicio: form.get("venta_fecha_inicio") ? String(form.get("venta_fecha_inicio")) : null,
        venta_fecha_fin: form.get("venta_fecha_fin") ? String(form.get("venta_fecha_fin")) : null,
      };
      const parsed = papeletaSchema.safeParse(raw);
      if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);

      const db = await deps.getDb();

      // Reintento (doble clic, timeout, respuesta perdida): si ya existe una papeleta para
      // este coordinador + request_id, se devuelve sin releer el PDF, subir nada ni validar de nuevo.
      const existing = await db.from("papeletas_vacaciones").select("id")
        .eq("coordinador_id", profile.id).eq("request_id", requestId).maybeSingle();
      if (existing.data) return json({ id: (existing.data as { id: string }).id }, 200);

      const pdf = await validatePapeletaPdf(file);
      uploadedPath = papeletaStoragePath(profile.id, requestId);
      const upload = await db.storage.from(PAPELETA_BUCKET).upload(uploadedPath, pdf.bytes, { contentType: "application/pdf", upsert: false });
      if (upload.error) {
        // Path determinista: un "ya existe" solo puede venir de una carrera con otro intento
        // del mismo request_id que ya terminó de registrarse. Nunca se sobrescribe.
        const retry = await db.from("papeletas_vacaciones").select("id")
          .eq("coordinador_id", profile.id).eq("request_id", requestId).maybeSingle();
        if (retry.data) return json({ id: (retry.data as { id: string }).id }, 200);
        throw new Error("No se pudo almacenar el PDF.");
      }
      uploadedNewFile = true;

      const { data, error } = await db.rpc("registrar_papeleta_vacaciones", {
        p_request_id: requestId,
        p_colaborador_id: parsed.data.colaborador_id,
        p_reemplazo_id: parsed.data.reemplazo_id,
        p_provincia_id: parsed.data.provincia_id,
        p_cliente_id: parsed.data.cliente_id,
        p_unidad_id: parsed.data.unidad_id,
        p_fisicas_inicio: parsed.data.fisicas_fecha_inicio,
        p_fisicas_fin: parsed.data.fisicas_fecha_fin,
        p_tiene_venta: parsed.data.tiene_venta,
        p_venta_inicio: parsed.data.venta_fecha_inicio,
        p_venta_fin: parsed.data.venta_fecha_fin,
        p_archivo_path: uploadedPath,
        p_archivo_nombre: pdf.name,
        p_archivo_sha256: pdf.hash,
        p_archivo_bytes: pdf.bytes.length,
      });
      if (error) {
        // Solo se limpia el archivo subido en este intento; nunca uno de otro intento válido.
        if (uploadedNewFile) await db.storage.from(PAPELETA_BUCKET).remove([uploadedPath]);
        throw new Error(error.message);
      }
      return json({ id: data }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "No se pudo registrar la papeleta." }, 400);
    }
  };
}

import { z } from "zod";
import { HttpInputError, readJsonBody } from "@/lib/security/http";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { ATTENDED_MESSAGE, canEditRequirement, editGarmentsSchema, type EditPayload } from "./edit";

type Dependencies = { getProfile: () => Promise<Profile | null>; getDb: () => Promise<SupabaseClient> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export function makeEditGarmentsHandler(deps: Dependencies) {
  return async (request: Request, id: string) => {
    try {
      const profile = await deps.getProfile();
      if (!profile || !["admin", "coordinador"].includes(profile.role)) return json({ error: "No autorizado" }, 403);
      z.string().uuid().parse(id);
      const input = editGarmentsSchema.parse(await readJsonBody(request));
      const db = await deps.getDb();
      const loaded = await db.rpc("obtener_edicion_prendas", { p_id: id });
      if (loaded.error?.code === "42501") return json({ error: "No autorizado" }, 403);
      if (loaded.error || !loaded.data) return json({ error: "No pudimos cargar el requerimiento." }, 500);
      const row = (loaded.data as EditPayload).requerimiento;
      if (profile.role !== "admin" && row.usuario_creador_id !== profile.id) return json({ error: "No autorizado" }, 403);
      if (!canEditRequirement(profile, row)) return json({ error: ATTENDED_MESSAGE }, 409);
      const result = await db.rpc("editar_prendas_requerimiento", { p_id: id, p_version: input.version, p_detalles: input.detalles });
      if (result.error) {
        const code = result.error.code;
        if (code === "42501") return json({ error: "No autorizado" }, 403);
        if (code === "55000") return json({ error: ATTENDED_MESSAGE }, 409);
        if (code === "40001") return json({ error: "El requerimiento o el maestro cambió. Recarga la página antes de guardar." }, 409);
        if (["22023", "22P02", "23505"].includes(code)) return json({ error: "Revisa las prendas: no deben duplicarse y deben corresponder al cliente." }, 400);
        return json({ error: "No pudimos guardar los cambios. Intenta nuevamente." }, 500);
      }
      return json({ message: "Prendas actualizadas correctamente." });
    } catch (error) {
      if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
      return json({ error: error instanceof z.ZodError || error instanceof SyntaxError ? "Datos inválidos. Envía únicamente las prendas, sin modificar la cabecera." : "No pudimos guardar los cambios. Intenta nuevamente." }, error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500);
    }
  };
}

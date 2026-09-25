import { esAdminUniformes } from "@/lib/roles";
import { z } from "zod";
import { HttpInputError, readJsonBody } from "@/lib/security/http";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { ADMIN_STATES, parseAdminQuery } from "./filters";
import { exportRequirements, getAdminResults } from "./data";
import { buildSidigeWorkbook, EmptyExportError, ExportLimitError, sidigeFilename } from "./workbook";
import { SidigeValidationError } from "./sidige";
import { allowTestRequirementDeletion } from "./config";

type Dependencies = { getProfile: () => Promise<Profile | null>; getDb: () => Promise<SupabaseClient> };
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }
function errorResponse(error: unknown) {
  if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ error: "Revisa los filtros: " + error.issues.map(i => i.message).join(". ") }, 400);
  if (error instanceof SidigeValidationError) return json({ error: error.message, issues: error.issues, totalIncomplete: error.total }, 422);
  if (error instanceof EmptyExportError) return json({ error: error.message }, 404);
  if (error instanceof ExportLimitError) return json({ error: error.message }, 422);
  return json({ error: "No se pudo completar la operación. Intenta nuevamente o verifica la migración administrativa." }, 500);
}
export function makeAdminListHandler(deps: Dependencies) {
  return async (request: Request) => {
    try {
      if (!esAdminUniformes((await deps.getProfile())?.role)) return json({ error: "No autorizado" }, 403);
      const { filters, page } = parseAdminQuery(new URL(request.url).searchParams);
      return json(await getAdminResults(await deps.getDb(), filters, page, request.signal));
    } catch (error) { return errorResponse(error); }
  };
}
export function makeAdminUpdateHandler(deps: Dependencies) {
  return async (request: Request) => {
    try {
      if (!esAdminUniformes((await deps.getProfile())?.role)) return json({ error: "No autorizado" }, 403);
      const input = z.object({ id: z.string().uuid(), estado: z.enum(ADMIN_STATES) }).strict().parse(await readJsonBody(request, 4096));
      const db = await deps.getDb();
      const { data, error } = await db.from("requerimientos").update({ estado: input.estado }).eq("id", input.id).select("id,estado").single();
      if (error || !data) return json({ error: "No se pudo actualizar el estado." }, 500);
      return json(data);
    } catch (error) { return errorResponse(error); }
  };
}
export function makeAdminDeleteHandler(deps: Dependencies, enabled = allowTestRequirementDeletion) {
  return async (request: Request) => {
    try {
      if (!esAdminUniformes((await deps.getProfile())?.role)) return json({ error: "No autorizado" }, 403);
      if (!enabled()) return json({ error: "La eliminación de requerimientos de prueba está deshabilitada." }, 403);
      const input = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict().parse(await readJsonBody(request, 8192));
      if (new Set(input.ids).size !== input.ids.length) return json({ error: "No repitas requerimientos." }, 400);
      const { data, error } = await (await deps.getDb()).rpc("admin_eliminar_requerimientos_prueba", { p_ids: input.ids });
      if (error) return json({ error: error.code === "P0002" ? "Uno o más requerimientos ya no existen." : "No se pudieron eliminar los requerimientos." }, error.code === "P0002" ? 404 : 500);
      return json({ eliminados: Number(data) });
    } catch (error) { return errorResponse(error); }
  };
}
export function makeSidigeHandler(deps: Dependencies) {
  return async (request: Request) => {
    try {
      if (!esAdminUniformes((await deps.getProfile())?.role)) return json({ error: "No autorizado" }, 403);
      const { filters } = parseAdminQuery(new URL(request.url).searchParams);
      const bytes = await buildSidigeWorkbook(exportRequirements(await deps.getDb(), filters, request.signal), request.signal);
      return new Response(new Uint8Array(bytes), { headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${sidigeFilename()}"`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      } });
    } catch (error) { return errorResponse(error); }
  };
}

import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { esAdminUniformes } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { buildPrendasCsv, getPrendasExport, prendasExportFilename } from "@/lib/admin/prendas-export";
import { PRENDA_ESTADOS, prendasFilterShape } from "@/lib/admin/prendas-filters";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
// Sin estado en la URL se exportan todas (activas e inactivas); la pantalla envía el filtro Estado que tenga elegido.
const schema = z.object({ ...prendasFilterShape, estado: z.enum(PRENDA_ESTADOS).default("todas") });
// Exporta las prendas en el formato de la importación, respetando los mismos filtros que la lista de Mantenimiento:
// una fila por asignación y una fila sin cliente por cada prenda sin asignar (solo esas con el filtro "Sin asignar").
export async function GET(request: Request) {
  try {
    if (!esAdminUniformes((await getCurrentProfile())?.role)) return fail("No autorizado", 403);
    const filters = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const db = await createClient();
    let nombre: string | null = null;
    if (filters.cliente) {
      const { data } = await db.from("clientes").select("nombre").eq("id", filters.cliente).maybeSingle();
      if (!data) return fail("El cliente no existe.", 404);
      nombre = String(data.nombre);
    }
    const csv = buildPrendasCsv(await getPrendasExport(db, filters));
    const label = filters.sinAsignar ? "sin-asignar" : nombre;
    return new Response(csv, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${prendasExportFilename(new Date(), label)}"` } });
  } catch (error) {
    if (error instanceof z.ZodError) return fail("Filtros inválidos.", 400);
    return fail("No se pudo exportar las prendas.", 500);
  }
}

import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { esAdminUniformes } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { buildPrendasCsv, getPrendasExport, prendasExportFilename } from "@/lib/admin/prendas-export";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
// Exporta las asignaciones de prendas (todas, con su estado) en el formato de la importación. ?cliente=<uuid> filtra por cliente.
export async function GET(request: Request) {
  try {
    if (!esAdminUniformes((await getCurrentProfile())?.role)) return fail("No autorizado", 403);
    const cliente = z.union([z.literal(""), z.string().uuid()]).default("").parse(new URL(request.url).searchParams.get("cliente") ?? "");
    const db = await createClient();
    let nombre: string | null = null;
    if (cliente) {
      const { data } = await db.from("clientes").select("nombre").eq("id", cliente).maybeSingle();
      if (!data) return fail("El cliente no existe.", 404);
      nombre = String(data.nombre);
    }
    const csv = buildPrendasCsv(await getPrendasExport(db, cliente));
    return new Response(csv, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${prendasExportFilename(new Date(), nombre)}"` } });
  } catch (error) {
    if (error instanceof z.ZodError) return fail("Cliente inválido.", 400);
    return fail("No se pudo exportar las prendas.", 500);
  }
}

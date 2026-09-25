import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth";
import { esAdminUniformes } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { parseAdminQuery } from "@/lib/admin/filters";
import { exportRequirements } from "@/lib/admin/data";
import { CSV_HEADERS, toCsvRows, csvCell } from "@/lib/admin/csv";

export async function GET(request: Request) {
  if (!esAdminUniformes((await getCurrentProfile())?.role)) return Response.json({ error: "No autorizado" }, { status: 403 });
  try {
    const { filters } = parseAdminQuery(new URL(request.url).searchParams);
    const db = await createClient();
    const output: unknown[][] = [CSV_HEADERS];
    for await (const row of exportRequirements(db, filters, request.signal)) {
      output.push(...toCsvRows(row));
    }
    if (output.length === 1) return Response.json({ error: "No hay requerimientos para exportar con los filtros seleccionados." }, { status: 404 });
    const csv = "\ufeff" + output.map(row => row.map(csvCell).join(";")).join("\r\n");
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="requerimientos-${new Date().toISOString().slice(0,10)}.csv"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "Revisa los filtros seleccionados." : "No se pudo exportar el CSV." }, { status: error instanceof z.ZodError ? 400 : 500, headers: { "Cache-Control": "private, no-store" } });
  }
}

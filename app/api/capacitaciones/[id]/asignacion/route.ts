import { assertSameOrigin, readJsonBody } from "@/lib/security/http";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

const json = (body: unknown, status = 200) => Response.json(body, { status });

// POST { cliente_id: string | null } -- null = asignación global (todos los agentes).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const profile = await getCurrentCapacitacionProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "capacitador")) return json({ error: "No autorizado." }, 403);
    const id = (await params).id;
    const body = await readJsonBody(request, 512) as { cliente_id?: string | null };
    const clienteId = body.cliente_id || null;
    const db = await createClient();
    const { error } = await db.from("capacitacion_asignaciones").insert({ capacitacion_id: id, cliente_id: clienteId });
    if (error) return json({ error: error.code === "23505" ? "Esa asignación ya existe." : "No se pudo asignar." }, 400);
    return json({ ok: true }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo asignar." }, 400);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const profile = await getCurrentCapacitacionProfile();
    if (!profile || (profile.role !== "admin" && profile.role !== "capacitador")) return json({ error: "No autorizado." }, 403);
    const id = (await params).id;
    const body = await readJsonBody(request, 512) as { asignacion_id?: string };
    if (!body.asignacion_id) return json({ error: "Falta la asignación a quitar." }, 400);
    const db = await createClient();
    const { error } = await db.from("capacitacion_asignaciones").delete().eq("id", body.asignacion_id).eq("capacitacion_id", id);
    if (error) return json({ error: "No se pudo quitar la asignación." }, 400);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo quitar la asignación." }, 400);
  }
}

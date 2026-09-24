import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

const BUCKET = "capacitaciones";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Sirve el video o el PDF de una capacitación desde Storage privado. La autorización real la
// hace RLS sobre la fila de "capacitaciones" con la sesión del usuario (agente asignado,
// capacitador dueño o admin) -- nunca se expone el bucket ni el path directamente.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentCapacitacionProfile();
  if (!profile) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
  const id = (await params).id;
  if (!uuid.test(id)) return NextResponse.json({ error: "Capacitación inválida." }, { status: 400 });
  const tipo = new URL(request.url).searchParams.get("tipo") === "pdf" ? "pdf" : "video";
  const db = await createClient();
  const { data } = await db.from("capacitaciones").select("video_path,video_nombre,material_pdf_path,material_pdf_nombre").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "No disponible." }, { status: 404 });
  const path = tipo === "pdf" ? data.material_pdf_path : data.video_path;
  const nombre = tipo === "pdf" ? data.material_pdf_nombre : data.video_nombre;
  if (!path) return NextResponse.json({ error: "No disponible." }, { status: 404 });
  const result = await db.storage.from(BUCKET).download(path);
  if (result.error) return NextResponse.json({ error: "No se pudo leer el archivo." }, { status: 404 });
  const contentType = tipo === "pdf" ? "application/pdf" : (result.data.type || "video/mp4");
  return new NextResponse(result.data, {
    headers: { "Content-Type": contentType, "Content-Disposition": `inline; filename="${nombre || "archivo"}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" },
  });
}

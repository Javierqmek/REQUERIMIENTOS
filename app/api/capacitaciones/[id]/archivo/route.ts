import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCapacitacionProfile } from "@/lib/capacitaciones/auth";

const BUCKET = "capacitaciones";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// La autorización real la hace RLS sobre la fila de "capacitaciones" con la sesión del usuario
// (agente asignado, capacitador dueño o admin) -- nunca se expone el bucket ni el path
// directamente. Antes esta ruta descargaba el archivo completo a memoria y lo reenviaba
// (sin soporte real de Range, y con el límite de payload de las funciones de Vercel muy por
// debajo de un video); ahora solo redirige a una URL firmada de corta duración, así el video/PDF
// se sirve directo desde Storage, que sí soporta Range (adelantar/retroceder sin descargar todo).
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
  if (!path) return NextResponse.json({ error: "No disponible." }, { status: 404 });
  const { data: signed, error } = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !signed) return NextResponse.json({ error: "No se pudo generar el enlace del archivo." }, { status: 404 });
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { PAPELETA_BUCKET } from "@/lib/vacations/pdf";
import { sha256 } from "@/lib/documents/security";
import { isValidRequestId } from "@/lib/vacations/storage-path";

// Sirve el PDF vigente de una papeleta (o, con ?version=, una versión histórica puntual) sin
// exponer nunca el bucket públicamente: el path nunca se entrega al cliente, solo los bytes.
// La autorización real la hace RLS (papeletas_vacaciones_lectura / _versiones_lectura) sobre la
// consulta con la sesión del usuario: coordinador dueño, admin o gerente. Nadie más ve nada.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
  const id = (await params).id;
  if (!isValidRequestId(id)) return NextResponse.json({ error: "Papeleta inválida." }, { status: 400 });
  const url = new URL(request.url);
  const versionParam = url.searchParams.get("version");
  const db = await createClient();

  let path: string; let sha: string; let nombre: string;
  if (versionParam) {
    const version = Number(versionParam);
    if (!Number.isInteger(version) || version < 1) return NextResponse.json({ error: "Versión inválida." }, { status: 400 });
    const { data } = await db.from("papeletas_vacaciones_versiones")
      .select("archivo_path,archivo_sha256,archivo_nombre").eq("papeleta_id", id).eq("version", version).maybeSingle();
    if (!data) return NextResponse.json({ error: "Versión no disponible." }, { status: 404 });
    ({ archivo_path: path, archivo_sha256: sha, archivo_nombre: nombre } = data as { archivo_path: string; archivo_sha256: string; archivo_nombre: string });
  } else {
    const { data } = await db.from("papeletas_vacaciones")
      .select("archivo_path,archivo_sha256,archivo_nombre").eq("id", id).maybeSingle();
    if (!data) return NextResponse.json({ error: "Papeleta no disponible." }, { status: 404 });
    ({ archivo_path: path, archivo_sha256: sha, archivo_nombre: nombre } = data as { archivo_path: string; archivo_sha256: string; archivo_nombre: string });
  }

  const result = await db.storage.from(PAPELETA_BUCKET).download(path);
  if (result.error) return NextResponse.json({ error: "No se pudo leer el archivo." }, { status: 404 });
  const bytes = new Uint8Array(await result.data.arrayBuffer());
  if (sha256(bytes) !== sha) return NextResponse.json({ error: "El archivo almacenado no coincide con la versión registrada." }, { status: 409 });
  const disposition = url.searchParams.get("download") === "1" ? `attachment; filename="${nombre}"` : "inline";
  return new NextResponse(new Blob([bytes], { type: "application/pdf" }), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": disposition, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Document-SHA256": sha },
  });
}

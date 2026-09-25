import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Vuelta del OAuth de Google: intercambia el código por sesión (PKCE) y decide a dónde ir según
// el rol ya resuelto -- agente/capacitador van directo a su módulo, admin/coordinador/gerente/
// superadmin al panel principal, y cualquier cuenta todavía sin vincular (rol "sin_vincular", el
// que asigna handle_new_user() a cualquier usuario de Auth nuevo) va a /vincular a pedir su DNI.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=oauth", url.origin));

  const db = await createClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=oauth", url.origin));

  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));

  const { data: profile } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = profile?.role;
  const target = role === "agente" || role === "capacitador" ? "/capacitaciones"
    : role === "admin" || role === "coordinador" || role === "gerente" || role === "superadmin" ? "/inicio"
    : "/vincular";
  return NextResponse.redirect(new URL(target, url.origin));
}

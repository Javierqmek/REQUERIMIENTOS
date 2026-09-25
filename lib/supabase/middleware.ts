import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions } from "./cookie-options";
import { contentSecurityPolicy } from "@/lib/security/headers";
import { assertSameOrigin } from "@/lib/security/http";

export async function updateSession(request: NextRequest, makeClient: typeof createServerClient = createServerClient) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NODE_ENV === "production");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  let response = NextResponse.next({ request: { headers } });
  function finish(result = response) {
    if (result !== response) response.cookies.getAll().forEach(cookie => result.cookies.set(cookie));
    result.headers.set("Cache-Control", "private, no-store, max-age=0");
    result.headers.set("Pragma", "no-cache");
    result.headers.set("Expires", "0");
    result.headers.set("Content-Security-Policy", csp);
    // Expuesto como cabecera de RESPUESTA (no en el HTML) para que la prueba de Playwright
    // (tests/production/youtube-player.spec.ts) pueda leer el nonce sin depender de un <meta> en
    // el body: una cabecera no es legible por una inyección de HTML/CSS pura (a diferencia de un
    // <meta> con el valor en texto plano), solo por script que ya se ejecuta en el mismo origen
    // -- caso en el que la CSP ya perdió de todos modos.
    result.headers.set("X-Nonce", nonce);
    return result;
  }
  try { assertSameOrigin(request); }
  catch { return finish(NextResponse.json({ error: "Origen no autorizado" }, { status: 403 })); }
  const supabase = makeClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies) {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        headers.set("cookie", request.cookies.toString());
        const previous = response.cookies.getAll();
        response = NextResponse.next({ request: { headers } });
        previous.forEach(cookie => response.cookies.set(cookie));
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    const pathname = request.nextUrl.pathname;
    // /login y /registro deben ser accesibles sin sesión (ahí vive el botón de Google). El callback
    // de OAuth (/auth/callback) también: llega con el código de Google y todavía SIN sesión --
    // recién la crea al intercambiar el código (ver app/auth/callback/route.ts). /privacidad es
    // pública a propósito (Google exige poder revisarla sin iniciar sesión). Ninguna expone datos
    // privados. /vincular (donde se pide el DNI) SÍ exige sesión: solo se llega ahí después de
    // autenticarse con Google.
    const isPublicPath = pathname === "/login" || pathname === "/registro" || pathname === "/auth/callback" || pathname === "/privacidad";
    if ((error || !user) && !isPublicPath) {
      if (pathname.startsWith("/api/")) return finish(NextResponse.json({ error: "Sesión requerida" }, { status: 401 }));
      return finish(NextResponse.redirect(new URL("/login", request.url)));
    }
    if (user && pathname === "/login") {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (profile && ["admin", "coordinador", "gerente", "superadmin"].includes(profile.role)) return finish(NextResponse.redirect(new URL("/inicio", request.url)));
    }
    return finish();
  } catch {
    return finish(NextResponse.json({ error: "No pudimos verificar la sesión. Intenta nuevamente." }, { status: 503 }));
  }
}

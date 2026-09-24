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
    // Autoregistro de agentes: la página y su API deben ser accesibles SIN sesión (es justamente
    // cómo un agente nuevo consigue una). No exponen ningún dato -- ver app/registro/page.tsx y
    // app/api/capacitaciones/registro/route.ts para la validación real (DNI + código + rate limit).
    const isPublicPath = pathname === "/login" || pathname === "/registro" || pathname === "/api/capacitaciones/registro";
    if ((error || !user) && !isPublicPath) {
      if (pathname.startsWith("/api/")) return finish(NextResponse.json({ error: "Sesión requerida" }, { status: 401 }));
      return finish(NextResponse.redirect(new URL("/login", request.url)));
    }
    if (user && pathname === "/login") {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (profile && ["admin", "coordinador", "gerente"].includes(profile.role)) return finish(NextResponse.redirect(new URL("/inicio", request.url)));
    }
    return finish();
  } catch {
    return finish(NextResponse.json({ error: "No pudimos verificar la sesión. Intenta nuevamente." }, { status: 503 }));
  }
}

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { HttpInputError, readJsonBody } from "@/lib/security/http";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const schema = z.object({ dni: z.string().trim().min(1).max(20) });

const MENSAJE_NO_COINCIDE = "Los datos no coinciden con nuestro registro de personal.";
const MENSAJE_YA_VINCULADO = "Este DNI ya está vinculado a otra cuenta. Comunícate con tu supervisor.";
const MENSAJE_GENERICO = "No se pudo vincular tu cuenta. Intenta nuevamente.";

// Vincula la cuenta de Google ya autenticada (ver app/auth/callback/route.ts) con su fila de
// personal, validando solo el DNI. A diferencia del antiguo autoregistro por correo+contraseña,
// aquí el usuario YA tiene sesión al llegar (se autenticó con Google antes), así que el vínculo
// en sí lo hace vincular_agente_google() usando auth.uid() -- nunca un id recibido del cliente --
// para que nadie pueda vincular la cuenta de otra persona. Cada camino de error se registra con
// console.error (nunca el DNI ni el correo) para verlo en los logs de Vercel.
export async function POST(request: Request) {
  try {
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return json({ error: "Sesión requerida." }, 401);

    const parsed = schema.safeParse(await readJsonBody(request, 512));
    if (!parsed.success) return json({ error: "Ingresa tu DNI." }, 400);
    const dni = parsed.data.dni;

    const admin = createAdminClient();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida";
    const { data: intentos, error: rateError } = await admin.rpc("registrar_intento_registro", { p_clave: ip });
    if (rateError) {
      console.error("[capacitaciones/vincular] registrar_intento_registro falló:", rateError.message);
      return json({ error: MENSAJE_GENERICO }, 400);
    }
    if (typeof intentos === "number" && intentos > 8) return json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." }, 429);

    // Pre-chequeo: distingue "no coincide con personal" de "ya vinculado a otra cuenta". RLS ya
    // permite a cualquier autenticado leer personal activo (catálogo compartido con
    // Requerimientos), así que no hace falta el cliente admin para esta lectura.
    const { data: coincidencias, error: personalError } = await db.from("personal").select("id,profile_id").eq("dni", dni).eq("activo", true);
    if (personalError) {
      console.error("[capacitaciones/vincular] consulta de personal falló:", personalError.message);
      return json({ error: MENSAJE_GENERICO }, 400);
    }
    if (!coincidencias || coincidencias.length === 0) return json({ error: MENSAJE_NO_COINCIDE }, 400);
    if (coincidencias.length > 1) {
      console.error("[capacitaciones/vincular] DNI ambiguo: coincide con más de una fila activa de personal.");
      return json({ error: MENSAJE_NO_COINCIDE }, 400);
    }
    if (coincidencias[0].profile_id) return json({ error: MENSAJE_YA_VINCULADO }, 400);

    const { error: linkError } = await db.rpc("vincular_agente_google", { p_dni: dni });
    if (linkError) {
      console.error("[capacitaciones/vincular] vincular_agente_google falló:", linkError.message);
      return json({ error: MENSAJE_NO_COINCIDE }, 400);
    }
    return json({ ok: true });
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    console.error("[capacitaciones/vincular] error inesperado:", error instanceof Error ? error.message : error);
    return json({ error: MENSAJE_GENERICO }, 400);
  }
}

import { createAdminClient } from "@/lib/supabase/admin";
import { HttpInputError, readJsonBody } from "@/lib/security/http";

const json = (body: unknown, status = 200) => Response.json(body, { status });

const MENSAJE_NO_COINCIDE = "Los datos no coinciden con nuestro registro de personal.";
const MENSAJE_YA_TIENE_CUENTA = "Este trabajador ya tiene una cuenta.";
const MENSAJE_CORREO_EN_USO = "Este correo ya tiene una cuenta.";
const MENSAJE_GENERICO = "No se pudo completar el registro. Intenta nuevamente.";

// Autoregistro del agente: valida DNI + código de personal ANTES de crear ninguna cuenta.
// Usa el service role (única forma de llamar a la Admin API de Auth); nunca se expone al
// cliente. Cada camino de error se registra con console.error (mensaje del error real, nunca la
// contraseña ni el DNI/correo del intento) para poder diagnosticar fallas desde los logs de
// Vercel, mientras que al agente se le muestra un mensaje específico pero seguro.
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, 4096) as { dni?: string; codigo_personal?: string; email?: string; password?: string };
    const dni = String(body.dni || "").trim();
    const codigo = String(body.codigo_personal || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!dni || dni.length > 20 || !codigo || codigo.length > 80 || !email || email.length > 200) {
      return json({ error: "Completa todos los campos." }, 400);
    }
    if (password.length < 8 || password.length > 200) {
      return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);
    }

    const admin = createAdminClient();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida";
    const { data: intentos, error: rateError } = await admin.rpc("registrar_intento_registro", { p_clave: ip });
    if (rateError) {
      console.error("[capacitaciones/registro] registrar_intento_registro falló:", rateError.message);
      return json({ error: MENSAJE_GENERICO }, 400);
    }
    if (typeof intentos === "number" && intentos > 8) return json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." }, 429);

    // Pre-chequeo: distingue "no coincide con personal" de "ya tiene cuenta" para dar un mensaje
    // específico, sin crear todavía la cuenta de Auth (difícil de deshacer del todo).
    const { data: personal, error: personalError } = await admin.from("personal").select("id,profile_id")
      .eq("dni", dni).eq("codigo_personal", codigo).eq("activo", true).maybeSingle();
    if (personalError) {
      console.error("[capacitaciones/registro] consulta de personal falló:", personalError.message);
      return json({ error: MENSAJE_GENERICO }, 400);
    }
    if (!personal) return json({ error: MENSAJE_NO_COINCIDE }, 400);
    if (personal.profile_id) return json({ error: MENSAJE_YA_TIENE_CUENTA }, 400);

    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) {
      console.error("[capacitaciones/registro] createUser falló:", createError?.message || "sin usuario devuelto");
      const message = createError?.message?.toLowerCase().includes("already") ? MENSAJE_CORREO_EN_USO : "No se pudo crear la cuenta. Intenta nuevamente.";
      return json({ error: message }, 400);
    }

    const { error: linkError } = await admin.rpc("vincular_agente", { p_user_id: created.user.id, p_dni: dni, p_codigo_personal: codigo });
    if (linkError) {
      console.error("[capacitaciones/registro] vincular_agente falló:", linkError.message);
      // Nunca se deja una cuenta de Auth huérfana (creada pero sin vincular a personal).
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: MENSAJE_NO_COINCIDE }, 400);
    }
    return json({ ok: true }, 201);
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    console.error("[capacitaciones/registro] error inesperado:", error instanceof Error ? error.message : error);
    return json({ error: MENSAJE_GENERICO }, 400);
  }
}

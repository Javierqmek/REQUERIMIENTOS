import { createAdminClient } from "@/lib/supabase/admin";
import { HttpInputError, readJsonBody } from "@/lib/security/http";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const GENERIC_ERROR = "No encontramos un colaborador activo con ese DNI y código, o ya tiene una cuenta creada.";

// Autoregistro del agente: valida DNI + código de personal ANTES de crear ninguna cuenta.
// Usa el service role (única forma de llamar a la Admin API de Auth); nunca se expone al
// cliente. Mensaje de error siempre genérico para no filtrar qué DNIs existen en el sistema.
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, 4096) as { dni?: string; codigo_personal?: string; email?: string; password?: string };
    const dni = String(body.dni || "").trim();
    const codigo = String(body.codigo_personal || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!dni || dni.length > 20 || !codigo || codigo.length > 80 || !email || email.length > 200 || password.length < 8 || password.length > 200) {
      return json({ error: "Completa todos los campos. La contraseña debe tener al menos 8 caracteres." }, 400);
    }

    const admin = createAdminClient();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida";
    const { data: intentos, error: rateError } = await admin.rpc("registrar_intento_registro", { p_clave: ip });
    if (rateError) throw new Error(rateError.message);
    if (typeof intentos === "number" && intentos > 8) return json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." }, 429);

    // Pre-chequeo: evita crear una cuenta de Auth (difícil de deshacer del todo) si de entrada
    // sabemos que no va a poder vincularse.
    const { data: personal } = await admin.from("personal").select("id")
      .eq("dni", dni).eq("codigo_personal", codigo).eq("activo", true).is("profile_id", null).maybeSingle();
    if (!personal) return json({ error: GENERIC_ERROR }, 400);

    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) {
      const message = createError?.message?.toLowerCase().includes("already") ? "Ese correo ya está registrado." : "No se pudo crear la cuenta.";
      return json({ error: message }, 400);
    }

    const { error: linkError } = await admin.rpc("vincular_agente", { p_user_id: created.user.id, p_dni: dni, p_codigo_personal: codigo });
    if (linkError) {
      // Nunca se deja una cuenta de Auth huérfana (creada pero sin vincular a personal).
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: GENERIC_ERROR }, 400);
    }
    return json({ ok: true }, 201);
  } catch (error) {
    if (error instanceof HttpInputError) return json({ error: error.message }, error.status);
    return json({ error: "No se pudo completar el registro." }, 400);
  }
}

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Cliente con SERVICE ROLE: bypasa RLS por completo y puede usar la Admin API de Auth
// (auth.admin.createUser/deleteUser). SOLO para uso server-side de confianza (rutas API), nunca
// se importa desde un componente cliente ni se expone la clave con el prefijo NEXT_PUBLIC_.
// Requiere la variable de entorno SUPABASE_SERVICE_ROLE_KEY (Project Settings > API en Supabase).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor.");
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

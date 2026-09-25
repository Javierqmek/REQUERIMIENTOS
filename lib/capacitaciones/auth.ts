import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// Guard SEPARADO de lib/auth.ts a propósito: getCurrentProfile() solo admite
// superadmin/admin/coordinador/gerente (ver su whitelist). agente/capacitador son roles nuevos
// que nunca deben pasar por ahí (evita tocar ninguna página existente de Requerimientos/
// Vacaciones). "admin" (restringido, sin acceso a Capacitaciones) queda fuera a propósito: solo
// superadmin administra este módulo.
export const getCurrentCapacitacionProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("id,email,nombre,role").eq("id", user.id).single();
  return data && ["superadmin", "agente", "capacitador"].includes(data.role) ? data as Profile : null;
});

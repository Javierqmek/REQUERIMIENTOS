import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Deduplica usuario + perfil entre layouts y páginas del mismo render. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id,email,nombre,role")
    .eq("id", user.id)
    .single();
  return data && ["admin", "coordinador", "gerente", "superadmin"].includes(data.role) ? data as Profile : null;
});

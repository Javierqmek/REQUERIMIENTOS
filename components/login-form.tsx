"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loginSchema } from "@/lib/validations";
import { Alert } from "@/components/ui/alert";
import { GoogleAuthButton } from "@/components/google-auth-button";

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function submit(formData: FormData) {
    setError("");
    const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) { setError("Correo o contraseña incorrectos."); setLoading(false); return; }
    // agente/capacitador viven en su propio módulo (/capacitaciones), fuera del shell principal.
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
    const target = profile?.role === "agente" || profile?.role === "capacitador" ? "/capacitaciones" : "/inicio";
    router.replace(target); router.refresh();
  }
  return <form action={submit} className="space-y-5">
    <div><label className="label" htmlFor="email">Correo electrónico</label><input className="input" id="email" name="email" type="email" autoComplete="email" required placeholder="nombre@empresa.com" /></div>
    <div><label className="label" htmlFor="password">Contraseña</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" /></div>
    {error && <Alert kind="error">{error}</Alert>}
    <button className="btn btn-primary w-full" disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <LogIn size={19} />}{loading ? "Iniciando sesión..." : "Iniciar sesión"}</button>
    <div className="flex items-center gap-3 text-xs text-[#8794A8]"><div className="h-px flex-1 bg-[#E3E9F1]" />o<div className="h-px flex-1 bg-[#E3E9F1]" /></div>
    <GoogleAuthButton />
  </form>;
}

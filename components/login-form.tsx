"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loginSchema } from "@/lib/validations";

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function submit(formData: FormData) {
    setError("");
    const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setLoading(true);
    const { error } = await createClient().auth.signInWithPassword(parsed.data);
    if (error) { setError("Correo o contraseña incorrectos."); setLoading(false); return; }
    router.replace("/inicio"); router.refresh();
  }
  return <form action={submit} className="space-y-5">
    <div><label className="label" htmlFor="email">Correo electrónico</label><input className="input" id="email" name="email" type="email" autoComplete="email" required placeholder="nombre@empresa.com" /></div>
    <div><label className="label" htmlFor="password">Contraseña</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" /></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <button className="btn btn-primary w-full" disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <LogIn size={19} />}{loading ? "Ingresando..." : "Iniciar sesión"}</button>
  </form>;
}

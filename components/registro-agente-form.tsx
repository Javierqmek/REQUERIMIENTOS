"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Alert } from "@/components/ui/alert";

export function RegistroAgenteForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function submit(formData: FormData) {
    setError("");
    const dni = String(formData.get("dni") || "").trim();
    const codigo_personal = String(formData.get("codigo_personal") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    if (!dni || !codigo_personal || !email) return setError("Completa todos los campos.");
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    setLoading(true);
    try {
      const response = await fetch("/api/capacitaciones/registro", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dni, codigo_personal, email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo completar el registro.");
      const { error: signInError } = await createClient().auth.signInWithPassword({ email, password });
      if (signInError) throw new Error("Cuenta creada. Inicia sesión con tu correo y contraseña.");
      router.replace("/capacitaciones"); router.refresh();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "No se pudo completar el registro.");
    } finally {
      setLoading(false);
    }
  }
  return <form action={submit} className="space-y-4">
    <div><label className="label" htmlFor="dni">DNI</label><input className="input" id="dni" name="dni" required maxLength={20} placeholder="12345678" /></div>
    <div><label className="label" htmlFor="codigo_personal">Código de personal</label><input className="input" id="codigo_personal" name="codigo_personal" required maxLength={80} placeholder="Como figura en tu carnet/planilla" /></div>
    <div><label className="label" htmlFor="email">Correo electrónico</label><input className="input" id="email" name="email" type="email" required placeholder="nombre@correo.com" /></div>
    <div><label className="label" htmlFor="password">Contraseña</label><input className="input" id="password" name="password" type="password" required minLength={8} placeholder="Mínimo 8 caracteres" /></div>
    {error && <Alert kind="error">{error}</Alert>}
    <button className="btn btn-primary w-full" disabled={loading}>{loading ? <LoaderCircle className="animate-spin" size={18} /> : <UserPlus size={18} />}{loading ? "Creando cuenta..." : "Crear mi cuenta"}</button>
  </form>;
}

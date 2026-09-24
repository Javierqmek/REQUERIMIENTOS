"use client";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Alert } from "@/components/ui/alert";

// Ícono "G" de Google -- lucide-react no incluye logos de marca a propósito, así que se usa el
// SVG oficial multicolor.
function GoogleIcon() {
  return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.6Z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.94v2.33A9 9 0 0 0 9 18Z" />
    <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.27-1.7V4.97H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.03l3.01-2.33Z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.97l3.01 2.33C4.66 5.17 6.65 3.58 9 3.58Z" />
  </svg>;
}

// OAuth vía Supabase Auth: redirige a Google y vuelve a /auth/callback, que exhange el código por
// sesión y decide a dónde ir (ver app/auth/callback/route.ts). No hay "éxito" que manejar aquí:
// el navegador sale de la página.
export function GoogleAuthButton({ label = "Continuar con Google" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function continuar() {
    setError(""); setLoading(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setError("No se pudo iniciar sesión con Google. Intenta nuevamente."); setLoading(false); }
  }
  return <div className="space-y-3">
    <button type="button" className="btn btn-secondary w-full" disabled={loading} onClick={continuar}>
      {loading ? <LoaderCircle className="animate-spin" size={18} /> : <GoogleIcon />}{label}
    </button>
    {error && <Alert kind="error">{error}</Alert>}
  </div>;
}

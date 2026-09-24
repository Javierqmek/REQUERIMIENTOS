"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Link2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";

export function VincularCuentaForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(formData: FormData) {
    setError("");
    const dni = String(formData.get("dni") || "").trim();
    if (!dni) return setError("Ingresa tu DNI.");
    setLoading(true);
    try {
      const response = await fetch("/api/capacitaciones/vincular", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dni }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo vincular tu cuenta.");
      router.replace("/capacitaciones"); router.refresh();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "No se pudo vincular tu cuenta.");
    } finally {
      setLoading(false);
    }
  }

  return <form action={submit} className="space-y-4">
    <div><label className="label" htmlFor="dni">DNI</label><input className="input" id="dni" name="dni" required maxLength={20} placeholder="12345678" autoFocus /></div>
    {error && <Alert kind="error">{error}</Alert>}
    <button className="btn btn-primary w-full" disabled={loading}>{loading ? <LoaderCircle className="animate-spin" size={18} /> : <Link2 size={18} />}{loading ? "Vinculando..." : "Vincular mi cuenta"}</button>
  </form>;
}

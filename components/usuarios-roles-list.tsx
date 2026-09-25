"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";

interface Usuario { id: string; email: string; nombre: string; role: string }
const ROLES = ["superadmin", "admin", "coordinador", "gerente", "capacitador", "agente", "sin_vincular"] as const;

export function UsuariosRolesList({ usuarios, propioId }: { usuarios: Usuario[]; propioId: string }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function cambiarRol(id: string, role: string) {
    setError(""); setBusyId(id);
    try {
      const response = await fetch("/api/admin/usuarios", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: id, role }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cambiar el rol.");
      router.refresh();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "No se pudo cambiar el rol.");
    } finally {
      setBusyId(null);
    }
  }

  return <div className="grid gap-2.5">
    {error && <Alert kind="error">{error}</Alert>}
    {usuarios.map(u => <div key={u.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[#0B1F3A]">{u.nombre || "(sin nombre)"}</p>
        <p className="truncate text-xs text-[#607089]">{u.email}{u.id === propioId ? " · tú" : ""}</p>
      </div>
      <div className="flex items-center gap-2">
        {busyId === u.id && <LoaderCircle className="animate-spin text-[#607089]" size={16} />}
        <select className="input w-auto" defaultValue={u.role} disabled={busyId === u.id}
          onChange={e => cambiarRol(u.id, e.target.value)}>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
    </div>)}
  </div>;
}

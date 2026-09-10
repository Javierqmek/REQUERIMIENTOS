"use client";
import { useEffect, useRef } from "react";
import { AlertTriangle, LoaderCircle, LogOut, Trash2, X } from "lucide-react";

export function ConfirmDialog({
  open, busy, onCancel, onConfirm, error,
  title = "¿Deseas cerrar tu sesión?",
  description = "Tendrás que volver a ingresar tus credenciales para continuar.",
  confirmLabel = "Sí, cerrar sesión",
  intent = "danger",
  context = "logout",
}: {
  error?: string; open: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void;
  title?: string; description?: string; confirmLabel?: string; intent?: "danger" | "warning"; context?: "logout" | "delete";
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    function close(event: KeyboardEvent) { if (event.key === "Escape" && !busy) onCancel(); }
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, busy, onCancel]);
  if (!open) return null;
  const Icon = context === "delete" ? Trash2 : intent === "danger" ? LogOut : AlertTriangle;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#0B1F3A]/40 p-4" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target && !busy) onCancel(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description" className="w-full max-w-sm rounded-xl border border-[#DCE3EC] bg-white p-5 shadow-[0_18px_48px_rgba(11,31,58,.18)]">
      <div className="flex items-start justify-between gap-4">
        <span className={`grid h-10 w-10 place-items-center rounded-lg ${intent === "danger" ? "bg-red-50 text-[#C53030]" : "bg-amber-50 text-[#B7791F]"}`}><Icon size={19}/></span>
        <button className="rounded-lg p-2 text-[#607089] hover:bg-[#F5F8FD]" aria-label="Cerrar diálogo" disabled={busy} onClick={onCancel}><X size={18}/></button>
      </div>
      <h2 id="confirm-title" className="mt-4 text-lg font-semibold text-[#0B1F3A]">{title}</h2>
      <p id="confirm-description" className="mt-1.5 text-sm text-[#607089]">{description}</p>
      {error && <p role="alert" className="mt-3 text-sm text-[#C53030]">{error}</p>}
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button ref={cancelRef} className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancelar</button>
        <button className={intent === "danger" ? "btn btn-danger" : "btn btn-primary"} disabled={busy} onClick={onConfirm}>{busy && <LoaderCircle className="animate-spin" size={17}/>} {confirmLabel}</button>
      </div>
    </section>
  </div>;
}

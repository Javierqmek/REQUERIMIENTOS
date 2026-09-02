"use client";
import { useEffect } from "react";
import { CheckCircle2, X } from "lucide-react";
export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);
  if (!message) return null;
  return <div role="status" className="fixed bottom-20 right-4 z-40 flex max-w-[calc(100vw-32px)] items-center gap-3 rounded-xl border border-[var(--border)] bg-white py-2 pl-4 pr-1 shadow-lg sm:bottom-5">
    <CheckCircle2 size={18} className="shrink-0 text-[var(--success)]"/><p className="min-w-0 text-sm">{message}</p><button aria-label="Cerrar notificación" onClick={onClose} className="btn btn-ghost !px-3"><X size={16}/></button>
  </div>;
}

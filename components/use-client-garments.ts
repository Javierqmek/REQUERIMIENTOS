"use client";

import { useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import type { Renovacion } from "@/lib/garments/renovacion";
import type { Prenda } from "@/lib/types";

// Prendas asignadas (activas) al cliente para la renovación elegida o AMBOS, con la cantidad de esa
// asignación. El género se filtra en la pantalla. Lee todas las páginas, como useActiveCatalog.
export function useClientGarments(
  supabase: ReturnType<typeof createClient>,
  enabled: boolean,
  clienteId: string | null | undefined,
  renovacion: Renovacion | null,
) {
  const key = JSON.stringify([enabled, clienteId, renovacion]);
  const [result, setResult] = useState<{ key: string; rows: Prenda[]; loading: boolean; error: boolean }>({ key: "", rows: [], loading: false, error: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !clienteId || !renovacion) return;
    const controller = new AbortController();
    async function load() {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setResult({ key, rows: [], loading: true, error: false });
      try {
        const rows: Prenda[] = [];
        const size = 500;
        for (let offset = 0; ; offset += size) {
          const { data, error } = await supabase.rpc("listar_prendas_cliente", { p_cliente_id: clienteId, p_renovacion: renovacion })
            .range(offset, offset + size - 1).abortSignal(controller.signal);
          if (controller.signal.aborted) return;
          if (error) throw error;
          rows.push(...((data ?? []) as unknown as Prenda[]));
          if ((data?.length ?? 0) < size) break;
        }
        setResult({ key, rows, loading: false, error: false });
      } catch {
        if (!controller.signal.aborted) setResult({ key, rows: [], loading: false, error: true });
      }
    }
    void load();
    return () => controller.abort();
  }, [supabase, enabled, clienteId, renovacion, key, attempt]);

  const current = enabled && Boolean(clienteId && renovacion) && result.key === key;
  return {
    rows: current ? result.rows : [],
    loading: enabled && Boolean(clienteId && renovacion) && (!current || result.loading),
    error: current && result.error,
    retry: () => setAttempt(a => a + 1),
  };
}

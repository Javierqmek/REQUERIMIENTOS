"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const columns = {
  clientes: "id,nombre,activo",
  unidades: "id,cliente_id,nombre,activo",
  prendas: "id,codigo_prenda,nombre_prenda,codigo_almacen,precio,cliente,cantidad,activo",
};

// Read every page of the requested active catalog, never unrelated agents or garments.
export function useActiveCatalog<T>(
  supabase: ReturnType<typeof createClient>,
  table: keyof typeof columns,
  enabled: boolean,
  filter?: { column: "cliente_id" | "cliente"; value: string },
) {
  const column = filter?.column;
  const value = filter?.value;
  const key = JSON.stringify([table, enabled, column, value]);
  const [result, setResult] = useState<{ key: string; rows: T[]; loading: boolean; error: boolean }>({ key: "", rows: [], loading: false, error: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function load() {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setResult({ key, rows: [], loading: true, error: false });
      try {
        const rows: T[] = [];
        const size = 500;
        for (let offset = 0; ; offset += size) {
          let request = supabase.from(table).select(columns[table]).eq("activo", true);
          if (column && value) request = request.eq(column, value);
          const { data, error } = await request
            .order(table === "prendas" ? "nombre_prenda" : "nombre")
            .order("id").range(offset, offset + size - 1).abortSignal(controller.signal);
          if (controller.signal.aborted) return;
          if (error) throw error;
          rows.push(...((data ?? []) as unknown as T[]));
          if ((data?.length ?? 0) < size) break;
        }
        setResult({ key, rows, loading: false, error: false });
      } catch {
        if (!controller.signal.aborted) setResult({ key, rows: [], loading: false, error: true });
      }
    }
    void load();
    return () => controller.abort();
  }, [supabase, table, enabled, column, value, key, attempt]);

  const current = enabled && result.key === key;
  return {
    rows: current ? result.rows : [],
    loading: enabled && (!current || result.loading),
    error: current && result.error,
    retry: () => setAttempt(a => a + 1),
  };
}

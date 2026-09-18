"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LoadingState } from "./ui/loading-state";

export type PersonalOption = { id: string; nombre: string; dni: string; cargo: string; codigo_personal: string };

// Buscador reutilizable sobre la base de personal existente (buscar_personal). Sin texto libre:
// solo permite continuar con una persona realmente seleccionada de los resultados.
export function PersonalSearchPicker({
  label, placeholder = "Nombre, DNI o código...", selected, onSelect, onClear, excludeId, disabled, error,
}: {
  label: string;
  placeholder?: string;
  selected: PersonalOption | null;
  onSelect: (person: PersonalOption) => void;
  onClear: () => void;
  excludeId?: string;
  disabled?: boolean;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonalOption[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputId = `personal-search-${label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-")}`;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function search(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const { data } = await createClient().rpc("buscar_personal", { p_busqueda: value.trim(), p_limite: 20 });
      setResults(((data ?? []) as PersonalOption[]).filter(p => p.id !== excludeId));
      setLoading(false);
    }, 300);
  }

  if (selected) {
    return <div>
      <label className="label">{label}</label>
      <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[#DCE3EC] bg-[#F8FAFD] px-3 py-2">
        <span className="min-w-0">
          <strong className="block truncate text-sm font-medium text-[#172033]">{selected.nombre}</strong>
          <span className="block text-xs text-[#607089]">Código {selected.codigo_personal} · DNI {selected.dni}</span>
        </span>
        {!disabled && <button type="button" onClick={onClear} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#607089] hover:bg-white" aria-label={`Cambiar ${label.toLowerCase()}`}><X size={16} /></button>}
      </div>
      {error && <p className="mt-1 text-xs font-medium text-[#C53030]">{error}</p>}
    </div>;
  }

  return <div>
    <label className="label" htmlFor={inputId}>{label}</label>
    <input id={inputId} className="input" value={query} disabled={disabled} placeholder={placeholder} autoComplete="off"
      onChange={e => search(e.target.value)} />
    {loading && <LoadingState compact label="Buscando..." />}
    {!loading && query.trim().length >= 2 && results.length === 0 && <p className="mt-2 text-xs text-[#607089]">Sin coincidencias.</p>}
    {!loading && results.length > 0 && <div className="mt-2 max-h-52 overflow-auto rounded-xl border border-[#DCE3EC] bg-white p-1 shadow-lg">
      {results.map(p => <button key={p.id} type="button"
        onClick={() => { onSelect(p); setQuery(""); setResults([]); }}
        className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[#F5F8FD]">
        <strong className="block text-sm font-medium">{p.nombre}</strong>
        <span className="text-xs text-[#607089]">{p.dni} · {p.codigo_personal}</span>
      </button>)}
    </div>}
    {error && <p className="mt-1 text-xs font-medium text-[#C53030]">{error}</p>}
  </div>;
}

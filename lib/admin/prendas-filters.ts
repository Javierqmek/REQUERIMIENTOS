import { z } from "zod";

// Filtros de Mantenimiento → Prendas (lista y exportación). Cliente, puesto, género y renovación se aplican a las asignaciones:
// una prenda aparece si alguna de sus asignaciones cumple todos a la vez. "sinAsignar" muestra solo las prendas sin ninguna asignación.
export const PRENDA_ESTADOS = ["activas", "inactivas", "todas"] as const;
const uuid = z.union([z.string().uuid(), z.literal("")]).default("");
export const prendasFilterShape = {
  q: z.string().trim().max(120).default(""),
  cliente: uuid,
  sinAsignar: z.union([z.literal("1"), z.literal("")]).default(""),
  puesto: uuid,
  genero: z.enum(["HOMBRE", "MUJER", "AMBOS", ""]).default(""),
  renovacion: z.enum(["VERANO", "INVIERNO", "AMBOS", ""]).default(""),
  almacen: z.string().trim().max(80).default(""),
};
export type PrendasFilters = {
  q: string; cliente: string; sinAsignar: string; puesto: string; genero: string; renovacion: string; almacen: string;
  estado: (typeof PRENDA_ESTADOS)[number];
};
export function prendasFilterArgs(f: PrendasFilters) {
  return {
    p_busqueda: f.q || null, p_cliente_id: f.cliente || null, p_sin_asignar: f.sinAsignar === "1", p_puesto_id: f.puesto || null,
    p_genero: f.genero || null, p_renovacion: f.renovacion || null, p_almacen: f.almacen || null, p_estado: f.estado,
  };
}
// Parámetros de la URL (solo los que tienen valor) para la lista y el enlace de exportación.
export function prendasFilterParams(f: PrendasFilters) {
  const params = new URLSearchParams();
  for (const key of ["q", "cliente", "sinAsignar", "puesto", "genero", "renovacion", "almacen"] as const) if (f[key]) params.set(key, f[key]);
  params.set("estado", f.estado);
  return params;
}

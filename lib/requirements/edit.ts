import { z } from "zod";
import type { Prenda, Profile, Requerimiento } from "@/lib/types";
import type { GarmentGender } from "@/lib/garments/gender";

export const ATTENDED_MESSAGE = "Este requerimiento ya fue atendido y no puede modificarse.";
export type EditDetail = {
  id: string; prenda_id: string; activo: boolean; cantidad: number;
  precio_unitario: number; codigo_almacen: string; prendas: Prenda;
};
export type EditableRequirement = Omit<Requerimiento, "detalle_requerimiento"> & { detalle_requerimiento: EditDetail[] };
export type EditPayload = { version: string; requerimiento: EditableRequirement };
export type EditLine = { prenda_id: string; detalle_id?: string; nombre: string; cantidad: number; precio: number; codigo: string; genero: GarmentGender };
export function canEditRequirement(profile: Profile | null, row: Pick<Requerimiento, "estado" | "usuario_creador_id">) {
  return (row.estado === "Pendiente" || row.estado === "Observado") &&
    (profile?.role === "admin" || (profile?.role === "coordinador" && profile.id === row.usuario_creador_id));
}
export const editGarmentsSchema = z.object({
  version: z.string().regex(/^[a-f0-9]{32}$/),
  detalles: z.array(z.object({ prenda_id: z.string().uuid(), detalle_id: z.string().uuid().optional() }).strict())
    .min(1, "Debe existir al menos una prenda.").max(500)
    .refine(rows => new Set(rows.map(r => r.prenda_id)).size === rows.length, "No se permiten prendas duplicadas."),
}).strict();
export function initialEditLines(row: EditableRequirement): EditLine[] {
  return row.detalle_requerimiento.filter(d => d.activo).map(d => ({
    prenda_id: d.prenda_id, detalle_id: d.id, nombre: d.prendas.nombre_prenda,
    cantidad: d.prendas.cantidad, precio: Number(d.precio_unitario), codigo: d.codigo_almacen, genero: d.prendas.genero,
  }));
}
export function newEditLine(p: Prenda): EditLine {
  return { prenda_id: p.id, nombre: p.nombre_prenda, cantidad: p.cantidad, precio: Number(p.precio), codigo: p.codigo_almacen, genero: p.genero };
}

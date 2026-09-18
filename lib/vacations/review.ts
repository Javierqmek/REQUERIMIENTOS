import type { PapeletaEstado } from "./types";

export const OBSERVATION_REQUIRED_MESSAGE = "El motivo de observación es obligatorio.";

// La posibilidad de corregir depende exclusivamente del ESTADO, no de un permiso general por
// usuario: mejor trazabilidad (ver decisión de diseño en el informe de entrega).
export function canReview(role: "admin" | "coordinador" | "gerente", ownerId: string, userId: string): boolean {
  return (role === "admin" || role === "gerente") && ownerId !== userId;
}

export function canCorrect(role: "admin" | "coordinador" | "gerente", ownerId: string, userId: string, estado: PapeletaEstado): boolean {
  return role === "coordinador" && ownerId === userId && estado === "OBSERVADO";
}

export function canMarkConforme(role: "admin" | "coordinador" | "gerente", ownerId: string, userId: string, estado: PapeletaEstado): boolean {
  return canReview(role, ownerId, userId) && estado === "REGISTRADO";
}

export function canObserve(role: "admin" | "coordinador" | "gerente", ownerId: string, userId: string, estado: PapeletaEstado): boolean {
  return canReview(role, ownerId, userId) && estado === "REGISTRADO";
}

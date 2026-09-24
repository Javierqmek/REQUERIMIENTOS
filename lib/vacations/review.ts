import type { PapeletaEstado } from "./types";
import type { Role } from "@/lib/types";

export const OBSERVATION_REQUIRED_MESSAGE = "El motivo de observación es obligatorio.";

// La posibilidad de corregir/observar/firmar depende exclusivamente del ESTADO, no de un
// permiso general por usuario: mejor trazabilidad (ver decisión de diseño en el informe de entrega).
export function canReview(role: Role, ownerId: string, userId: string): boolean {
  return (role === "admin" || role === "gerente") && ownerId !== userId;
}

export function canCorrect(role: Role, ownerId: string, userId: string, estado: PapeletaEstado): boolean {
  return role === "coordinador" && ownerId === userId && estado === "OBSERVADO";
}

export function canObserve(role: Role, ownerId: string, userId: string, estado: PapeletaEstado): boolean {
  return canReview(role, ownerId, userId) && estado === "REGISTRADO";
}

// La firma final es EXCLUSIVA del gerente. Por defecto el administrador NO firma (decisión de
// diseño explícita del requerimiento): admin mantiene mantenimiento/observación, no firma.
export function canSign(role: Role, ownerId: string, userId: string, estado: PapeletaEstado): boolean {
  return role === "gerente" && ownerId !== userId && estado === "REGISTRADO";
}

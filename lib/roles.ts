import type { Role } from "./types";

// admin conserva Requerimientos + Administración (Mantenimiento/Importaciones); superadmin tiene
// acceso total, incluido todo lo de admin. Se usa en cada guard de esos módulos para no repetir
// la comparación de dos roles en cada archivo.
export function esAdminUniformes(role: Role | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

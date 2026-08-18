export type Role = "supervisor" | "admin";
export type Estado = "Pendiente" | "Atendido" | "Observado";

export interface Profile { id: string; email: string; nombre: string; role: Role }
export interface Personal {
  id: string; codigo_personal: string; nombre: string; dni: string; cargo: string;
  cliente: string; unidad: string; activo: boolean;
}
export interface Prenda {
  id: string; codigo_prenda: string; nombre_prenda: string; codigo_almacen: string;
  precio: number; cliente: string; activo: boolean;
}
export interface Detalle {
  id: string; cantidad: number; precio_unitario: number; codigo_almacen: string;
  prendas: { nombre_prenda: string } | null;
}
export interface Requerimiento {
  id: string; fecha: string; referencia_interna: string; estado: Estado;
  personal: Pick<Personal, "nombre" | "dni" | "cargo" | "cliente" | "unidad"> | null;
  profiles?: Pick<Profile, "nombre" | "email"> | null;
  detalle_requerimiento?: Detalle[];
}

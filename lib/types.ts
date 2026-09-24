export type Role = "coordinador" | "admin" | "gerente" | "agente" | "capacitador";
export type Estado = "Pendiente" | "Atendido" | "Observado";

export interface Profile { id: string; email: string; nombre: string; role: Role }
export interface Personal {
  id: string; codigo_personal: string; nombre: string; dni: string; cargo: string;
  activo: boolean;
}
export interface Cliente { id: string; nombre: string; activo: boolean }
export interface Unidad { id: string; cliente_id: string; nombre: string; activo: boolean }
export interface Provincia { id: string; nombre: string; activo: boolean }
export interface Prenda {
  id: string; codigo_prenda: string; nombre_prenda: string; codigo_almacen: string;
  precio: number; cliente: string; cantidad: number; genero: import("@/lib/garments/gender").GarmentGender; activo: boolean;
}
export interface Detalle {
  id: string; cantidad: number; precio_unitario: number; codigo_almacen: string; activo: boolean;
  prendas: { nombre_prenda: string } | null;
}
export interface Requerimiento {
  id: string; fecha: string; referencia_interna: string; estado: Estado; usuario_creador_id: string;
  total_requerimiento?: number | string;
  cantidad_prendas?: number;
  unidades_totales?: number;
  generos?: import("@/lib/garments/gender").GarmentGender[];
  cliente_id: string | null; unidad_id: string | null;
  clientes: Pick<Cliente, "nombre"> | null;
  unidades: Pick<Unidad, "nombre"> | null;
  personal: Pick<Personal, "nombre" | "dni" | "cargo"> | null;
  profiles?: Pick<Profile, "nombre" | "email"> | null;
  detalle_requerimiento?: Detalle[];
}

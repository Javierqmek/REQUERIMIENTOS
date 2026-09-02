// FK explícitas: unidades también tiene una FK compuesta de pertenencia al cliente.
export const REQUIREMENT_SELECT = "id,fecha,referencia_interna,estado,usuario_creador_id,cliente_id,unidad_id,personal(nombre,dni,cargo),clientes!requerimientos_cliente_id_fkey(nombre),unidades!requerimientos_unidad_id_fkey(nombre)";
export const ADMIN_REQUIREMENT_SELECT = `${REQUIREMENT_SELECT},profiles(nombre,email)`;
export const DETAIL_REQUIREMENT_SELECT = `${ADMIN_REQUIREMENT_SELECT},detalle_requerimiento(id,activo,cantidad,precio_unitario,codigo_almacen,prendas(nombre_prenda))`;
export const LEGACY_CLIENT = "Sin cliente (histórico)";
export const LEGACY_UNIT = "Sin unidad (histórico)";

import type { SidigeRequirement } from "../../lib/admin/types";
export const IDS = {
  cliente: "55000000-0000-4000-8000-000000000001", unidad: "66000000-0000-4000-8000-000000000001",
  coordinador: "11000000-0000-4000-8000-000000000001",
};
export function fixtureRequirement(overrides: Partial<SidigeRequirement> = {}): SidigeRequirement {
  return {
    id: "44000000-0000-4000-8000-000000000001",
    fecha: "2026-09-02T15:00:00Z", referencia_interna: "OTRA REFERENCIA HISTORICA", estado: "Pendiente",
    cliente_id: IDS.cliente, unidad_id: IDS.unidad, usuario_creador_id: IDS.coordinador,
    clientes: { nombre: " RENIEC " }, unidades: { nombre: "OFICINA REGISTRAL ATE" },
    personal: { cargo: "  AGENTE ", nombre: "RAMÍREZ   RIVERA JERY", dni: " 071389725 " },
    profiles: { nombre: "Javier Quispe", email: "javier@example.test" }, cantidad_prendas: 2, total_requerimiento: 40,
    detalle_requerimiento: [{
      id: "77000000-0000-4000-8000-000000000001", created_at: "2026-09-02T15:00:00Z",
      cantidad: 2, precio_unitario: "20.00", codigo_almacen: " EPP ",
      prendas: { codigo_prenda: "000012", nombre_prenda: "CAMISA BLANCA — TALLA S", codigo_almacen: "ACTUAL" },
    }],
    ...overrides,
  };
}

import { LEGACY_CLIENT, LEGACY_UNIT } from "@/lib/requerimientos";
import type { SidigeRequirement } from "./types";

// Comillas CSV no neutralizan fórmulas. Prefija texto peligroso, también tras
// espacios/controles. Números reales se conservan como números.
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (typeof value !== "number" && (/^[\s\u0000-\u001f\u007f]*[=+@\-＝＋－＠]/u.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export const CSV_HEADERS = ["Fecha","Coordinador","Agente","DNI","Cliente","Unidad","Estado","Prenda","Cantidad","Código almacén","Precio unitario"];
export function toCsvRows(row: SidigeRequirement): unknown[][] {
  return row.detalle_requerimiento.filter(detail => detail.activo !== false).map(detail => [
    row.fecha,row.profiles?.nombre || row.profiles?.email,row.personal?.nombre,row.personal?.dni,
    row.clientes?.nombre ?? LEGACY_CLIENT,row.unidades?.nombre ?? LEGACY_UNIT,row.estado,
    detail.prendas?.nombre_prenda,detail.cantidad,detail.codigo_almacen,detail.precio_unitario,
  ]);
}

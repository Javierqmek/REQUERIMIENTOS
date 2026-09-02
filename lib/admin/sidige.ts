import type { SidigeRequirement } from "./types";

export const SIDIGE_HEADERS = ["Comentario", "Ref.Int.", "Num. Real", "Glosa", "Num. Item", "Sub. Alm.", "Cod. Articulo", "Des. Articulo", "Cantidad Art.", "Precio Art."] as const;
export type SidigeRow = [string, string, string, string, number, string, string, string, number, number];
export type IncompleteRequirement = { id: string; agente: string; campos: string[] };
export class SidigeValidationError extends Error {
  constructor(public issues: IncompleteRequirement[], public total = issues.length) {
    super("Hay requerimientos con información incompleta. Revisa los registros indicados antes de exportar.");
  }
}
export function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
function validText(value: string) {
  return value.length > 0 && value.length <= 32767 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}
export function toSidigeRows(requirement: SidigeRequirement): SidigeRow[] {
  const missing = new Set<string>();
  function required(value: unknown, label: string, compact = true) {
    const text = compact ? cleanText(value) : typeof value === "string" ? value.trim() : "";
    if (!validText(text)) missing.add(label);
    return text;
  }
  const nombre = required(requirement.personal?.nombre, "Agente");
  const dni = required(requirement.personal?.dni, "DNI");
  const cargo = required(requirement.personal?.cargo, "Cargo");
  const cliente = required(requirement.clientes?.nombre, "Cliente");
  const unidad = required(requirement.unidades?.nombre, "Unidad");
  const comment = [cargo, nombre, dni].join(" ");
  const destination = [cliente, unidad].join(" ");
  if (comment.length > 32767 || destination.length > 32767) missing.add("Texto demasiado largo para Excel");
  const micros = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6);
  // RLS ya excluye historial. Defensa adicional ante fuentes futuras o fixtures.
  const details = (requirement.detalle_requerimiento ?? []).filter(d => d.activo !== false).sort((a, b) =>
    Date.parse(a.created_at) - Date.parse(b.created_at) || micros(a.created_at).localeCompare(micros(b.created_at)) || a.id.localeCompare(b.id));
  if (!details.length) missing.add("Prendas solicitadas");
  const rows = details.map((detail, index): SidigeRow => {
    const label = "Prenda " + (index + 1);
    if (!detail.id || !Number.isFinite(Date.parse(detail.created_at))) missing.add(label + ": orden del detalle");
    // El fallback solo se usa si el snapshot no existe; nunca sustituye un valor histórico.
    const almacen = required(detail.codigo_almacen?.trim() || detail.prendas?.codigo_almacen, label + ": código almacén", false);
    const codigo = required(detail.prendas?.codigo_prenda, label + ": código de prenda", false);
    const descripcion = required(detail.prendas?.nombre_prenda, label + ": descripción", false);
    const quantity = detail.cantidad;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) missing.add(label + ": cantidad");
    const price = typeof detail.precio_unitario === "number" || (typeof detail.precio_unitario === "string" && detail.precio_unitario.trim() !== "")
      ? Number(detail.precio_unitario) : NaN;
    if (!Number.isFinite(price) || price < 0) missing.add(label + ": precio");
    return [comment, "RENOVACION VERANO", destination, comment, index + 1, almacen, codigo, descripcion, quantity, price];
  });
  if (missing.size) throw new SidigeValidationError([{ id: requirement.id, agente: nombre || "Agente sin nombre", campos: [...missing] }]);
  return rows;
}

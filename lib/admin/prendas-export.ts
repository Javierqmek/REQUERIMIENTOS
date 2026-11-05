import type { SupabaseClient } from "@supabase/supabase-js";
import { csvCell } from "./csv";

// Exportación de prendas en el MISMO formato que la importación (se puede corregir en Excel y volver a importar).
// Una fila por asignación (activa o inactiva, con su estado) y, una sola vez, las prendas sin ninguna asignación.
export const PRENDAS_EXPORT_HEADERS = ["codigo_prenda", "nombre_prenda", "codigo_almacen", "precio", "cantidad", "cliente", "puesto", "genero", "renovacion", "activo"] as const;
export type PrendaExportRow = {
  codigo_prenda: string; nombre_prenda: string; codigo_almacen: string; precio: string;
  cantidad: number | null; cliente: string | null; puesto: string | null; genero: string | null; renovacion: string | null; activo: boolean;
};

const quote = (text: string) => '"' + text.replaceAll('"', '""') + '"';
// Códigos solo con dígitos (p. ej. 0012): Excel los convertiría en número y perdería los ceros; ="0012" los fuerza a texto
// y la importación los lee sin el envoltorio.
const asText = (value: string) => (/^\d+$/.test(value) ? quote(`="${value}"`) : csvCell(value));

export function buildPrendasCsv(rows: PrendaExportRow[]) {
  const lines = rows.map(row => [
    asText(row.codigo_prenda), csvCell(row.nombre_prenda), asText(row.codigo_almacen), csvCell(row.precio), csvCell(row.cantidad ?? ""),
    csvCell(row.cliente ?? ""), csvCell(row.puesto ?? ""), csvCell(row.genero ?? ""), csvCell(row.renovacion ?? ""), csvCell(row.activo ? "sí" : "no"),
  ].join(";"));
  // UTF-8 con BOM para que Excel muestre bien las tildes; separador ; como el resto de CSV del sistema.
  return String.fromCharCode(0xFEFF) + [PRENDAS_EXPORT_HEADERS.map(csvCell).join(";"), ...lines].join("\r\n") + "\r\n";
}

export async function getPrendasExport(db: SupabaseClient, clienteId?: string | null) {
  const { data, error } = await db.rpc("admin_exportar_prendas", { p_cliente_id: clienteId || null });
  if (error) throw error;
  return (data ?? []) as PrendaExportRow[];
}

export function prendasExportFilename(date = new Date(), cliente?: string | null) {
  const slug = (cliente ?? "todos").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cliente";
  return `prendas-${slug}-${date.toISOString().slice(0, 10)}.csv`;
}

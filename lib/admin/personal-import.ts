import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanCell, ImportInputError } from "./prendas-import";
import type { ImportIssue } from "./maintenance";

// Importación de personal por DNI. La pantalla limpia y valida cada fila (con su número de fila), exige DNI de exactamente 8 dígitos (nunca completa ceros) y detecta repetidos dentro del archivo; la base (RPC admin_importar_personal) compara contra lo
// guardado y aplica en una sola transacción. Nunca modifica profile_id, email ni la vinculación de agentes.
export const PERSONAL_REQUIRED_HEADERS = ["codigo_personal", "nombre", "dni", "activo"] as const;
export const PERSONAL_OPTIONAL_HEADERS = ["cargo"] as const;
export const PERSONAL_MAX_ROWS = 5000;

export type PersonalPreview = {
  aplicado: boolean; nuevos: number; sin_cambios: number; actualizados: number;
  diferencias: { fila: number; dni: string; nombre: string; codigo_personal: string; vinculado: boolean; cambios: { campo: string; actual: string; archivo: string }[] }[];
  errores: { fila: number; codigo: string; mensaje: string }[];
};
export type PersonalImportPreview = {
  rows: Record<string, unknown>[]; issues: ImportIssue[]; nuevos: number; actualizados: number; omitidos: number; errores: number;
  personal: PersonalPreview;
};

export const personalPayloadSchema = z.object({
  kind: z.literal("personal"), headers: z.array(z.string()).max(12),
  rows: z.array(z.record(z.string(), z.string())).min(1).max(PERSONAL_MAX_ROWS), mode: z.enum(["preview", "apply"]),
  // DNI de las personas existentes cuyos datos se actualizan con los del archivo (por defecto ninguna).
  actualizar: z.array(z.string().regex(/^\d{8}$/)).max(PERSONAL_MAX_ROWS).default([]),
  cargo_defecto: z.string().trim().min(1).max(120).default("AGENTE"),
  filas: z.array(z.number().int().min(1).max(2000000)).max(PERSONAL_MAX_ROWS).optional(),
}).strict();
export type PersonalPayload = z.infer<typeof personalPayloadSchema>;

const headerKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
export function checkPersonalHeaders(headers: string[]) {
  const keys = headers.map(headerKey);
  const allowed = new Set<string>([...PERSONAL_REQUIRED_HEADERS, ...PERSONAL_OPTIONAL_HEADERS]);
  if (new Set(keys).size !== keys.length || PERSONAL_REQUIRED_HEADERS.some(h => !keys.includes(h)) || keys.some(k => !allowed.has(k))) {
    throw new z.ZodError([{ code: "custom", path: ["headers"], message: `Encabezados requeridos: ${PERSONAL_REQUIRED_HEADERS.join(", ")} (opcional: ${PERSONAL_OPTIONAL_HEADERS.join(", ")}).` }]);
  }
}
export function hasCargoColumn(headers: string[]) { return headers.some(h => headerKey(h) === "cargo"); }

// El DNI siempre es texto y debe tener exactamente 8 dígitos (todo el personal es peruano): no se completan ceros.
export function checkDni(value: string | undefined): { dni: string } | { error: string } {
  const text = cleanCell(value).replace(/^'/, "");
  if (!text) return { error: "DNI vacío." };
  if (/^\d{8}$/.test(text)) return { dni: text };
  if (/^\d+$/.test(text)) return { error: `DNI con ${text.length} dígitos: ${text}` };
  return { error: `DNI con caracteres no numéricos: ${text}` };
}
const booleanValue = (value: string) => {
  const normalized = cleanCell(value).toLowerCase();
  if (["true", "1", "si", "sí"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
};
const noControl = (text: string) => !/[\u0000-\u001f]/.test(text);

type Row = { fila: number; codigo_personal: string; nombre: string; dni: string; cargo: string | null; activo: boolean };

export function validatePersonalRows(rows: Record<string, string>[], filas?: number[]) {
  const issues: ImportIssue[] = []; const valid: Row[] = [];
  rows.forEach((raw, index) => {
    const fila = filas?.[index] ?? index + 2;
    const r = Object.fromEntries(Object.entries(raw).map(([name, value]) => [headerKey(name), cleanCell(value)]));
    const codigo = r.codigo_personal ?? "";
    const fail = (message: string) => issues.push({ row: fila, code: codigo || r.dni || "—", message, action: "error", nombre: (r.nombre ?? "").replace(/\s+/g, " "), dni: r.dni ?? "" });
    if (!codigo || codigo.length > 80 || !noControl(codigo)) return fail("codigo_personal es obligatorio o demasiado largo.");
    const nombre = (r.nombre ?? "").replace(/\s+/g, " ");
    if (!nombre || nombre.length > 200 || !noControl(nombre)) return fail("nombre es obligatorio o demasiado largo.");
    const dni = checkDni(r.dni);
    if ("error" in dni) return fail(dni.error);
    const activo = booleanValue(r.activo ?? "");
    if (activo === null) return fail("activo debe ser true/false, sí/no o 1/0.");
    const cargo = r.cargo ? r.cargo : null;
    if (cargo && (cargo.length > 120 || !noControl(cargo))) return fail("cargo es demasiado largo.");
    valid.push({ fila, codigo_personal: codigo, nombre, dni: dni.dni, cargo, activo });
  });
  return { valid, issues };
}

// DNI o código repetidos DENTRO del archivo: se marcan todas las filas implicadas (con sus números) y no se importan.
export function checkPersonalFile(valid: Row[]) {
  const issues: ImportIssue[] = []; const bad = new Set<number>();
  for (const [campo, label] of [["dni", "El DNI"], ["codigo_personal", "El código"]] as const) {
    const groups = new Map<string, Row[]>();
    for (const row of valid) groups.set(row[campo], [...(groups.get(row[campo]) ?? []), row]);
    for (const [value, rows] of groups) if (rows.length > 1) {
      for (const row of rows) {
        bad.add(row.fila);
        issues.push({ row: row.fila, code: row.codigo_personal, action: "error", message: `${label} ${value} está repetido en las filas ${rows.map(item => item.fila).join(", ")}.` });
      }
    }
  }
  return { ok: valid.filter(row => !bad.has(row.fila)), issues };
}

const emptyPreview = (): PersonalPreview => ({ aplicado: false, nuevos: 0, sin_cambios: 0, actualizados: 0, diferencias: [], errores: [] });

export async function preparePersonalImport(db: SupabaseClient, input: unknown) {
  const parsed = personalPayloadSchema.parse(input);
  checkPersonalHeaders(parsed.headers);
  const { valid, issues } = validatePersonalRows(parsed.rows, parsed.filas);
  const file = checkPersonalFile(valid);
  const tsIssues = [...issues, ...file.issues];
  const finish = (personal: PersonalPreview): PersonalImportPreview => {
    const dbIssues: ImportIssue[] = personal.errores.map(e => ({ row: e.fila, code: e.codigo, message: e.mensaje, action: "error" }));
    const byRow = new Map(file.ok.map(r => [r.fila, r] as const));
    const all = [...tsIssues, ...dbIssues].map(i => ({ ...i, nombre: i.nombre ?? byRow.get(i.row)?.nombre, dni: i.dni ?? byRow.get(i.row)?.dni })).sort((a, b) => a.row - b.row || a.message.localeCompare(b.message));
    const flagged = new Set(all.map(i => i.row));
    return { rows: file.ok, issues: all, nuevos: personal.nuevos, actualizados: personal.aplicado ? personal.actualizados : personal.diferencias.length, omitidos: personal.sin_cambios,
      errores: flagged.size, personal };
  };
  if (!file.ok.length) return { parsed, preview: finish(emptyPreview()) };
  // Sin columna cargo, las personas nuevas se crean con el cargo por defecto; con ella, se usa el de cada fila.
  const { data, error } = await db.rpc("admin_importar_personal", {
    p_filas: file.ok, p_aplicar: parsed.mode === "apply", p_actualizar: parsed.actualizar, p_cargo_defecto: parsed.cargo_defecto,
  });
  if (error) {
    if (["22023", "55000", "23505"].includes(error.code)) throw new ImportInputError(error.message);
    throw new Error("No se pudo procesar la importación.");
  }
  return { parsed, preview: finish(data as PersonalPreview) };
}

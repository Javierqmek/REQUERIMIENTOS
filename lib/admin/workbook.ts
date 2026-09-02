import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import type { SidigeRequirement } from "./types";
import { SIDIGE_HEADERS, SidigeValidationError, toSidigeRows, type IncompleteRequirement } from "./sidige";

export class EmptyExportError extends Error {
  constructor() { super("No hay requerimientos para exportar con los filtros seleccionados."); }
}
export class ExportLimitError extends Error {
  constructor() { super("La exportación supera el límite de filas de Excel. Reduce el rango de fechas."); }
}
export async function buildSidigeWorkbook(requirements: AsyncIterable<SidigeRequirement>, signal?: AbortSignal): Promise<Buffer> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
  const sheet = workbook.addWorksheet("SIDIGE");
  sheet.addRow([...SIDIGE_HEADERS]).commit();
  const issues: IncompleteRequirement[] = [];
  let incomplete = 0, count = 0, failure: unknown, failed = false;
  try {
    for await (const requirement of requirements) {
      signal?.throwIfAborted();
      try {
        const rows = toSidigeRows(requirement);
        if (count + rows.length > 1048575) throw new ExportLimitError();
        for (const values of rows) {
          const row = sheet.addRow(values);
          [1, 2, 3, 4, 6, 7, 8].forEach(index => { row.getCell(index).numFmt = "@"; });
          row.getCell(5).numFmt = "0";
          row.getCell(9).numFmt = "0";
          row.getCell(10).numFmt = "0.00";
          row.commit();
        }
        count += rows.length;
      } catch (error) {
        if (!(error instanceof SidigeValidationError)) throw error;
        incomplete += error.total;
        if (issues.length < 20) issues.push(...error.issues.slice(0, 20 - issues.length));
      }
    }
  } catch (error) { failure = error; failed = true; }
  // Finaliza también en error, para cerrar los streams. Nunca se entrega un archivo parcial.
  sheet.commit();
  await workbook.commit();
  if (failed) throw failure;
  if (incomplete) throw new SidigeValidationError(issues, incomplete);
  if (!count) throw new EmptyExportError();
  return Buffer.concat(chunks);
}
export function sidigeFilename(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (key: string) => parts.find(p => p.type === key)?.value;
  return `MIGRADOR_RENOVACION_VERANO_${part("year")}${part("month")}${part("day")}_${part("hour")}${part("minute")}.xlsx`;
}

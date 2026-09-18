import { PDFDocument } from "pdf-lib";
import { safePdfName, sha256 } from "@/lib/documents/security";
import { isA4Size } from "./paper";

export const PAPELETA_BUCKET = "papeletas-vacaciones";
export const MAX_PAPELETA_BYTES = Number(process.env.DOCUMENT_MAX_BYTES || 10 * 1024 * 1024);
export const MAX_PAPELETA_PAGES = 30;

// Validación técnica autoritativa (servidor): PDF real, tamaño, páginas y A4 con tolerancia.
// No certifica legibilidad humana: eso lo confirma el coordinador mediante el checkbox obligatorio.
export async function validatePapeletaPdf(file: File) {
  if (file.size < 8 || file.size > MAX_PAPELETA_BYTES) {
    throw new Error(`El PDF debe pesar como máximo ${Math.round(MAX_PAPELETA_BYTES / 1048576)} MB.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("El archivo no es un PDF válido.");
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { ignoreEncryption: false }); }
  catch { throw new Error("El PDF está dañado, cifrado o no es compatible."); }
  const pages = pdf.getPages();
  if (pages.length < 1 || pages.length > MAX_PAPELETA_PAGES) {
    throw new Error(`La papeleta debe tener entre 1 y ${MAX_PAPELETA_PAGES} páginas.`);
  }
  for (const page of pages) {
    const { width, height } = page.getSize();
    if (!isA4Size(width, height)) throw new Error("El PDF debe estar en formato A4 (210 × 297 mm), con tolerancia razonable de escaneo.");
  }
  return { bytes, pages: pages.length, hash: sha256(bytes), name: safePdfName(file.name) };
}

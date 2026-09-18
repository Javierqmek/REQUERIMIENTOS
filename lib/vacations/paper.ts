// Sin dependencias de Node: se usa tanto en servidor (validación autoritativa) como en
// el navegador (aviso temprano antes de subir el archivo).
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;
const TOLERANCE_PT = 18; // ~0.25 in de margen por variación de escáner.

export function isA4Size(width: number, height: number): boolean {
  const portrait = Math.abs(width - A4_WIDTH_PT) <= TOLERANCE_PT && Math.abs(height - A4_HEIGHT_PT) <= TOLERANCE_PT;
  const landscape = Math.abs(width - A4_HEIGHT_PT) <= TOLERANCE_PT && Math.abs(height - A4_WIDTH_PT) <= TOLERANCE_PT;
  return portrait || landscape;
}

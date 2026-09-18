// Matemática pura de arrastre/redimensión de una colocación (coordenadas relativas 0-1 sobre la
// página). Extraída de components/document-workspace.tsx para que el editor de firma de
// Documentos y el de Vacaciones compartan EXACTAMENTE la misma lógica de interacción en vez de
// reimplementarla: ver components/vacation-sign-workspace.tsx.
export type EditablePlacement = { x: number; y: number; ancho: number; alto: number; group?: string };

export function movePlacements<T extends EditablePlacement>(snapshot: T[], index: number, dx: number, dy: number): T[] {
  const origin = snapshot[index];
  return snapshot.map((item, i) => {
    if (i !== index && (!origin.group || item.group !== origin.group)) return item;
    return { ...item, x: Math.max(0, Math.min(1 - item.ancho, item.x + dx)), y: Math.max(0, Math.min(1 - item.alto, item.y + dy)) };
  });
}

export function resizePlacements<T extends EditablePlacement>(snapshot: T[], index: number, dx: number, dy: number): T[] {
  const origin = snapshot[index];
  const scale = Math.max(0.55, Math.min(1.8, 1 + Math.max(dx / origin.ancho, dy / origin.alto)));
  return snapshot.map((item, i) => {
    if (i !== index && (!origin.group || item.group !== origin.group)) return item;
    const anchorX = origin.group ? Math.min(...snapshot.filter(x => x.group === origin.group).map(x => x.x)) : origin.x;
    const anchorY = origin.group ? Math.min(...snapshot.filter(x => x.group === origin.group).map(x => x.y)) : origin.y;
    const ancho = Math.max(0.06, Math.min(1 - item.x, item.ancho * scale));
    const alto = Math.max(0.04, Math.min(1 - item.y, item.alto * scale));
    return { ...item, x: anchorX + (item.x - anchorX) * scale, y: anchorY + (item.y - anchorY) * scale, ancho, alto };
  });
}

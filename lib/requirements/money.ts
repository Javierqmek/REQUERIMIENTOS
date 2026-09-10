export type AmountLine = { cantidad: number; precio: number };
export type HistoricalAmountLine = { cantidad: number; precio_unitario: number | string | null; activo?: boolean };

function finite(value: number | string | null | undefined) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function catalogTotal(lines: AmountLine[]) {
  return lines.reduce((total, line) => total + finite(line.precio) * finite(line.cantidad), 0);
}

export function historicalTotal(lines: HistoricalAmountLine[] = []) {
  return lines.filter(line => line.activo !== false)
    .reduce((total, line) => total + finite(line.precio_unitario) * finite(line.cantidad), 0);
}

export function formatMoney(value: number | string | null | undefined) {
  return `S/ ${finite(value).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

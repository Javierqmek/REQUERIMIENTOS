// Fechas como 'YYYY-MM-DD' (sin hora): comparables lexicográficamente, sin husos horarios.
export function calendarDays(inicio: string, fin: string): number {
  const start = new Date(`${inicio}T00:00:00Z`).getTime();
  const end = new Date(`${fin}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86400000) + 1;
}

export function validatePhysicalRange(inicio: string, fin: string): string | null {
  if (!inicio) return "La fecha de inicio de vacaciones físicas es obligatoria.";
  if (!fin) return "La fecha de fin de vacaciones físicas es obligatoria.";
  if (fin < inicio) return "La fecha de fin debe ser igual o posterior a la fecha de inicio.";
  return null;
}

// venta_fecha_inicio > fisicas_fecha_fin, estrictamente: excluye superposición, cruce y misma fecha.
export function validateSaleRange(
  tieneVenta: boolean,
  fisicasFin: string,
  ventaInicio: string,
  ventaFin: string,
): string | null {
  if (!tieneVenta) return null;
  if (!ventaInicio) return "La fecha de inicio de venta es obligatoria.";
  if (!ventaFin) return "La fecha de fin de venta es obligatoria.";
  if (ventaFin < ventaInicio) return "La fecha de fin de venta debe ser igual o posterior a su fecha de inicio.";
  if (fisicasFin && ventaInicio <= fisicasFin) {
    return "La venta de vacaciones debe iniciar después del fin de las vacaciones físicas, sin cruces ni la misma fecha.";
  }
  return null;
}

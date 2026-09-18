// Path determinista por (coordinador, request_id): un reintento del mismo envío siempre
// apunta al mismo objeto de Storage, nunca genera un segundo PDF. Debe coincidir exactamente
// con la comprobación de registrar_papeleta_vacaciones en la migración.
export function papeletaStoragePath(coordinadorId: string, requestId: string) {
  return `${coordinadorId}/${requestId}.pdf`;
}

// Path determinista por (coordinador, papeleta, versión destino): cada corrección sube un PDF
// nuevo sin tocar el de versiones anteriores. Debe coincidir con corregir_papeleta_vacaciones.
export function papeletaCorrectionStoragePath(coordinadorId: string, papeletaId: string, version: number) {
  return `${coordinadorId}/${papeletaId}/v${version}.pdf`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidRequestId(value: string) {
  return UUID_RE.test(value);
}

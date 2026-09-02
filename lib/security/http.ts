export class HttpInputError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function assertSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
    throw new HttpInputError(403, "Origen no autorizado.");
  }
}
// Lee por bloques: no confía en Content-Length ni carga JSON ilimitado en memoria.
export async function readJsonBody(request: Request, maxBytes = 128 * 1024): Promise<unknown> {
  assertSameOrigin(request);
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new HttpInputError(413, "Solicitud demasiado grande.");
  if (!request.body) throw new HttpInputError(400, "JSON requerido.");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new HttpInputError(413, "Solicitud demasiado grande."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new HttpInputError(400, "JSON inválido."); }
}

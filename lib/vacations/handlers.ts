import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { assertSameOrigin } from "@/lib/security/http";
import { papeletaCorrectionSchema, papeletaSchema } from "./validations";
import { MAX_PAPELETA_BYTES, PAPELETA_BUCKET, validatePapeletaPdf } from "./pdf";
import { isValidRequestId, papeletaCorrectionStoragePath, papeletaStoragePath } from "./storage-path";
import { createSignedPdf } from "@/lib/documents/pdf";
import { sha256 } from "@/lib/documents/security";
import { allowTestPapeletaDeletion } from "./config";
import type { Placement } from "@/lib/documents/types";

type Dependencies = { getProfile: () => Promise<Profile | null>; getDb: () => Promise<SupabaseClient> };
const json = (body: unknown, status = 200) => Response.json(body, { status });

function statusForPapeletaError(code: string | undefined) {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "55000" || code === "40001") return 409;
  if (code === "22023") return 400;
  return 500;
}

// Extraído a una fábrica inyectable (mismo patrón que lib/requirements/handlers.ts) para
// poder probar la idempotencia con un cliente Supabase simulado, sin sesión ni red real.
export function makeRegisterPapeletaHandler(deps: Dependencies) {
  return async (request: Request) => {
    let uploadedPath = "";
    let uploadedNewFile = false;
    try {
      assertSameOrigin(request);
      const profile = await deps.getProfile();
      if (!profile || profile.role !== "coordinador") {
        return json({ error: "Solo coordinadores pueden registrar papeletas de vacaciones." }, 403);
      }
      const length = Number(request.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_PAPELETA_BYTES + 256 * 1024) {
        return json({ error: "Solicitud demasiado grande." }, 413);
      }
      const form = await request.formData();
      const file = form.get("archivo");
      if (!(file instanceof File)) return json({ error: "Selecciona un PDF." }, 400);
      if (form.get("confirmacion_legibilidad") !== "true") {
        return json({ error: "Debes confirmar que el documento está completo y legible." }, 400);
      }
      const requestId = String(form.get("request_id") || "");
      if (!isValidRequestId(requestId)) return json({ error: "Solicitud inválida." }, 400);

      const raw = {
        colaborador_id: String(form.get("colaborador_id") || ""),
        reemplazo_id: String(form.get("reemplazo_id") || ""),
        provincia_id: String(form.get("provincia_id") || ""),
        cliente_id: String(form.get("cliente_id") || ""),
        unidad_id: String(form.get("unidad_id") || ""),
        fisicas_fecha_inicio: String(form.get("fisicas_fecha_inicio") || ""),
        fisicas_fecha_fin: String(form.get("fisicas_fecha_fin") || ""),
        tiene_venta: form.get("tiene_venta") === "true",
        venta_fecha_inicio: form.get("venta_fecha_inicio") ? String(form.get("venta_fecha_inicio")) : null,
        venta_fecha_fin: form.get("venta_fecha_fin") ? String(form.get("venta_fecha_fin")) : null,
      };
      const parsed = papeletaSchema.safeParse(raw);
      if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);

      const db = await deps.getDb();

      // Reintento (doble clic, timeout, respuesta perdida): si ya existe una papeleta para
      // este coordinador + request_id, se devuelve sin releer el PDF, subir nada ni validar de nuevo.
      const existing = await db.from("papeletas_vacaciones").select("id")
        .eq("coordinador_id", profile.id).eq("request_id", requestId).maybeSingle();
      if (existing.data) return json({ id: (existing.data as { id: string }).id }, 200);

      const pdf = await validatePapeletaPdf(file);
      uploadedPath = papeletaStoragePath(profile.id, requestId);
      const upload = await db.storage.from(PAPELETA_BUCKET).upload(uploadedPath, pdf.bytes, { contentType: "application/pdf", upsert: false });
      if (upload.error) {
        // Path determinista: un "ya existe" solo puede venir de una carrera con otro intento
        // del mismo request_id que ya terminó de registrarse. Nunca se sobrescribe.
        const retry = await db.from("papeletas_vacaciones").select("id")
          .eq("coordinador_id", profile.id).eq("request_id", requestId).maybeSingle();
        if (retry.data) return json({ id: (retry.data as { id: string }).id }, 200);
        throw new Error("No se pudo almacenar el PDF.");
      }
      uploadedNewFile = true;

      const { data, error } = await db.rpc("registrar_papeleta_vacaciones", {
        p_request_id: requestId,
        p_colaborador_id: parsed.data.colaborador_id,
        p_reemplazo_id: parsed.data.reemplazo_id,
        p_provincia_id: parsed.data.provincia_id,
        p_cliente_id: parsed.data.cliente_id,
        p_unidad_id: parsed.data.unidad_id,
        p_fisicas_inicio: parsed.data.fisicas_fecha_inicio,
        p_fisicas_fin: parsed.data.fisicas_fecha_fin,
        p_tiene_venta: parsed.data.tiene_venta,
        p_venta_inicio: parsed.data.venta_fecha_inicio,
        p_venta_fin: parsed.data.venta_fecha_fin,
        p_archivo_path: uploadedPath,
        p_archivo_nombre: pdf.name,
        p_archivo_sha256: pdf.hash,
        p_archivo_bytes: pdf.bytes.length,
      });
      if (error) {
        // Solo se limpia el archivo subido en este intento; nunca uno de otro intento válido.
        if (uploadedNewFile) await db.storage.from(PAPELETA_BUCKET).remove([uploadedPath]);
        throw new Error(error.message);
      }
      return json({ id: data }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "No se pudo registrar la papeleta." }, 400);
    }
  };
}

// Admin/gerente: observar (con motivo obligatorio) o marcar conforme una papeleta REGISTRADO.
// Nunca el propio coordinador que la creó, aunque casualmente tuviera un rol revisor.
export function makeReviewPapeletaHandler(deps: Dependencies) {
  return async (request: Request, papeletaId: string) => {
    try {
      assertSameOrigin(request);
      const profile = await deps.getProfile();
      if (!profile || (profile.role !== "admin" && profile.role !== "gerente")) {
        return json({ error: "Solo administradores o gerentes pueden revisar papeletas." }, 403);
      }
      if (!isValidRequestId(papeletaId)) return json({ error: "Solicitud inválida." }, 400);
      const body = await request.json().catch(() => null) as { accion?: string; motivo?: string } | null;
      const db = await deps.getDb();
      if (body?.accion === "observar") {
        const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";
        if (!motivo) return json({ error: "El motivo de observación es obligatorio." }, 400);
        const { error } = await db.rpc("observar_papeleta_vacaciones", { p_papeleta_id: papeletaId, p_motivo: motivo });
        if (error) return json({ error: error.message }, statusForPapeletaError(error.code));
        return json({ ok: true });
      }
      return json({ error: "Acción inválida." }, 400);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "No se pudo completar la acción." }, 400);
    }
  };
}

// Coordinador: corrige su propia papeleta OBSERVADA. colaborador_id no es editable (se toma
// del formulario solo para validar el reemplazo, nunca se envía a la RPC como campo mutable).
export function makeCorrectPapeletaHandler(deps: Dependencies) {
  return async (request: Request, papeletaId: string) => {
    let uploadedPath = "";
    let uploadedNewFile = false;
    try {
      assertSameOrigin(request);
      const profile = await deps.getProfile();
      if (!profile || profile.role !== "coordinador") {
        return json({ error: "Solo el coordinador puede corregir su papeleta." }, 403);
      }
      if (!isValidRequestId(papeletaId)) return json({ error: "Solicitud inválida." }, 400);
      const length = Number(request.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_PAPELETA_BYTES + 256 * 1024) {
        return json({ error: "Solicitud demasiado grande." }, 413);
      }
      const form = await request.formData();
      const file = form.get("archivo");
      if (!(file instanceof File)) return json({ error: "Selecciona un PDF." }, 400);
      if (form.get("confirmacion_legibilidad") !== "true") {
        return json({ error: "Debes confirmar que el documento está completo y legible." }, 400);
      }
      const colaboradorId = String(form.get("colaborador_id") || "");
      if (!isValidRequestId(colaboradorId)) return json({ error: "Solicitud inválida." }, 400);
      const versionEsperada = Number(form.get("version_esperada"));
      if (!Number.isInteger(versionEsperada) || versionEsperada < 1) return json({ error: "Solicitud inválida." }, 400);

      const raw = {
        reemplazo_id: String(form.get("reemplazo_id") || ""),
        provincia_id: String(form.get("provincia_id") || ""),
        cliente_id: String(form.get("cliente_id") || ""),
        unidad_id: String(form.get("unidad_id") || ""),
        fisicas_fecha_inicio: String(form.get("fisicas_fecha_inicio") || ""),
        fisicas_fecha_fin: String(form.get("fisicas_fecha_fin") || ""),
        tiene_venta: form.get("tiene_venta") === "true",
        venta_fecha_inicio: form.get("venta_fecha_inicio") ? String(form.get("venta_fecha_inicio")) : null,
        venta_fecha_fin: form.get("venta_fecha_fin") ? String(form.get("venta_fecha_fin")) : null,
      };
      const parsed = papeletaCorrectionSchema(colaboradorId).safeParse(raw);
      if (!parsed.success) return json({ error: parsed.error.issues[0].message }, 400);

      const db = await deps.getDb();
      const pdf = await validatePapeletaPdf(file);
      const targetVersion = versionEsperada + 1;
      uploadedPath = papeletaCorrectionStoragePath(profile.id, papeletaId, targetVersion);
      const upload = await db.storage.from(PAPELETA_BUCKET).upload(uploadedPath, pdf.bytes, { contentType: "application/pdf", upsert: false });
      if (upload.error) throw new Error("No se pudo almacenar el PDF.");
      uploadedNewFile = true;

      const { data, error } = await db.rpc("corregir_papeleta_vacaciones", {
        p_papeleta_id: papeletaId,
        p_version_esperada: versionEsperada,
        p_reemplazo_id: parsed.data.reemplazo_id,
        p_provincia_id: parsed.data.provincia_id,
        p_cliente_id: parsed.data.cliente_id,
        p_unidad_id: parsed.data.unidad_id,
        p_fisicas_inicio: parsed.data.fisicas_fecha_inicio,
        p_fisicas_fin: parsed.data.fisicas_fecha_fin,
        p_tiene_venta: parsed.data.tiene_venta,
        p_venta_inicio: parsed.data.venta_fecha_inicio,
        p_venta_fin: parsed.data.venta_fecha_fin,
        p_archivo_path: uploadedPath,
        p_archivo_nombre: pdf.name,
        p_archivo_sha256: pdf.hash,
        p_archivo_bytes: pdf.bytes.length,
      });
      if (error) {
        // La versión anterior nunca se toca: solo se limpia el archivo de este intento fallido.
        if (uploadedNewFile) await db.storage.from(PAPELETA_BUCKET).remove([uploadedPath]);
        return json({ error: error.message }, statusForPapeletaError(error.code));
      }
      return json({ id: data }, 200);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "No se pudo guardar la corrección." }, 400);
    }
  };
}

type SignPlacementInput = { pagina: number; x: number; y: number; ancho: number; alto: number };
function parsePlacement(value: unknown): SignPlacementInput | null {
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;
  const keys = ["pagina", "x", "y", "ancho", "alto"] as const;
  if (!keys.every(k => typeof o[k] === "number" && Number.isFinite(o[k]))) return null;
  const p = o as unknown as SignPlacementInput;
  if (!Number.isInteger(p.pagina) || p.pagina < 1) return null;
  if (p.ancho <= 0 || p.alto <= 0 || p.x < 0 || p.y < 0 || p.x + p.ancho > 1.001 || p.y + p.alto > 1.001) return null;
  return p;
}
async function loadSigningContext(db: SupabaseClient, profileId: string, papeletaId: string, versionEsperada: number, shaOrigen: string) {
  const { data: papeleta, error: papeletaError } = await db.from("papeletas_vacaciones")
    .select("id,coordinador_id,estado,version_actual,archivo_path,archivo_sha256")
    .eq("id", papeletaId).maybeSingle();
  if (papeletaError || !papeleta) return { error: json({ error: "Papeleta no disponible." }, 404) } as const;
  const doc = papeleta as { id: string; coordinador_id: string; estado: string; version_actual: number; archivo_path: string; archivo_sha256: string };
  if (doc.estado !== "REGISTRADO") return { error: json({ error: "Solo puede firmarse una papeleta pendiente de firma." }, 409) } as const;
  // Verificación explícita de papeleta_id + version_id/numero + SHA-256 de la versión origen:
  // si cualquiera cambió desde que el gerente abrió el editor, nunca se firma en silencio una
  // versión vieja -- se rechaza y se pide recargar.
  if (doc.version_actual !== versionEsperada || doc.archivo_sha256 !== shaOrigen) {
    return { error: json({ error: "La papeleta cambió mientras firmabas. Recarga antes de continuar." }, 409) } as const;
  }
  const { data: perfil, error: perfilError } = await db.from("perfiles_firma")
    .select("id,version,sello_path").eq("usuario_id", profileId).eq("activo", true).maybeSingle();
  if (perfilError || !perfil) return { error: json({ error: "Configura tu perfil de firma antes de firmar." }, 400) } as const;
  return { doc, perfil: perfil as { id: string; version: number; sello_path: string } } as const;
}

// Vista previa de la firma: compone el PDF EXACTAMENTE con la colocación que el gerente ubicó en
// el editor (mismo motor que Documentos: createSignedPdf + perfiles_firma), sin persistir nada
// -- igual que /api/documentos/[id]/preview. Permite ver el resultado antes de confirmar.
export function makePreviewSignPapeletaHandler(deps: Dependencies) {
  return async (request: Request, papeletaId: string) => {
    try {
      assertSameOrigin(request);
      const profile = await deps.getProfile();
      if (!profile || profile.role !== "gerente") return json({ error: "Solo el gerente puede firmar." }, 403);
      if (!isValidRequestId(papeletaId)) return json({ error: "Solicitud inválida." }, 400);
      const body = await request.json().catch(() => null) as { version_esperada?: number; archivo_sha256_origen?: string; placement?: unknown } | null;
      const versionEsperada = Number(body?.version_esperada);
      const shaOrigen = String(body?.archivo_sha256_origen || "");
      const placementInput = parsePlacement(body?.placement);
      if (!Number.isInteger(versionEsperada) || versionEsperada < 1 || !/^[0-9a-f]{64}$/.test(shaOrigen) || !placementInput) {
        return json({ error: "Solicitud inválida." }, 400);
      }
      const db = await deps.getDb();
      const context = await loadSigningContext(db, profile.id, papeletaId, versionEsperada, shaOrigen);
      if (context.error) return context.error;
      const placement: Placement = { tipo: "SELLO", ...placementInput, asset_path: context.perfil.sello_path };
      const signed = await createSignedPdf(db, context.doc.archivo_path, [placement], context.doc.archivo_sha256, PAPELETA_BUCKET);
      return new Response(new Blob([new Uint8Array(signed.bytes)], { type: "application/pdf" }), {
        headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Preview-SHA256": signed.hash },
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "No se pudo generar la vista previa." }, 400);
    }
  };
}

// Firma del gerente: reutiliza el mismo motor de composición que Documentos/Firma
// (lib/documents/pdf.ts::createSignedPdf + perfiles_firma) y el mismo editor de colocación
// interactivo (components/vacation-sign-workspace.tsx, que comparte la lógica de arrastre/
// redimensión y el render de components/document-workspace.tsx) -- nunca una posición fija.
// Verifica papeleta_id + versión + hash de origen antes de componer: si algo cambió desde que
// el gerente abrió el visor, rechaza y pide recargar en vez de firmar una versión vieja.
// Nunca sobrescribe la versión previa: sube un PDF nuevo y la RPC firmar_papeleta_vacaciones
// mueve el puntero "vigente".
export function makeSignPapeletaHandler(deps: Dependencies) {
  return async (request: Request, papeletaId: string) => {
    let uploadedPath = "";
    let uploadedNewFile = false;
    try {
      assertSameOrigin(request);
      const profile = await deps.getProfile();
      if (!profile || profile.role !== "gerente") return json({ error: "Solo el gerente puede firmar." }, 403);
      if (!isValidRequestId(papeletaId)) return json({ error: "Solicitud inválida." }, 400);
      const body = await request.json().catch(() => null) as { version_esperada?: number; archivo_sha256_origen?: string; placement?: unknown } | null;
      const versionEsperada = Number(body?.version_esperada);
      const shaOrigen = String(body?.archivo_sha256_origen || "");
      const placementInput = parsePlacement(body?.placement);
      if (!Number.isInteger(versionEsperada) || versionEsperada < 1 || !/^[0-9a-f]{64}$/.test(shaOrigen) || !placementInput) {
        return json({ error: "Solicitud inválida." }, 400);
      }

      const db = await deps.getDb();
      const context = await loadSigningContext(db, profile.id, papeletaId, versionEsperada, shaOrigen);
      if (context.error) return context.error;
      const { doc, perfil: perfilRow } = context;

      const placement: Placement = { tipo: "SELLO", ...placementInput, asset_path: perfilRow.sello_path };
      const signed = await createSignedPdf(db, doc.archivo_path, [placement], doc.archivo_sha256, PAPELETA_BUCKET);
      if (sha256(signed.bytes) !== signed.hash) throw new Error("No se pudo verificar el PDF firmado.");

      const targetVersion = versionEsperada + 1;
      uploadedPath = papeletaCorrectionStoragePath(doc.coordinador_id, papeletaId, targetVersion);
      const upload = await db.storage.from(PAPELETA_BUCKET).upload(uploadedPath, signed.bytes, { contentType: "application/pdf", upsert: false });
      if (upload.error) throw new Error("No se pudo almacenar el PDF firmado.");
      uploadedNewFile = true;

      const { data, error } = await db.rpc("firmar_papeleta_vacaciones", {
        p_papeleta_id: papeletaId,
        p_version_esperada: versionEsperada,
        p_archivo_sha256_origen: shaOrigen,
        p_perfil_firma_id: perfilRow.id,
        p_archivo_path: uploadedPath,
        p_archivo_nombre: "papeleta-firmada.pdf",
        p_archivo_sha256: signed.hash,
        p_archivo_bytes: signed.bytes.length,
      });
      if (error) {
        if (uploadedNewFile) await db.storage.from(PAPELETA_BUCKET).remove([uploadedPath]);
        return json({ error: error.message }, statusForPapeletaError(error.code));
      }
      return json({ id: data }, 200);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "No se pudo firmar la papeleta." }, 400);
    }
  };
}

// Admin marca/desmarca explícitamente una papeleta como "de prueba". Nunca se infiere por
// nombre: es la única forma de habilitarla luego para el borrado controlado.
export function makeMarkTestPapeletaHandler(deps: Dependencies) {
  return async (request: Request, papeletaId: string) => {
    try {
      assertSameOrigin(request);
      const profile = await deps.getProfile();
      if (!profile || profile.role !== "admin") return json({ error: "Solo administradores." }, 403);
      if (!isValidRequestId(papeletaId)) return json({ error: "Solicitud inválida." }, 400);
      const body = await request.json().catch(() => null) as { es_prueba?: boolean } | null;
      if (typeof body?.es_prueba !== "boolean") return json({ error: "Solicitud inválida." }, 400);
      const db = await deps.getDb();
      const { data, error } = await db.rpc("admin_marcar_papeleta_prueba", { p_papeleta_id: papeletaId, p_es_prueba: body.es_prueba });
      if (error) return json({ error: error.message }, statusForPapeletaError(error.code));
      return json(data);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "No se pudo actualizar." }, 400);
    }
  };
}

// Borrado controlado de papeletas de prueba: solo admin, doble flag (env + private.app_config,
// ambos verificados -- la RPC ya valida el de BD, aquí se valida además el de entorno para poder
// apagar la función completa en producción sin tocar la base de datos), nunca FIRMADO, nunca por
// nombre. Tras el borrado en BD, limpia también los objetos de Storage de cada versión eliminada.
// Postgres y Supabase Storage no comparten transacción: la RPC ya deja cada ruta registrada en
// private.papeleta_storage_borrado_pendiente ANTES de confirmar el borrado en BD (ver migración),
// así que un fallo de Storage aquí nunca deja un huérfano sin rastro -- solo queda pendiente.
// Esta función intenta el borrado y SOLO confirma (retira de la cola) las rutas que Storage
// realmente reportó como eliminadas; el resto se registra como intento fallido y se informa
// explícitamente como "pendientes" en la respuesta, nunca como éxito silencioso.
async function removeAndConfirmStorage(db: SupabaseClient, paths: string[]) {
  if (!paths.length) return { borrados: 0, pendientes: 0 };
  const result = await db.storage.from(PAPELETA_BUCKET).remove(paths);
  const removedNames = new Set((result.data as { name: string }[] | null || []).map((row) => row.name));
  // Cuando Storage no puede resolver un path (p.ej. ya no existe), Supabase lo omite del array
  // `data` sin marcarlo como error individual: por eso la confirmación se basa en qué rutas
  // aparecen realmente en la respuesta, no en si `error` viene nulo.
  const confirmed = paths.filter((path) => removedNames.has(path));
  const pending = paths.filter((path) => !removedNames.has(path));
  if (confirmed.length) await db.rpc("admin_confirmar_borrado_storage", { p_paths: confirmed });
  if (pending.length) await db.rpc("admin_registrar_intento_borrado_storage", { p_paths: pending, p_error: result.error?.message || "Storage no confirmó la eliminación de estas rutas." });
  return { borrados: confirmed.length, pendientes: pending.length };
}

export function makeDeleteTestPapeletasHandler(deps: Dependencies, enabled = allowTestPapeletaDeletion) {
  return async (request: Request) => {
    try {
      assertSameOrigin(request);
      const profile = await deps.getProfile();
      if (!profile || profile.role !== "admin") return json({ error: "Solo administradores." }, 403);
      if (!enabled()) return json({ error: "La eliminación de papeletas de prueba está deshabilitada." }, 403);
      const body = await request.json().catch(() => null) as { ids?: string[] } | null;
      const ids = Array.isArray(body?.ids) ? body.ids : [];
      if (ids.length < 1 || ids.length > 100 || ids.some((id) => !isValidRequestId(id))) {
        return json({ error: "Selecciona entre 1 y 100 papeletas válidas." }, 400);
      }
      if (new Set(ids).size !== ids.length) return json({ error: "No repitas papeletas." }, 400);
      const db = await deps.getDb();
      const { data, error } = await db.rpc("admin_eliminar_papeletas_prueba", { p_ids: ids });
      if (error) return json({ error: error.message }, statusForPapeletaError(error.code));
      const paths = (data as string[] | null) || [];
      const { borrados, pendientes } = await removeAndConfirmStorage(db, paths);
      return json({ eliminados: ids.length, archivos_borrados: borrados, archivos_pendientes: pendientes });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "No se pudieron eliminar las papeletas." }, 400);
    }
  };
}

// Reintenta la limpieza de Storage para todo lo que quedó pendiente de borrados de prueba
// anteriores (p.ej. porque Storage falló, o porque la respuesta de la primera llamada se perdió
// por red antes de llegar al cliente aunque la BD ya había confirmado). Idempotente: una ruta que
// ya no existe en Storage simplemente no vuelve a aparecer como "removida" y sigue pendiente para
// revisión manual si el reintento automático tampoco la resuelve.
export function makeRetryStorageCleanupHandler(deps: Dependencies) {
  return async (request: Request) => {
    try {
      assertSameOrigin(request);
      const profile = await deps.getProfile();
      if (!profile || profile.role !== "admin") return json({ error: "Solo administradores." }, 403);
      const db = await deps.getDb();
      const { data, error } = await db.rpc("admin_listar_borrados_pendientes");
      if (error) return json({ error: error.message }, statusForPapeletaError(error.code));
      const rows = (data as { archivo_path: string }[] | null) || [];
      const { borrados, pendientes } = await removeAndConfirmStorage(db, rows.map((row) => row.archivo_path));
      return json({ archivos_borrados: borrados, archivos_pendientes: pendientes });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "No se pudo reintentar la limpieza de Storage." }, 400);
    }
  };
}

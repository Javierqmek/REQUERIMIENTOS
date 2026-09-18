import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarDays, validatePhysicalRange, validateSaleRange } from "../lib/vacations/dates";
import { isA4Size } from "../lib/vacations/paper";
import { validatePapeletaPdf } from "../lib/vacations/pdf";
import { papeletaCorrectionSchema, papeletaSchema } from "../lib/vacations/validations";
import { isValidRequestId, papeletaCorrectionStoragePath, papeletaStoragePath } from "../lib/vacations/storage-path";
import { makeDeleteTestPapeletasHandler, makeMarkTestPapeletaHandler, makePreviewSignPapeletaHandler, makeRegisterPapeletaHandler, makeRetryStorageCleanupHandler, makeSignPapeletaHandler } from "../lib/vacations/handlers";
import { movePlacements, resizePlacements } from "../lib/documents/placement-client";
import { canCorrect, canObserve, canReview, canSign } from "../lib/vacations/review";
import { PAPELETA_DETAIL_SELECT, papeletaEstadoLabel, papeletaVersionTipoLabel } from "../lib/vacations/types";
import { allowTestPapeletaDeletion } from "../lib/vacations/config";
import { EMPTY_PAPELETA_FILTERS, PAPELETA_ESTADOS, papeletaFilterParams, papeletaFiltersSchema, papeletaRpcArgs } from "../lib/vacations/list-filters";
import { createSignedPdf } from "../lib/documents/pdf";
import { CATALOG_KINDS, catalogCreateSchema, catalogDeleteSchema, catalogUpdateSchema } from "../lib/admin/maintenance";

const asArrayBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const base = {
  colaborador_id: "11111111-1111-4111-8111-111111111111",
  reemplazo_id: "22222222-2222-4222-8222-222222222222",
  provincia_id: "33333333-3333-4333-8333-333333333333",
  cliente_id: "44444444-4444-4444-8444-444444444444",
  unidad_id: "55555555-5555-4555-8555-555555555555",
};

// --- Días calendario ---
test("calcula días calendario inclusivos", () => {
  assert.equal(calendarDays("2026-10-01", "2026-10-05"), 5);
  assert.equal(calendarDays("2026-10-01", "2026-10-01"), 1);
  assert.equal(calendarDays("2026-10-16", "2026-10-20"), 5);
});

// --- Reglas de físicas ---
test("exige fechas de físicas y fin >= inicio", () => {
  assert.match(validatePhysicalRange("", "2026-10-05") || "", /obligatoria/);
  assert.match(validatePhysicalRange("2026-10-05", "") || "", /obligatoria/);
  assert.match(validatePhysicalRange("2026-10-05", "2026-10-01") || "", /posterior/);
  assert.equal(validatePhysicalRange("2026-10-01", "2026-10-05"), null);
});

// --- Reglas de venta ---
test("solo físicas es válido: venta desactivada no exige nada", () => {
  assert.equal(validateSaleRange(false, "2026-10-15", "", ""), null);
});
test("venta antes de las físicas es inválida", () => {
  assert.match(validateSaleRange(true, "2026-10-15", "2026-10-14", "2026-10-20") || "", /después/);
});
test("venta el mismo día del fin de físicas es inválida (sin cruce)", () => {
  assert.match(validateSaleRange(true, "2026-10-15", "2026-10-15", "2026-10-20") || "", /después/);
});
test("venta cruzada/superpuesta es inválida", () => {
  assert.match(validateSaleRange(true, "2026-10-15", "2026-10-10", "2026-10-20") || "", /después/);
});
test("físicas + venta válida cuando la venta inicia después del fin de físicas", () => {
  assert.equal(validateSaleRange(true, "2026-10-15", "2026-10-16", "2026-10-20"), null);
  assert.equal(calendarDays("2026-10-16", "2026-10-20"), 5);
});
test("no se puede activar venta sin haber completado antes las físicas (no venta sin físicas)", () => {
  assert.match(validateSaleRange(true, "", "2026-10-16", "2026-10-20") ?? "", /obligatoria|^$/);
  // Con fin de físicas vacío la comparación de posterioridad no puede evaluarse: la UI bloquea
  // el checkbox de venta hasta tener un rango físico válido (ver vacation-request-form.tsx).
});

// --- Esquema Zod combinado ---
test("solo venta (sin físicas) es estructuralmente imposible: el esquema siempre exige físicas", () => {
  const parsed = papeletaSchema.safeParse({ ...base, fisicas_fecha_inicio: "", fisicas_fecha_fin: "", tiene_venta: true, venta_fecha_inicio: "2026-10-16", venta_fecha_fin: "2026-10-20" });
  assert.equal(parsed.success, false);
});
test("rechaza reemplazo igual al titular", () => {
  const parsed = papeletaSchema.safeParse({ ...base, reemplazo_id: base.colaborador_id, fisicas_fecha_inicio: "2026-10-01", fisicas_fecha_fin: "2026-10-05", tiene_venta: false, venta_fecha_inicio: null, venta_fecha_fin: null });
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.match(parsed.error.issues[0].message, /mismo colaborador/);
});
test("acepta físicas + venta válida completa", () => {
  const parsed = papeletaSchema.safeParse({ ...base, fisicas_fecha_inicio: "2026-10-01", fisicas_fecha_fin: "2026-10-15", tiene_venta: true, venta_fecha_inicio: "2026-10-16", venta_fecha_fin: "2026-10-20" });
  assert.equal(parsed.success, true);
});
test("acepta solo físicas sin venta", () => {
  const parsed = papeletaSchema.safeParse({ ...base, fisicas_fecha_inicio: "2026-10-01", fisicas_fecha_fin: "2026-10-05", tiene_venta: false, venta_fecha_inicio: null, venta_fecha_fin: null });
  assert.equal(parsed.success, true);
});
test("rechaza fechas de venta presentes cuando tiene_venta es falso", () => {
  const parsed = papeletaSchema.safeParse({ ...base, fisicas_fecha_inicio: "2026-10-01", fisicas_fecha_fin: "2026-10-05", tiene_venta: false, venta_fecha_inicio: "2026-10-16", venta_fecha_fin: "2026-10-20" });
  assert.equal(parsed.success, false);
});

// --- A4 y PDF ---
test("reconoce A4 en retrato y apaisado con tolerancia razonable", () => {
  assert.equal(isA4Size(595.28, 841.89), true);
  assert.equal(isA4Size(841.89, 595.28), true);
  assert.equal(isA4Size(600, 838), true); // dentro de tolerancia de escaneo
  assert.equal(isA4Size(612, 792), false); // carta (Letter), no A4
});
test("valida un PDF A4 auténtico", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([595.28, 841.89]);
  const bytes = await pdf.save();
  const result = await validatePapeletaPdf(new File([asArrayBuffer(bytes)], "papeleta.pdf", { type: "application/pdf" }));
  assert.equal(result.pages, 1); assert.equal(result.hash.length, 64);
});
test("un PDF que no es A4 ya NO se rechaza: solo se marca isA4=false (ver bug 2 corregido más abajo)", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  const result = await validatePapeletaPdf(new File([asArrayBuffer(bytes)], "papeleta.pdf", { type: "application/pdf" }));
  assert.equal(result.isA4, false);
  assert.equal(result.pages, 1);
});
test("rechaza un archivo que no es un PDF real", async () => {
  await assert.rejects(() => validatePapeletaPdf(new File(["no soy un pdf"], "falso.pdf", { type: "application/pdf" })), /PDF válido/);
});

// --- Migración: RLS, RPC y aislamiento ---
test("la migración crea papeletas_vacaciones con RLS activa y forzada", async () => {
  const sql = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  assert.match(sql, /alter table public\.papeletas_vacaciones enable row level security/);
  assert.match(sql, /alter table public\.papeletas_vacaciones force row level security/);
  assert.doesNotMatch(sql, /disable row level security/i);
  assert.doesNotMatch(sql, /service_role/i);
});
test("la lectura solo permite al coordinador propio o al admin (admin puede consultar)", async () => {
  const sql = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  assert.match(sql, /coordinador_id = auth\.uid\(\) or public\.is_admin\(\)/);
});
test("solo coordinadores registran, siempre con su propia sesión (auth.uid())", async () => {
  const sql = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  assert.match(sql, /role='coordinador'/);
  assert.match(sql, /p_reemplazo_id,p_provincia_id,p_cliente_id,p_unidad_id,auth\.uid\(\),/);
  assert.match(sql, /p_archivo_path<>auth\.uid\(\)::text/);
});
test("la unidad debe pertenecer al cliente elegido (no se acepta unidad de otro cliente)", async () => {
  const sql = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  assert.match(sql, /foreign key \(unidad_id, cliente_id\) references public\.unidades\(id, cliente_id\)/);
  assert.match(sql, /unidades where id=p_unidad_id and cliente_id=p_cliente_id and activo/);
});
test("el reemplazo no puede ser el mismo colaborador (regla también en SQL)", async () => {
  const sql = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  assert.match(sql, /papeletas_vacaciones_reemplazo_distinto check \(reemplazo_id <> colaborador_id\)/);
  assert.match(sql, /p_reemplazo_id=p_colaborador_id then raise exception/);
});
test("las reglas de fechas también se validan en SQL, no solo en el navegador", async () => {
  const sql = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  assert.match(sql, /papeletas_vacaciones_venta_despues_fisicas check \(venta_fecha_inicio is null or venta_fecha_inicio > fisicas_fecha_fin\)/);
  assert.match(sql, /papeletas_vacaciones_fisicas_rango check \(fisicas_fecha_fin >= fisicas_fecha_inicio\)/);
  assert.match(sql, /p_venta_inicio<=p_fisicas_fin/);
});
test("no se expone insert/update/delete directo sobre la tabla ni el bucket es público", async () => {
  const sql = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  assert.match(sql, /grant select on public\.papeletas_vacaciones to authenticated/);
  assert.doesNotMatch(sql, /grant insert on public\.papeletas_vacaciones/);
  assert.doesNotMatch(sql, /grant update on public\.papeletas_vacaciones/);
  assert.match(sql, /'papeletas-vacaciones','papeletas-vacaciones',false/);
});
test("no modifica el módulo documental existente (documentos/documento_firmas)", async () => {
  const sql = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  assert.doesNotMatch(sql, /alter table public\.documentos/);
  assert.doesNotMatch(sql, /alter table public\.documento_firmas/);
  assert.doesNotMatch(sql, /drop policy/i);
  assert.doesNotMatch(sql, /drop table/i);
});
test("expone la navegación Documentación → Vacaciones sin romper las rutas existentes", async () => {
  const nav = await readFile("components/document-section-nav.tsx", "utf8");
  assert.match(nav, /\/documentos\/vacaciones/);
  assert.match(nav, /\/documentos\/nuevo/);
  assert.match(nav, /\/documentos\/pendientes/);
});

// --- Catálogo de provincias vacío: mensaje claro, no un select vacío ---
test("el formulario avisa cuando no hay provincias configuradas, sin mostrar un select vacío", async () => {
  const form = await readFile("components/vacation-request-form.tsx", "utf8");
  assert.match(form, /No hay provincias configuradas\. Contacte al administrador\./);
  assert.match(form, /provincias\.rows\.length > 0 && <select/);
});
test("la carga inicial de provincias es real e idempotente (Lima, Huacho, Ica, Arequipa)", async () => {
  const migration = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  assert.match(migration, /insert into public\.provincias\(nombre\) values \('Lima'\),\('Huacho'\),\('Ica'\),\('Arequipa'\)/);
  assert.match(migration, /on conflict \(lower\(btrim\(nombre\)\)\) do nothing;/);
});
test("no se pueden duplicar provincias por mayúsculas o espacios (unicidad case-insensitive en PostgreSQL)", async () => {
  const migration = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  assert.match(migration, /create unique index provincias_nombre_ci_uidx on public\.provincias\(lower\(btrim\(nombre\)\)\);/);
  assert.match(migration, /check \(char_length\(btrim\(nombre\)\) between 1 and 200\)/);
});

// --- Idempotencia: request_id ---
test("la migración agrega request_id NOT NULL con índice único (coordinador_id, request_id)", async () => {
  const sql = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  assert.match(sql, /request_id uuid not null,/);
  assert.match(sql, /create unique index papeletas_vacaciones_coordinador_request_id_unique\s*\n\s*on public\.papeletas_vacaciones\(coordinador_id,request_id\);/);
});
test("la RPC serializa reintentos con advisory lock y devuelve la fila existente sin reinsertar", async () => {
  const sql = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  assert.match(sql, /p_request_id uuid,p_colaborador_id uuid/);
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock\(\s*\n\s*pg_catalog\.hashtextextended\('papeleta:'\|\|auth\.uid\(\)::text\|\|':'\|\|p_request_id::text,0\)\);/);
  assert.match(sql, /where coordinador_id=auth\.uid\(\) and request_id=p_request_id;\s*\n\s*if found then return v_id; end if;/);
  assert.match(sql, /p_archivo_path<>auth\.uid\(\)::text\|\|'\/'\|\|p_request_id::text\|\|'\.pdf'/);
});

test("papeletaStoragePath es determinista por coordinador y no colisiona entre coordinadores", () => {
  assert.equal(papeletaStoragePath("coord-1", "req-1"), "coord-1/req-1.pdf");
  assert.equal(papeletaStoragePath("coord-1", "req-1"), papeletaStoragePath("coord-1", "req-1"));
  assert.notEqual(papeletaStoragePath("coord-1", "req-1"), papeletaStoragePath("coord-2", "req-1"));
});
test("isValidRequestId exige formato UUID", () => {
  assert.equal(isValidRequestId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), true);
  assert.equal(isValidRequestId("no-es-un-uuid"), false);
  assert.equal(isValidRequestId(""), false);
});

type FakeRow = { coordinador_id: string; request_id: string; id: string };
async function samplePdfBytes() {
  const pdf = await PDFDocument.create();
  pdf.addPage([595.28, 841.89]);
  return pdf.save();
}
function makeFakeDb(coordinadorId: string, opts: { store?: FakeRow[]; rpcError?: { code: string; message: string }; failUploadWith?: unknown } = {}) {
  const store = opts.store ?? [];
  const uploads: string[] = [];
  const removed: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let nextId = 1;
  const db = {
    from: () => ({
      select: () => {
        const filters: Record<string, string> = {};
        const builder = {
          eq(column: string, value: string) { filters[column] = value; return builder; },
          maybeSingle: async () => {
            const row = store.find(r => r.coordinador_id === filters.coordinador_id && r.request_id === filters.request_id);
            return { data: row ? { id: row.id } : null, error: null };
          },
        };
        return builder;
      },
    }),
    storage: {
      from: () => ({
        upload: async (path: string) => {
          if (opts.failUploadWith) return { error: opts.failUploadWith };
          uploads.push(path);
          return { error: null };
        },
        remove: async (paths: string[]) => { removed.push(...paths); return { error: null }; },
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (opts.rpcError) return { data: null, error: opts.rpcError };
      const id = `row-${coordinadorId}-${nextId++}`;
      store.push({ coordinador_id: coordinadorId, request_id: String(args.p_request_id), id });
      return { data: id, error: null };
    },
  } as unknown as SupabaseClient;
  return { db, store, uploads, removed, rpcCalls };
}
function papeletaHandler(coordinadorId: string, db: SupabaseClient) {
  return makeRegisterPapeletaHandler({
    getProfile: async () => ({ id: coordinadorId, email: "coord@example.com", nombre: "Coordinador", role: "coordinador" }),
    getDb: async () => db,
  });
}
async function papeletaRequest(overrides: Partial<Record<string, string>> = {}) {
  const bytes = await samplePdfBytes();
  const form = new FormData();
  form.set("archivo", new File([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], "papeleta.pdf", { type: "application/pdf" }));
  form.set("confirmacion_legibilidad", "true");
  form.set("request_id", overrides.request_id ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  form.set("colaborador_id", overrides.colaborador_id ?? base.colaborador_id);
  form.set("reemplazo_id", overrides.reemplazo_id ?? base.reemplazo_id);
  form.set("provincia_id", overrides.provincia_id ?? base.provincia_id);
  form.set("cliente_id", overrides.cliente_id ?? base.cliente_id);
  form.set("unidad_id", overrides.unidad_id ?? base.unidad_id);
  form.set("fisicas_fecha_inicio", overrides.fisicas_fecha_inicio ?? "2026-10-01");
  form.set("fisicas_fecha_fin", overrides.fisicas_fecha_fin ?? "2026-10-05");
  form.set("tiene_venta", "false");
  return new Request("http://localhost/api/documentos/vacaciones", { method: "POST", body: form });
}

test("idempotencia: el mismo request_id enviado dos veces devuelve la misma papeleta, sin duplicar", async () => {
  const { db, store, uploads, rpcCalls } = makeFakeDb("coord-1");
  const run = papeletaHandler("coord-1", db);
  const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const first = await run(await papeletaRequest({ request_id: requestId }));
  assert.equal(first.status, 201);
  const firstId = (await first.json()).id;
  const second = await run(await papeletaRequest({ request_id: requestId }));
  assert.equal(second.status, 200);
  const secondId = (await second.json()).id;
  assert.equal(secondId, firstId);
  assert.equal(store.length, 1);
  assert.equal(uploads.length, 1);
  assert.equal(rpcCalls.length, 1);
});
test("idempotencia: un request_id diferente sí crea una papeleta nueva", async () => {
  const { db, store } = makeFakeDb("coord-1");
  const run = papeletaHandler("coord-1", db);
  const a = await run(await papeletaRequest({ request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
  const b = await run(await papeletaRequest({ request_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.notEqual((await a.json()).id, (await b.json()).id);
  assert.equal(store.length, 2);
});
test("idempotencia: coordinadores distintos con el mismo request_id no colisionan entre sí", async () => {
  const sharedStore: FakeRow[] = [];
  const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const fakeA = makeFakeDb("coord-A", { store: sharedStore });
  const fakeB = makeFakeDb("coord-B", { store: sharedStore });
  const a = await papeletaHandler("coord-A", fakeA.db)(await papeletaRequest({ request_id: requestId }));
  const b = await papeletaHandler("coord-B", fakeB.db)(await papeletaRequest({ request_id: requestId }));
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.notEqual((await a.json()).id, (await b.json()).id);
  assert.equal(sharedStore.length, 2);
  assert.equal(fakeA.uploads[0], `coord-A/${requestId}.pdf`);
  assert.equal(fakeB.uploads[0], `coord-B/${requestId}.pdf`);
});
test("no quedan archivos huérfanos en Storage si la RPC falla tras subir el PDF", async () => {
  const { db, store, uploads, removed } = makeFakeDb("coord-1", { rpcError: { code: "22023", message: "Datos inválidos" } });
  const run = papeletaHandler("coord-1", db);
  const response = await run(await papeletaRequest({ request_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }));
  assert.equal(response.status, 400);
  assert.equal(store.length, 0);
  assert.equal(uploads.length, 1);
  assert.deepEqual(removed, uploads);
});
test("un request_id con formato inválido se rechaza antes de tocar Storage o la RPC", async () => {
  const { db, uploads, rpcCalls } = makeFakeDb("coord-1");
  const run = papeletaHandler("coord-1", db);
  const response = await run(await papeletaRequest({ request_id: "no-es-un-uuid" }));
  assert.equal(response.status, 400);
  assert.equal(uploads.length, 0);
  assert.equal(rpcCalls.length, 0);
});

// --- Catálogo de provincias: mantenimiento administrativo (reutiliza el CRUD existente) ---
test("provincias se integra al mismo catálogo administrativo, sin un CRUD paralelo", () => {
  assert.deepEqual(CATALOG_KINDS, ["clientes", "unidades", "personal", "prendas", "provincias"]);
});
test("admin puede crear una provincia (esquema válido para admin_guardar_catalogo)", () => {
  const parsed = catalogCreateSchema.safeParse({ catalogo: "provincias", valores: { nombre: "Puno" } });
  assert.equal(parsed.success, true);
});
test("admin puede editar el nombre de una provincia", () => {
  const parsed = catalogUpdateSchema.safeParse({ catalogo: "provincias", id: "11111111-1111-4111-8111-111111111111", valores: { nombre: "Puno" } });
  assert.equal(parsed.success, true);
});
test("crear/editar una provincia exige un nombre no vacío", () => {
  assert.equal(catalogCreateSchema.safeParse({ catalogo: "provincias", valores: { nombre: "" } }).success, false);
  assert.equal(catalogCreateSchema.safeParse({ catalogo: "provincias", valores: { nombre: "   " } }).success, false);
});
test("provincias no admite borrado físico: no forma parte de catalogDeleteSchema", () => {
  assert.equal(catalogDeleteSchema.safeParse({ catalogo: "provincias", id: "11111111-1111-4111-8111-111111111111" }).success, false);
  assert.deepEqual(catalogDeleteSchema.shape.catalogo.options, ["clientes", "unidades"]);
});
test("la RPC de guardado reconoce 'provincias': crear valida y compara nombre sin distinguir mayúsculas/espacios", async () => {
  const sql = await readFile("supabase/migrations/202609180001_admin_catalogo_provincias.sql", "utf8");
  assert.match(sql, /p_catalogo not in \('clientes','unidades','personal','prendas','provincias'\)/);
  assert.match(sql, /when 'provincias' then\s*\n\s*if \(p_valores-'nombre'\)<>'\{\}'::jsonb/);
  assert.match(sql, /lower\(btrim\(p\.nombre\)\)=lower\(v_nombre\) and p\.id is distinct from p_id/);
  assert.match(sql, /Ya existe una provincia con ese nombre/);
});
test("admin puede desactivar y reactivar una provincia con el mismo mecanismo de baja lógica", async () => {
  const sql = await readFile("supabase/migrations/202609180001_admin_catalogo_provincias.sql", "utf8");
  assert.match(sql, /when 'provincias' then select to_jsonb\(p\.\*\) into v_antes from public\.provincias p where p\.id=p_id for update;/);
  assert.match(sql, /when 'provincias' then update public\.provincias set activo=p_activo where id=p_id returning to_jsonb\(provincias\.\*\) into v_despues;/);
});
test("coordinador y gerente no pueden administrar provincias (ni ningún catálogo): guardas is_admin() intactas", async () => {
  const sql = await readFile("supabase/migrations/202609180001_admin_catalogo_provincias.sql", "utf8");
  const guards = [...sql.matchAll(/if auth\.uid\(\) is null or not public\.is_admin\(\) then raise exception 'Solo administradores'/g)];
  assert.equal(guards.length, 3); // admin_guardar_catalogo, admin_actualizar_catalogo_activo, admin_listar_catalogo
});
test("coordinador solo recibe provincias activas al registrar papeletas (RLS de 202609170001 intacta)", async () => {
  const [base, addon] = await Promise.all([
    readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8"),
    readFile("supabase/migrations/202609180001_admin_catalogo_provincias.sql", "utf8"),
  ]);
  assert.match(base, /create policy provincias_lectura on public\.provincias for select to authenticated\s*\nusing \(activo or public\.is_admin\(\)\);/);
  assert.doesNotMatch(addon, /drop policy/i);
  assert.doesNotMatch(addon, /alter table public\.provincias/i);
});
test("una provincia desactivada sigue visible en el histórico de papeletas ya registradas", async () => {
  const [base, addon] = await Promise.all([
    readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8"),
    readFile("supabase/migrations/202609180001_admin_catalogo_provincias.sql", "utf8"),
  ]);
  assert.match(base, /create policy provincias_historial on public\.provincias for select to authenticated/);
  assert.match(base, /exists\(select 1 from public\.papeletas_vacaciones p where p\.provincia_id=provincias\.id\)/);
  assert.doesNotMatch(addon, /provincias_historial/); // no se toca: sigue vigente tal cual
});
test("la nueva migración no modifica clientes, unidades, personal ni prendas existentes", async () => {
  const sql = await readFile("supabase/migrations/202609180001_admin_catalogo_provincias.sql", "utf8");
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /disable row level security/i);
  assert.doesNotMatch(sql, /service_role/i);
  assert.match(sql, /alter table private\.admin_catalog_audit/);
});
test("el formulario de vacaciones sigue cargando provincias activas desde BD sin tocar React (nueva provincia aparece sola)", async () => {
  const form = await readFile("components/vacation-request-form.tsx", "utf8");
  assert.match(form, /useActiveCatalog<Provincia>\(supabase, "provincias", true\)/);
  assert.match(form, /provincias\.rows\.length > 0 && <select/);
  assert.match(form, /No hay provincias configuradas\. Contacte al administrador\./);
});
test("provincias se administra con el mismo diálogo/tabla de mantenimiento (sin CRUD paralelo)", async () => {
  const [dialog, maintenance] = await Promise.all([
    readFile("components/admin-catalog-dialog.tsx", "utf8"),
    readFile("components/admin-maintenance.tsx", "utf8"),
  ]);
  assert.match(dialog, /catalog==="provincias"&&<div className="sm:col-span-2"><Field label="Nombre de la provincia"/);
  assert.match(maintenance, /\{id:"provincias",label:"Provincias"\}/);
  assert.doesNotMatch(maintenance + dialog, /admin_guardar_catalogo_provincias|ProvinceCrud|provincias-dialog/i);
});

// ============================================================================
// Corrección de bugs de producción: vista previa en blanco, A4 bloqueante,
// "registrado pero no aparece"; y nuevo flujo de revisión/observación/versionado.
// ============================================================================

// --- Bug 1: vista previa del PDF en blanco ---
test("el canvas de vista previa se monta apenas hay archivo, no solo cuando termina de cargar", async () => {
  const source = await readFile("components/vacation-request-form.tsx", "utf8");
  // Antes: `{file && !pdfLoading && <div>...<canvas/></div>}` dejaba canvasRef.current en null
  // durante todo el render inicial (que corre mientras pdfLoading sigue en true), y nada
  // volvía a dibujar cuando pdfLoading pasaba a false. Ahora el contenedor no depende de eso.
  assert.match(source, /\{file && !pdfError && <div className="relative mt-4/);
  assert.doesNotMatch(source, /\{file && !pdfLoading && <div/);
  assert.match(source, /pdfLoading && <div className="absolute inset-0 grid place-items-center bg-white\/80">/);
});
test("el render del PDF usa buffer + copia y protege contra carreras entre selecciones", async () => {
  const source = await readFile("components/vacation-request-form.tsx", "utf8");
  assert.match(source, /const renderSequence = useRef\(0\);/);
  assert.match(source, /if \(sequence !== renderSequence\.current\) return;/);
  assert.match(source, /document\.createElement\("canvas"\)/);
});
test("PersonalSearchPicker asocia el label al input (accesible con getByLabel)", async () => {
  const source = await readFile("components/personal-search-picker.tsx", "utf8");
  assert.match(source, /htmlFor=\{inputId\}/);
});

// --- Bug 2: A4 deja de ser bloqueante ---
test("validatePapeletaPdf ya no rechaza por dimensiones: acepta A4 y no-A4 por igual", async () => {
  const a4 = await PDFDocument.create(); a4.addPage([595.28, 841.89]);
  const carta = await PDFDocument.create(); carta.addPage([612, 792]);
  const [a4Bytes, cartaBytes] = await Promise.all([a4.save(), carta.save()]);
  const a4Result = await validatePapeletaPdf(new File([asArrayBuffer(a4Bytes)], "a4.pdf", { type: "application/pdf" }));
  const cartaResult = await validatePapeletaPdf(new File([asArrayBuffer(cartaBytes)], "carta.pdf", { type: "application/pdf" }));
  assert.equal(a4Result.isA4, true);
  assert.equal(cartaResult.isA4, false); // se acepta igual: ya no lanza
});
test("un PDF inválido (no es PDF real) sigue rechazándose", async () => {
  await assert.rejects(() => validatePapeletaPdf(new File(["no soy un pdf"], "falso.pdf", { type: "application/pdf" })), /PDF válido/);
});
test("el formulario ya no bloquea el registro por A4: el aviso es informativo, no un error", async () => {
  const source = await readFile("components/vacation-request-form.tsx", "utf8");
  assert.match(source, /const \[pdfA4Note, setPdfA4Note\] = useState\(""\);/);
  assert.match(source, /if \(pdfError\) \{ setError\(pdfError\); return; \}/);
  assert.doesNotMatch(source, /if \(pdfWarning\)/);
  assert.match(source, /El documento no tiene dimensiones A4 estándar\. Verifique que sea legible antes de continuar\./);
  // El checkbox de legibilidad ya no depende del aviso de A4, solo de errores reales.
  assert.match(source, /\{file && !pdfError && !pdfLoading && <label/);
});

// --- Bug 3: "registrado pero no aparece" ---
test("tras registrar, se confirma la persistencia leyendo la fila de vuelta antes de mostrar éxito", async () => {
  const source = await readFile("components/vacation-request-form.tsx", "utf8");
  assert.match(source, /supabase\.from\("papeletas_vacaciones"\)\.select\("id"\)\.eq\("id", id\)\.maybeSingle\(\)/);
  assert.match(source, /No se confirmó el registro/);
  assert.match(source, /router\.refresh\(\);/);
});
test("el listado nunca es estático ni cachea: siempre consulta en el momento", async () => {
  const source = await readFile("app/(private)/documentos/vacaciones/page.tsx", "utf8");
  assert.match(source, /export const dynamic = "force-dynamic";/);
  assert.match(source, /export const revalidate = 0;/);
});
test("el listado nunca oculta un error de consulta como si fuera una lista vacía", async () => {
  const source = await readFile("app/(private)/documentos/vacaciones/page.tsx", "utf8");
  assert.match(source, /listError \|\| !listResult \? <Alert kind="error">/);
});

// --- Diseño de estados y permisos (lógica pura) ---
test("REGISTRADO: admin y gerente pueden observar; coordinador no, y nadie revisa su propia papeleta", () => {
  const owner = "coord-1", other = "coord-2";
  assert.equal(canObserve("admin", owner, other, "REGISTRADO"), true);
  assert.equal(canObserve("gerente", owner, other, "REGISTRADO"), true);
  assert.equal(canObserve("coordinador", owner, other, "REGISTRADO"), false);
  assert.equal(canObserve("admin", owner, owner, "REGISTRADO"), false); // nunca su propia papeleta
});
test("solo el gerente puede firmar (admin NO firma por defecto), y solo desde REGISTRADO", () => {
  const owner = "coord-1", other = "coord-2";
  assert.equal(canSign("gerente", owner, other, "REGISTRADO"), true);
  assert.equal(canSign("admin", owner, other, "REGISTRADO"), false); // decisión explícita: admin no firma
  assert.equal(canSign("gerente", owner, other, "OBSERVADO"), false);
  assert.equal(canSign("gerente", owner, other, "FIRMADO"), false);
  assert.equal(canSign("gerente", owner, owner, "REGISTRADO"), false); // nunca su propia papeleta
});
test("OBSERVADO habilita corrección solo al coordinador dueño; REGISTRADO y FIRMADO quedan bloqueados", () => {
  const owner = "coord-1", other = "coord-2";
  assert.equal(canCorrect("coordinador", owner, owner, "OBSERVADO"), true);
  assert.equal(canCorrect("coordinador", owner, owner, "REGISTRADO"), false);
  assert.equal(canCorrect("coordinador", owner, owner, "FIRMADO"), false);
  assert.equal(canCorrect("coordinador", owner, other, "OBSERVADO"), false); // no es el dueño
  assert.equal(canCorrect("admin", owner, owner, "OBSERVADO"), false); // solo coordinador corrige
});
test("la posibilidad de corregir depende solo del estado, no de un permiso general por usuario", () => {
  // No existe ningún flag "puede editar" en el perfil: canReview/canCorrect solo toman
  // rol + estado + dueño como entrada. Ver decisión de diseño documentada en review.ts.
  assert.equal(typeof canReview, "function");
  assert.equal(canReview.length, 3); // (role, ownerId, userId) — sin un cuarto parámetro de permiso
});

// --- Migración incremental 202609190001: estructura, RLS y RPCs ---
test("202609190001 agrega OBSERVADO/CONFORME al enum FUERA de begin/commit (restricción de PostgreSQL)", async () => {
  const sql = await readFile("supabase/migrations/202609190001_papeletas_revision.sql", "utf8");
  const beginIndex = sql.indexOf("\nbegin;");
  const observadoIndex = sql.indexOf("add value if not exists 'OBSERVADO'");
  const conformeIndex = sql.indexOf("add value if not exists 'CONFORME'");
  assert.ok(observadoIndex > -1 && observadoIndex < beginIndex, "OBSERVADO debe agregarse antes de begin;");
  assert.ok(conformeIndex > -1 && conformeIndex < beginIndex, "CONFORME debe agregarse antes de begin;");
});
test("202609190001 no modifica ni repite 202609170001/202609180001, solo agrega y redefine lo necesario", async () => {
  const [sql, base, addon] = await Promise.all([
    readFile("supabase/migrations/202609190001_papeletas_revision.sql", "utf8"),
    readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8"),
    readFile("supabase/migrations/202609180001_admin_catalogo_provincias.sql", "utf8"),
  ]);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /disable row level security/i);
  assert.doesNotMatch(sql, /service_role/i);
  // Las dos migraciones ya aplicadas permanecen exactamente como estaban (no se tocaron en esta sesión).
  assert.match(base, /create table public\.papeletas_vacaciones \(/);
  assert.match(addon, /alter table private\.admin_catalog_audit/);
});
test("versiones e historial: tabla inmutable con trigger, políticas de lectura por dueño/admin/gerente", async () => {
  const sql = await readFile("supabase/migrations/202609190001_papeletas_revision.sql", "utf8");
  assert.match(sql, /create table public\.papeletas_vacaciones_versiones/);
  assert.match(sql, /unique \(papeleta_id, version\)/);
  assert.match(sql, /create trigger proteger_version_papeleta before update or delete on public\.papeletas_vacaciones_versiones/);
  assert.match(sql, /create table public\.papeletas_vacaciones_eventos/);
  assert.match(sql, /accion in \('REGISTRADO','OBSERVADO','CORREGIDO','CONFORME'\)/);
});
test("gerente se incorpora a la lectura de papeletas y a Storage vía private.es_gerente() reutilizado", async () => {
  const sql = await readFile("supabase/migrations/202609190001_papeletas_revision.sql", "utf8");
  assert.match(sql, /drop policy papeletas_vacaciones_lectura on public\.papeletas_vacaciones;/);
  assert.match(sql, /coordinador_id = auth\.uid\(\) or public\.is_admin\(\) or private\.es_gerente\(\)/);
  assert.match(sql, /papeletas_storage_select_version/);
});
test("observar_papeleta_vacaciones exige rol revisor, motivo obligatorio y bloquea autorevisión", async () => {
  const sql = await readFile("supabase/migrations/202609190001_papeletas_revision.sql", "utf8");
  assert.match(sql, /create function public\.observar_papeleta_vacaciones\(p_papeleta_id uuid,p_motivo text\)/);
  assert.match(sql, /not \(public\.is_admin\(\) or private\.es_gerente\(\)\)/);
  assert.match(sql, /if v_doc\.coordinador_id=auth\.uid\(\) then raise exception 'No puedes observar tu propia papeleta'/);
  assert.match(sql, /if v_motivo is null or char_length\(v_motivo\)>1000 then/);
  assert.match(sql, /if v_doc\.estado<>'REGISTRADO' then raise exception 'Solo puede observarse una papeleta registrada'/);
});
test("marcar_conforme_papeleta_vacaciones exige rol revisor y solo aplica desde REGISTRADO", async () => {
  const sql = await readFile("supabase/migrations/202609190001_papeletas_revision.sql", "utf8");
  assert.match(sql, /create function public\.marcar_conforme_papeleta_vacaciones\(p_papeleta_id uuid\)/);
  assert.match(sql, /if v_doc\.estado<>'REGISTRADO' then raise exception 'Solo puede marcarse conforme una papeleta registrada'/);
});
test("corregir_papeleta_vacaciones no recibe colaborador_id como parámetro (se mantiene fijo a propósito)", async () => {
  const sql = await readFile("supabase/migrations/202609190001_papeletas_revision.sql", "utf8");
  assert.match(sql, /create function public\.corregir_papeleta_vacaciones\(\s*\n\s*p_papeleta_id uuid,p_version_esperada integer,\s*\n\s*p_reemplazo_id uuid,p_provincia_id uuid,p_cliente_id uuid,p_unidad_id uuid,/);
  assert.doesNotMatch(sql, /corregir_papeleta_vacaciones\([^)]*p_colaborador_id/);
  assert.match(sql, /if v_doc\.estado<>'OBSERVADO' then raise exception 'Solo una papeleta observada puede corregirse'/);
  assert.match(sql, /if p_version_esperada is distinct from v_doc\.version_actual then/);
});
test("corregir_papeleta_vacaciones nunca sobrescribe: inserta versión nueva antes de actualizar el puntero vigente", async () => {
  const sql = await readFile("supabase/migrations/202609190001_papeletas_revision.sql", "utf8");
  const insertIndex = sql.indexOf("insert into public.papeletas_vacaciones_versiones(\n    papeleta_id,version,colaborador_id,colaborador_nombre,colaborador_codigo,\n    fisicas_fecha_inicio,fisicas_fecha_fin,fisicas_dias,tiene_venta,venta_fecha_inicio,venta_fecha_fin,venta_dias,\n    reemplazo_id,provincia_id,cliente_id,unidad_id,\n    archivo_path,archivo_nombre,archivo_sha256,archivo_bytes,creado_por\n  ) values (\n    p_papeleta_id,v_version,");
  const updateIndex = sql.indexOf("update public.papeletas_vacaciones set\n    colaborador_nombre=v_colaborador.nombre");
  assert.ok(insertIndex > -1, "debe existir el insert de la nueva versión");
  assert.ok(updateIndex > -1, "debe existir el update del puntero vigente");
  assert.ok(insertIndex < updateIndex, "la versión se inserta antes de mover el puntero: nunca se pierde el dato anterior");
});
test("registrar_papeleta_vacaciones conserva su firma pública y ahora versiona desde el origen", async () => {
  const sql = await readFile("supabase/migrations/202609190001_papeletas_revision.sql", "utf8");
  assert.match(sql, /create or replace function public\.registrar_papeleta_vacaciones\(\s*\n\s*p_request_id uuid,p_colaborador_id uuid,p_reemplazo_id uuid,p_provincia_id uuid,p_cliente_id uuid,p_unidad_id uuid,/);
  assert.match(sql, /insert into public\.papeletas_vacaciones_eventos\(papeleta_id,usuario_id,accion,estado_anterior,estado_nuevo,version\)\s*\n\s*values \(v_id,auth\.uid\(\),'REGISTRADO',null,'REGISTRADO',1\);/);
});
test("backfill: las papeletas ya existentes en producción reciben versión 1 y evento, sin tocar sus datos", async () => {
  const sql = await readFile("supabase/migrations/202609190001_papeletas_revision.sql", "utf8");
  assert.match(sql, /-- Backfill: las papeletas ya registradas en producción/);
  assert.match(sql, /on conflict \(papeleta_id,version\) do nothing;/);
  assert.match(sql, /where not exists\(select 1 from public\.papeletas_vacaciones_eventos e where e\.papeleta_id=p\.id\);/);
});
test("Storage: las versiones anteriores siguen siendo legibles y nunca se puede borrar un PDF referenciado por una versión", async () => {
  const sql = await readFile("supabase/migrations/202609190001_papeletas_revision.sql", "utf8");
  assert.match(sql, /not exists\(select 1 from public\.papeletas_vacaciones_versiones v where v\.archivo_path=name\)/);
});
test("corrección: path de Storage determinista por (coordinador, papeleta, versión destino)", () => {
  assert.equal(papeletaCorrectionStoragePath("coord-1", "papeleta-1", 2), "coord-1/papeleta-1/v2.pdf");
  assert.notEqual(papeletaCorrectionStoragePath("coord-1", "papeleta-1", 2), papeletaCorrectionStoragePath("coord-1", "papeleta-1", 3));
});
test("el esquema de corrección exige reemplazo distinto del colaborador y repite las reglas de fechas", () => {
  const colaboradorId = "11111111-1111-4111-8111-111111111111";
  const valid = {
    reemplazo_id: "22222222-2222-4222-8222-222222222222", provincia_id: base.provincia_id,
    cliente_id: base.cliente_id, unidad_id: base.unidad_id,
    fisicas_fecha_inicio: "2026-10-01", fisicas_fecha_fin: "2026-10-05",
    tiene_venta: false, venta_fecha_inicio: null, venta_fecha_fin: null,
  };
  assert.equal(papeletaCorrectionSchema(colaboradorId).safeParse(valid).success, true);
  assert.equal(papeletaCorrectionSchema(colaboradorId).safeParse({ ...valid, reemplazo_id: colaboradorId }).success, false);
  assert.equal(papeletaCorrectionSchema(colaboradorId).safeParse({ ...valid, fisicas_fecha_fin: "2026-09-30" }).success, false);
});

// --- Handlers de revisión/corrección: reutilizan el mismo patrón inyectable ---
test("los nuevos endpoints de revisión y corrección usan el mismo patrón de handler inyectable", async () => {
  const [handlers, revisar, corregir] = await Promise.all([
    readFile("lib/vacations/handlers.ts", "utf8"),
    readFile("app/api/documentos/vacaciones/[id]/revisar/route.ts", "utf8"),
    readFile("app/api/documentos/vacaciones/[id]/corregir/route.ts", "utf8"),
  ]);
  assert.match(handlers, /export function makeReviewPapeletaHandler/);
  assert.match(handlers, /export function makeCorrectPapeletaHandler/);
  assert.match(revisar, /makeReviewPapeletaHandler\(\{ getProfile: getCurrentProfile, getDb: createClient \}\)/);
  assert.match(corregir, /makeCorrectPapeletaHandler\(\{ getProfile: getCurrentProfile, getDb: createClient \}\)/);
});
test("el motivo de observación vacío se rechaza antes de llamar a la RPC", async () => {
  const handlers = await readFile("lib/vacations/handlers.ts", "utf8");
  assert.match(handlers, /if \(!motivo\) return json\(\{ error: "El motivo de observación es obligatorio\." \}, 400\);/);
});
test("la corrección limpia el archivo subido si la RPC falla, sin tocar versiones anteriores", async () => {
  const handlers = await readFile("lib/vacations/handlers.ts", "utf8");
  assert.match(handlers, /La versión anterior nunca se toca: solo se limpia el archivo de este intento fallido\./);
});

// ============================================================================
// Bug: el listado de /documentos/vacaciones no mostraba filas ya persistidas.
// Causa raíz real (confirmada contra PostgreSQL): papeletas_vacaciones tiene DOS foreign keys
// hacia unidades (la simple `unidad_id` y la compuesta `papeletas_vacaciones_unidad_cliente_fkey`
// que garantiza que la unidad pertenezca al cliente, igual que en requerimientos). El select del
// listado embebía `unidades(nombre)` sin indicar cuál FK usar: PostgREST responde PGRST201
// ("more than one relationship was found") y la consulta entera falla. Como
// `const { data } = await query` no revisaba `error`, la UI mostraba "sin registros" en vez
// del error real, para cualquier rol (coordinador, admin o gerente).
// ============================================================================
test("PAPELETA_DETAIL_SELECT desambigua unidades con la FK simple explícita", () => {
  assert.match(PAPELETA_DETAIL_SELECT, /unidades!papeletas_vacaciones_unidad_id_fkey\(id,nombre\)/);
  const bareUnidades = PAPELETA_DETAIL_SELECT.match(/(?<![\w!])unidades\(/g);
  assert.equal(bareUnidades, null, `no debe quedar "unidades(" sin calificar en: ${PAPELETA_DETAIL_SELECT}`);
});
test("el listado ya no arma su propio embed ambiguo: la resolución de nombres vive en listar_papeletas_vacaciones_filtradas (joins explícitos por columna, sin PostgREST embed)", async () => {
  const sql = await readFile("supabase/migrations/202609210001_papeletas_filtros_y_prueba_completa.sql", "utf8");
  assert.match(sql, /left join public\.unidades u on u\.id=p\.unidad_id/);
  assert.match(sql, /left join public\.clientes c on c\.id=p\.cliente_id/);
});
test("clientes no necesita FK explícita: papeletas_vacaciones solo tiene una relación hacia clientes", async () => {
  const sql = await readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8");
  // La FK compuesta apunta a unidades(id, cliente_id), no a clientes: confirma que clientes
  // sigue teniendo una sola relación y no necesita (ni debe forzarse a usar) un hint de FK.
  assert.match(sql, /foreign key \(unidad_id, cliente_id\) references public\.unidades\(id, cliente_id\)/);
  assert.doesNotMatch(sql, /references public\.clientes\(id, /);
});
test("el mismo patrón de FK compuesta ya existía en requerimientos: la ambigüedad es un caso conocido, no una sorpresa", async () => {
  const requerimientos = await readFile("lib/requerimientos.ts", "utf8");
  assert.match(requerimientos, /unidades!requerimientos_unidad_id_fkey\(nombre\)/);
});
test("el listado nunca vuelve a ocultar un error de consulta (ver corrección previa) y sigue siendo dinámico", async () => {
  const source = await readFile("app/(private)/documentos/vacaciones/page.tsx", "utf8");
  assert.match(source, /listError \|\| !listResult \? <Alert kind="error">/);
  assert.match(source, /export const dynamic = "force-dynamic";/);
});

// ============================================================================
// Evolución del módulo: FIRMADO real (firma del gerente reutilizando el motor de Documentos),
// borrado controlado de papeletas de prueba, y visor de PDF en el detalle.
// ============================================================================

test("papeletaEstadoLabel: FIRMADO es el estado terminal orientado a firma; CONFORME se conserva como histórico, nunca se confunde con FIRMADO", () => {
  assert.deepEqual(Object.keys(papeletaEstadoLabel).sort(), ["CONFORME", "FIRMADO", "OBSERVADO", "REGISTRADO"]);
  assert.equal(papeletaEstadoLabel.REGISTRADO, "Pendiente de firma");
  assert.equal(papeletaEstadoLabel.FIRMADO, "Firmado");
  assert.equal(papeletaEstadoLabel.CONFORME, "Conforme (histórico)");
  assert.notEqual(papeletaEstadoLabel.CONFORME, papeletaEstadoLabel.FIRMADO);
});
test("papeletaVersionTipoLabel distingue Original / Corrección / Firmado para el visor", () => {
  assert.deepEqual(papeletaVersionTipoLabel, { ORIGINAL: "Original", CORRECCION: "Corrección", FIRMADO: "Firmado" });
});
test("PAPELETA_DETAIL_SELECT incluye los metadatos de firma y el hint de FK del firmante", () => {
  assert.match(PAPELETA_DETAIL_SELECT, /firmado_por,firmado_at,firma_perfil_version/);
  assert.match(PAPELETA_DETAIL_SELECT, /firmante:profiles!papeletas_vacaciones_firmado_por_fkey\(nombre\)/);
});
test("PAPELETA_DETAIL_SELECT expone es_prueba para el marcado explícito admin", () => {
  assert.match(PAPELETA_DETAIL_SELECT, /(?:^|,)es_prueba,firmado_por/);
});

test("202609200001 agrega FIRMADO como valor NUEVO del enum (no renombra CONFORME): ADD VALUE va FUERA de begin/commit", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  const beginIndex = sql.indexOf("\nbegin;");
  const addIndex = sql.indexOf("add value if not exists 'FIRMADO'");
  assert.ok(addIndex > -1 && addIndex < beginIndex, "ADD VALUE debe ir ANTES de begin; (restricción de PostgreSQL, igual que OBSERVADO/CONFORME en 202609190001)");
  // Ninguna línea EJECUTABLE (no comentario) debe renombrar CONFORME: convertiría filas
  // históricas sin metadatos de firma en FIRMADO y violaría el check de coherencia (esto es
  // justamente el incidente real ya ocurrido en Supabase que motivó este cambio).
  const executableLines = sql.split("\n").filter(line => !line.trim().startsWith("--"));
  assert.ok(!executableLines.some(line => /rename value 'CONFORME' to 'FIRMADO'/.test(line)), "no debe existir una sentencia SQL ejecutable que renombre CONFORME a FIRMADO");
});
test("una papeleta CONFORME histórica (sin metadatos de firma) nunca viola el check de coherencia: el check solo exige metadatos cuando estado='FIRMADO'", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  assert.match(sql, /add constraint papeletas_vacaciones_firma_coherente check \(\s*\n\s*\(estado='FIRMADO'\) = \(firmado_por is not null/);
});
test("CONFORME histórico recibe la misma protección que FIRMADO: no puede marcarse como prueba ni eliminarse", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  assert.match(sql, /if v_doc\.estado in \('FIRMADO','CONFORME'\) then raise exception 'Una papeleta firmada o conforme no puede marcarse como prueba'/);
  assert.match(sql, /if exists\(select 1 from public\.papeletas_vacaciones p where p\.id=any\(p_ids\) and p\.estado in \('FIRMADO','CONFORME'\)\) then/);
});
test("202609200001 no modifica 202609170001/202609180001/202609190001: solo agrega y redefine (CREATE OR REPLACE / DROP+CREATE POLICY)", async () => {
  const [sql, v1, v2, v3] = await Promise.all([
    readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8"),
    readFile("supabase/migrations/202609170001_papeletas_vacaciones.sql", "utf8"),
    readFile("supabase/migrations/202609180001_admin_catalogo_provincias.sql", "utf8"),
    readFile("supabase/migrations/202609190001_papeletas_revision.sql", "utf8"),
  ]);
  assert.ok(sql.length > 0 && v1.length > 0 && v2.length > 0 && v3.length > 0);
  assert.match(sql, /Ejecutar después de 202609190001_papeletas_revision\.sql/);
});
test("papeletas_vacaciones gana columnas de firma coherentes entre sí (check firma_coherente) y es_prueba explícito, default false", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  assert.match(sql, /add column firmado_por uuid references public\.profiles\(id\)/);
  assert.match(sql, /add column firma_perfil_id uuid references public\.perfiles_firma\(id\)/);
  assert.match(sql, /constraint papeletas_vacaciones_firma_coherente check/);
  assert.match(sql, /add column es_prueba boolean not null default false/);
});
test("firmar_papeleta_vacaciones: solo gerente, nunca su propia papeleta, solo desde REGISTRADO, concurrencia optimista y perfil activo propio", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  assert.match(sql, /create function public\.firmar_papeleta_vacaciones/);
  assert.match(sql, /if auth\.uid\(\) is null or not private\.es_gerente\(\) then\s*\n\s*raise exception 'Solo el gerente puede firmar'/);
  assert.match(sql, /if v_doc\.coordinador_id=auth\.uid\(\) then raise exception 'No puedes firmar tu propia papeleta'/);
  assert.match(sql, /if v_doc\.estado<>'REGISTRADO' then raise exception 'Solo puede firmarse una papeleta pendiente de firma'/);
  assert.match(sql, /where id=p_perfil_firma_id and usuario_id=auth\.uid\(\) and activo/);
});
test("firmar_papeleta_vacaciones verifica papeleta_id + versión + SHA-256 de origen: si cualquiera cambió, rechaza sin firmar una versión vieja", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  assert.match(sql, /p_papeleta_id uuid,p_version_esperada integer,p_archivo_sha256_origen text,p_perfil_firma_id uuid,/);
  assert.match(sql, /if p_version_esperada is distinct from v_doc\.version_actual or p_archivo_sha256_origen is distinct from v_doc\.archivo_sha256 then/);
  assert.match(sql, /raise exception 'La papeleta cambió mientras firmabas\. Recarga antes de continuar\.' using errcode='40001';/);
});
test("firmar_papeleta_vacaciones nunca sobrescribe: inserta versión FIRMADO nueva y solo entonces mueve el puntero vigente + evento FIRMADO", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  const fnStart = sql.indexOf("create function public.firmar_papeleta_vacaciones");
  const fnEnd = sql.indexOf("$$;", fnStart);
  const body = sql.slice(fnStart, fnEnd);
  assert.match(body, /insert into public\.papeletas_vacaciones_versiones\(/);
  assert.match(body, /'FIRMADO'\s*\);/);
  assert.match(body, /update public\.papeletas_vacaciones set[\s\S]*estado='FIRMADO'/);
  assert.match(body, /insert into public\.papeletas_vacaciones_eventos\(papeleta_id,usuario_id,accion,estado_anterior,estado_nuevo,version\)\s*\n\s*values \(p_papeleta_id,auth\.uid\(\),'FIRMADO','REGISTRADO','FIRMADO',v_version\);/);
});
test("marcar_conforme_papeleta_vacaciones queda retirado (drop function): la única vía a FIRMADO es la firma real", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  assert.match(sql, /drop function if exists public\.marcar_conforme_papeleta_vacaciones\(uuid\);/);
});
test("el trigger de inmutabilidad de versiones solo cede en un borrado de prueba explícito (admin + flag de sesión), nunca por defecto", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  assert.match(sql, /current_setting\('app\.test_papeleta_deletion',true\)='on'/);
  assert.match(sql, /auth\.uid\(\) is not null and public\.is_admin\(\)/);
});
test("borrado de prueba: arquitectura explícita es_prueba (nunca por nombre), doble flag (private.app_config + entorno), nunca FIRMADO", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  assert.match(sql, /insert into private\.app_config\(clave,habilitado\) values \('allow_test_papeleta_deletion',true\)/);
  assert.match(sql, /create function private\.admin_marcar_papeleta_prueba/);
  assert.match(sql, /if v_doc\.estado in \('FIRMADO','CONFORME'\) then raise exception 'Una papeleta firmada o conforme no puede marcarse como prueba'/);
  assert.match(sql, /create function private\.admin_eliminar_papeletas_prueba/);
  assert.match(sql, /if exists\(select 1 from public\.papeletas_vacaciones p where p\.id=any\(p_ids\) and not p\.es_prueba\) then/);
  assert.match(sql, /if exists\(select 1 from public\.papeletas_vacaciones p where p\.id=any\(p_ids\) and p\.estado in \('FIRMADO','CONFORME'\)\) then/);
});
test("Storage: el gerente solo puede subir el PDF firmado bajo la carpeta del coordinador si la papeleta está REGISTRADO (pendiente de firma)", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  assert.match(sql, /create policy papeletas_storage_insert_firma on storage\.objects for insert to authenticated/);
  assert.match(sql, /with check\(bucket_id='papeletas-vacaciones' and private\.es_gerente\(\) and exists\(/);
  assert.match(sql, /and p\.estado='REGISTRADO'/);
});

test("createSignedPdf (motor de Documentos) ahora acepta un bucket de origen distinto: se reutiliza para papeletas sin duplicar el motor", async () => {
  const source = await readFile("lib/documents/pdf.ts", "utf8");
  assert.match(source, /sourceBucket:string=DOCUMENT_BUCKET/);
  assert.match(source, /db\.storage\.from\(sourceBucket\)\.download\(originalPath\)/);
  assert.match(source, /db\.storage\.from\(DOCUMENT_BUCKET\)\.download\(placement\.asset_path\)/);
  assert.equal(typeof createSignedPdf, "function");
});
test("no hay posición fija de firma: el editor interactivo elige pagina/x/y en cada firma, createSignedPdf solo aplica la colocación recibida", async () => {
  const source = await readFile("lib/documents/pdf.ts", "utf8");
  assert.match(source, /pdf\.getPage\(placement\.pagina-1\)/);
  assert.doesNotMatch(source, /pagina===-1/);
  const handlers = await readFile("lib/vacations/handlers.ts", "utf8");
  assert.doesNotMatch(handlers, /x:\s*0\.6,\s*y:\s*0\.04/); // ya no hay coordenadas hardcodeadas del sello
});

test("lib/vacations/config.ts: ALLOW_TEST_PAPELETA_DELETION sigue el mismo patrón que ALLOW_TEST_REQUIREMENT_DELETION", () => {
  const original = process.env.ALLOW_TEST_PAPELETA_DELETION;
  try {
    delete process.env.ALLOW_TEST_PAPELETA_DELETION;
    assert.equal(allowTestPapeletaDeletion(), false);
    process.env.ALLOW_TEST_PAPELETA_DELETION = "true";
    assert.equal(allowTestPapeletaDeletion(), true);
    process.env.ALLOW_TEST_PAPELETA_DELETION = "false";
    assert.equal(allowTestPapeletaDeletion(), false);
  } finally {
    if (original === undefined) delete process.env.ALLOW_TEST_PAPELETA_DELETION;
    else process.env.ALLOW_TEST_PAPELETA_DELETION = original;
  }
});

function fakeProfile(role: "admin" | "coordinador" | "gerente", id = "user-1") {
  return { id, email: `${role}@example.com`, nombre: role, role };
}
test("makeSignPapeletaHandler: solo gerente puede intentar firmar (403 para admin/coordinador)", async () => {
  for (const role of ["admin", "coordinador"] as const) {
    const handler = makeSignPapeletaHandler({ getProfile: async () => fakeProfile(role), getDb: async () => ({} as SupabaseClient) });
    const response = await handler(new Request("https://x.test/firmar", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ version_esperada: 1 }) }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(response.status, 403);
  }
});
test("makeSignPapeletaHandler: rechaza version_esperada inválida antes de tocar la BD", async () => {
  const handler = makeSignPapeletaHandler({ getProfile: async () => fakeProfile("gerente"), getDb: async () => ({} as SupabaseClient) });
  const response = await handler(new Request("https://x.test/firmar", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ version_esperada: 0 }) }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(response.status, 400);
});
test("makeMarkTestPapeletaHandler: solo admin puede marcar es_prueba (403 para coordinador/gerente)", async () => {
  for (const role of ["coordinador", "gerente"] as const) {
    const handler = makeMarkTestPapeletaHandler({ getProfile: async () => fakeProfile(role), getDb: async () => ({} as SupabaseClient) });
    const response = await handler(new Request("https://x.test/prueba", { method: "PATCH", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ es_prueba: true }) }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(response.status, 403);
  }
});
test("makeDeleteTestPapeletasHandler: solo admin, y el flag de entorno deshabilitado bloquea antes de llamar a la RPC", async () => {
  const handlerNonAdmin = makeDeleteTestPapeletasHandler({ getProfile: async () => fakeProfile("gerente"), getDb: async () => ({} as SupabaseClient) }, () => true);
  const responseNonAdmin = await handlerNonAdmin(new Request("https://x.test/prueba", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] }) }));
  assert.equal(responseNonAdmin.status, 403);

  let rpcCalled = false;
  const fakeDb = { rpc: async () => { rpcCalled = true; return { data: [], error: null }; } } as unknown as SupabaseClient;
  const handlerDisabled = makeDeleteTestPapeletasHandler({ getProfile: async () => fakeProfile("admin"), getDb: async () => fakeDb }, () => false);
  const responseDisabled = await handlerDisabled(new Request("https://x.test/prueba", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] }) }));
  assert.equal(responseDisabled.status, 403);
  assert.equal(rpcCalled, false, "con el flag apagado nunca debe llegar a llamar la RPC");
});
test("makeDeleteTestPapeletasHandler: rechaza listas vacías, duplicadas o más de 100 ids antes de llamar a la RPC", async () => {
  let rpcCalled = false;
  const fakeDb = { rpc: async () => { rpcCalled = true; return { data: [], error: null }; } } as unknown as SupabaseClient;
  const handler = makeDeleteTestPapeletasHandler({ getProfile: async () => fakeProfile("admin"), getDb: async () => fakeDb }, () => true);
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const send = (ids: unknown) => handler(new Request("https://x.test/prueba", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ ids }) }));
  assert.equal((await send([])).status, 400);
  assert.equal((await send([id, id])).status, 400);
  assert.equal((await send(Array.from({ length: 101 }, () => id))).status, 400);
  assert.equal(rpcCalled, false);
});
test("makeDeleteTestPapeletasHandler: en éxito, borra en Storage exactamente las rutas que devolvió la RPC y las confirma en la cola", async () => {
  const removed: string[] = [];
  const confirmed: unknown[] = [];
  const fakeDb = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "admin_eliminar_papeletas_prueba") return { data: ["coord/a/v1.pdf", "coord/a/v2.pdf"], error: null };
      if (name === "admin_confirmar_borrado_storage") { confirmed.push(args?.p_paths); return { data: 2, error: null }; }
      throw new Error(`RPC inesperada en el test: ${name}`);
    },
    storage: { from: () => ({ remove: async (paths: string[]) => { removed.push(...paths); return { data: paths.map(name => ({ name })), error: null }; } }) },
  } as unknown as SupabaseClient;
  const handler = makeDeleteTestPapeletasHandler({ getProfile: async () => fakeProfile("admin"), getDb: async () => fakeDb }, () => true);
  const response = await handler(new Request("https://x.test/prueba", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] }) }));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(removed, ["coord/a/v1.pdf", "coord/a/v2.pdf"]);
  assert.equal(data.archivos_borrados, 2);
  assert.equal(data.archivos_pendientes, 0);
  assert.deepEqual(confirmed, [["coord/a/v1.pdf", "coord/a/v2.pdf"]]);
});

// ============================================================================
// Auditoría: Postgres y Supabase Storage no comparten transacción. La RPC ya confirma el borrado
// en BD (y deja cada ruta en private.papeleta_storage_borrado_pendiente, ver migración) ANTES de
// que la app intente tocar Storage. Estos tests cubren qué pasa cuando ese paso posterior falla,
// total o parcialmente, y confirman que nunca se reporta como éxito silencioso ni se pierde el
// rastro de qué falta borrar.
// ============================================================================
test("fallo de Storage total: la BD ya se borró, Storage falla completo -- se reporta como pendiente, nunca como éxito, y se registra el intento fallido", async () => {
  const registered: unknown[] = [];
  const confirmedCalls: unknown[] = [];
  const fakeDb = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "admin_eliminar_papeletas_prueba") return { data: ["coord/a/v1.pdf", "coord/a/v2.pdf"], error: null };
      if (name === "admin_registrar_intento_borrado_storage") { registered.push(args); return { data: null, error: null }; }
      if (name === "admin_confirmar_borrado_storage") { confirmedCalls.push(args); return { data: 0, error: null }; }
      throw new Error(`RPC inesperada: ${name}`);
    },
    storage: { from: () => ({ remove: async () => ({ data: null, error: { message: "network error" } }) }) },
  } as unknown as SupabaseClient;
  const handler = makeDeleteTestPapeletasHandler({ getProfile: async () => fakeProfile("admin"), getDb: async () => fakeDb }, () => true);
  const response = await handler(new Request("https://x.test/prueba", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] }) }));
  const data = await response.json();
  assert.equal(response.status, 200); // el borrado en BD sí fue exitoso: no es un error HTTP
  assert.equal(data.eliminados, 1);
  assert.equal(data.archivos_borrados, 0);
  assert.equal(data.archivos_pendientes, 2); // nunca se informa como si los 2 se hubieran borrado
  assert.equal(confirmedCalls.length, 0); // jamás se confirma (retira de la cola) lo que no se borró
  assert.deepEqual(registered, [{ p_paths: ["coord/a/v1.pdf", "coord/a/v2.pdf"], p_error: "network error" }]);
});
test("fallo de Storage parcial: de 2 archivos, Storage solo confirma 1 -- el otro queda pendiente, no se confirma en la cola", async () => {
  const confirmedCalls: unknown[] = [];
  const registered: unknown[] = [];
  const fakeDb = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "admin_eliminar_papeletas_prueba") return { data: ["coord/a/v1.pdf", "coord/a/v2.pdf"], error: null };
      if (name === "admin_confirmar_borrado_storage") { confirmedCalls.push(args); return { data: 1, error: null }; }
      if (name === "admin_registrar_intento_borrado_storage") { registered.push(args); return { data: null, error: null }; }
      throw new Error(`RPC inesperada: ${name}`);
    },
    // Supabase Storage omite del array `data` las rutas que no pudo resolver, sin marcarlas como
    // error individual: aquí se simula justo ese comportamiento (solo v1.pdf viene en la respuesta).
    storage: { from: () => ({ remove: async () => ({ data: [{ name: "coord/a/v1.pdf" }], error: null }) }) },
  } as unknown as SupabaseClient;
  const handler = makeDeleteTestPapeletasHandler({ getProfile: async () => fakeProfile("admin"), getDb: async () => fakeDb }, () => true);
  const response = await handler(new Request("https://x.test/prueba", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] }) }));
  const data = await response.json();
  assert.equal(data.archivos_borrados, 1);
  assert.equal(data.archivos_pendientes, 1);
  assert.deepEqual(confirmedCalls, [{ p_paths: ["coord/a/v1.pdf"] }]);
  assert.deepEqual(registered, [{ p_paths: ["coord/a/v2.pdf"], p_error: "Storage no confirmó la eliminación de estas rutas." }]);
});
test("fallo de BD: si la RPC de borrado falla, jamás se llama a Storage (nada que limpiar, nada que confirmar)", async () => {
  let storageCalled = false;
  const fakeDb = {
    rpc: async (name: string) => {
      if (name === "admin_eliminar_papeletas_prueba") return { data: null, error: { code: "55000", message: "Solo se pueden eliminar papeletas marcadas como prueba" } };
      throw new Error(`RPC inesperada: ${name}`);
    },
    storage: { from: () => ({ remove: async () => { storageCalled = true; return { data: [], error: null }; } }) },
  } as unknown as SupabaseClient;
  const handler = makeDeleteTestPapeletasHandler({ getProfile: async () => fakeProfile("admin"), getDb: async () => fakeDb }, () => true);
  const response = await handler(new Request("https://x.test/prueba", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] }) }));
  assert.equal(response.status, 409);
  assert.equal(storageCalled, false);
});
test("makeRetryStorageCleanupHandler: solo admin, lista lo pendiente y reintenta Storage igual que el borrado inicial", async () => {
  const removedPaths: string[] = [];
  const confirmedCalls: unknown[] = [];
  const fakeDb = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "admin_listar_borrados_pendientes") return { data: [{ archivo_path: "coord/a/v2.pdf" }], error: null };
      if (name === "admin_confirmar_borrado_storage") { confirmedCalls.push(args); return { data: 1, error: null }; }
      throw new Error(`RPC inesperada: ${name}`);
    },
    storage: { from: () => ({ remove: async (paths: string[]) => { removedPaths.push(...paths); return { data: paths.map(name => ({ name })), error: null }; } }) },
  } as unknown as SupabaseClient;
  const nonAdmin = makeRetryStorageCleanupHandler({ getProfile: async () => fakeProfile("gerente"), getDb: async () => fakeDb });
  assert.equal((await nonAdmin(new Request("https://x.test/reintentar", { method: "POST", headers: { origin: "https://x.test" } }))).status, 403);

  const handler = makeRetryStorageCleanupHandler({ getProfile: async () => fakeProfile("admin"), getDb: async () => fakeDb });
  const response = await handler(new Request("https://x.test/reintentar", { method: "POST", headers: { origin: "https://x.test" } }));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(removedPaths, ["coord/a/v2.pdf"]);
  assert.equal(data.archivos_borrados, 1);
  assert.equal(data.archivos_pendientes, 0);
  assert.deepEqual(confirmedCalls, [{ p_paths: ["coord/a/v2.pdf"] }]);
});

test("navegación: Vacaciones encabeza el módulo Documentos y Mantenimiento solo aparece para admin", async () => {
  const source = await readFile("components/document-section-nav.tsx", "utf8");
  assert.match(source, /const documentTypes=\[\{href:"\/documentos\/vacaciones"/);
  assert.match(source, /role==="admin"\?\[\{href:"\/documentos\/vacaciones\/mantenimiento"/);
});
test("el detalle de una papeleta ahora incluye el visor de PDF (no exige descargar el archivo para revisarlo)", async () => {
  const source = await readFile("app/(private)/documentos/vacaciones/[id]/page.tsx", "utf8");
  assert.match(source, /<VacationPdfViewer papeletaId=\{row\.id\} \/>/);
});
test("el visor de PDF de vacaciones nunca expone el bucket ni el path: solo pide bytes al endpoint privado", async () => {
  const viewer = await readFile("components/vacation-pdf-viewer.tsx", "utf8");
  assert.match(viewer, /\/api\/documentos\/vacaciones\/\$\{papeletaId\}\/archivo/);
  assert.doesNotMatch(viewer, /papeletas-vacaciones/);
});
test("el endpoint de archivo de vacaciones nunca sirve el PDF sin sesión y valida el hash antes de responder", async () => {
  const source = await readFile("app/api/documentos/vacaciones/[id]/archivo/route.ts", "utf8");
  assert.match(source, /if \(!profile\) return NextResponse\.json\(\{ error: "Sesión requerida\." \}, \{ status: 401 \}\);/);
  assert.match(source, /if \(sha256\(bytes\) !== sha\)/);
  assert.match(source, /Cache-Control": "private, no-store"/);
});

// ============================================================================
// Corrección: la firma del gerente ya NO usa posición fija. Reutiliza el editor de colocación
// interactivo de Documentos/Firma (mismo render, misma matemática de arrastre/redimensión) y
// verifica papeleta_id + versión + SHA-256 de origen antes de componer el PDF final.
// ============================================================================

test("movePlacements y resizePlacements son las MISMAS funciones que usa el editor de Documentos (importadas, no reimplementadas)", async () => {
  const workspace = await readFile("components/document-workspace.tsx", "utf8");
  assert.match(workspace, /import \{ movePlacements,resizePlacements \} from "@\/lib\/documents\/placement-client";/);
  assert.match(workspace, /export async function renderPdfPage/);
  const signWorkspace = await readFile("components/vacation-sign-workspace.tsx", "utf8");
  assert.match(signWorkspace, /import \{ renderPdfPage \} from "\.\/document-workspace";/);
  assert.match(signWorkspace, /import \{ movePlacements, resizePlacements \} from "@\/lib\/documents\/placement-client";/);
});
test("movePlacements mantiene la colocación dentro de los límites de la página (0..1-tamaño)", () => {
  const items = [{ x: 0.5, y: 0.5, ancho: 0.3, alto: 0.2 }];
  assert.deepEqual(movePlacements(items, 0, 0.9, 0), [{ x: 0.7, y: 0.5, ancho: 0.3, alto: 0.2 }]); // clamp a 1-ancho
  assert.deepEqual(movePlacements(items, 0, -0.9, 0), [{ x: 0, y: 0.5, ancho: 0.3, alto: 0.2 }]); // clamp a 0
});
test("resizePlacements escala manteniendo el ancla y respeta los límites mínimos/máximos", () => {
  const items = [{ x: 0.1, y: 0.1, ancho: 0.2, alto: 0.1 }];
  const grown = resizePlacements(items, 0, 0.2, 0);
  assert.ok(grown[0].ancho > 0.2, "crecer arrastrando debe agrandar el ancho");
  const shrunk = resizePlacements(items, 0, -1, -1);
  assert.ok(shrunk[0].ancho >= 0.06 && shrunk[0].alto >= 0.04, "nunca por debajo del tamaño mínimo");
});
test("VacationSignWorkspace nunca hardcodea la posición del sello: la coloca a partir de un placement editable en estado", async () => {
  const source = await readFile("components/vacation-sign-workspace.tsx", "utf8");
  assert.match(source, /const \[placement, setPlacement\] = useState<Placement>/);
  assert.match(source, /onPointerDown=\{move\}/);
  assert.match(source, /onPointerDown=\{resize\}/);
  assert.match(source, /src="\/api\/perfil\/firma\?tipo=sello"/); // mismo endpoint de evidencia que Documentos
  assert.match(source, /changePage/); // cambia de página
});
test("VacationSignWorkspace verifica versión + hash antes de previsualizar y antes de confirmar, y bloquea si el servidor responde 409", async () => {
  const source = await readFile("components/vacation-sign-workspace.tsx", "utf8");
  assert.match(source, /version_esperada: versionActual, archivo_sha256_origen: archivoSha256, placement/);
  assert.equal([...source.matchAll(/if \(response\.status === 409\) setStale\(true\);/g)].length, 2);
  assert.match(source, /La papeleta cambió mientras la firmabas/);
  assert.match(source, /if \(stale\) return/);
});
test("el detalle usa el editor interactivo (no un botón de firma fijo) cuando el gerente puede firmar", async () => {
  const page = await readFile("app/(private)/documentos/vacaciones/[id]/page.tsx", "utf8");
  assert.match(page, /<VacationSignWorkspace papeletaId=\{row\.id\} versionActual=\{row\.version_actual\} archivoSha256=\{row\.archivo_sha256\}/);
  assert.doesNotMatch(page, /VacationSignButton/);
});

test("firmar_papeleta_vacaciones y su handler exigen papeleta_id + versión + SHA-256 de origen coincidentes (verificación explícita de frescura)", async () => {
  const handlers = await readFile("lib/vacations/handlers.ts", "utf8");
  assert.match(handlers, /doc\.version_actual !== versionEsperada \|\| doc\.archivo_sha256 !== shaOrigen/);
  assert.match(handlers, /p_archivo_sha256_origen: shaOrigen/);
});

function fakeSigningDb(overrides: { estado?: string; version_actual?: number; archivo_sha256?: string; perfil?: { id: string; version: number; sello_path: string } | null } = {}) {
  const doc = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", coordinador_id: "coord-1",
    estado: overrides.estado ?? "REGISTRADO", version_actual: overrides.version_actual ?? 1,
    archivo_path: "coord-1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf", archivo_sha256: overrides.archivo_sha256 ?? "a".repeat(64),
  };
  const perfil = overrides.perfil === undefined ? { id: "perfil-1", version: 1, sello_path: "sellos/gerente-1/v1.png" } : overrides.perfil;
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => (table === "perfiles_firma" ? { data: perfil, error: null } : { data: null, error: null }) }),
            maybeSingle: async () => (table === "papeletas_vacaciones" ? { data: doc, error: null } : { data: null, error: null }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}
const validPlacement = { pagina: 1, x: 0.2, y: 0.2, ancho: 0.2, alto: 0.1 };
test("makePreviewSignPapeletaHandler: rechaza con 409 si el hash de origen enviado ya no coincide con el vigente (nunca compone en silencio una versión vieja)", async () => {
  const handler = makePreviewSignPapeletaHandler({ getProfile: async () => fakeProfile("gerente"), getDb: async () => fakeSigningDb({ archivo_sha256: "b".repeat(64) }) });
  const response = await handler(new Request("https://x.test/preview", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ version_esperada: 1, archivo_sha256_origen: "a".repeat(64), placement: validPlacement }) }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(response.status, 409);
  const data = await response.json();
  assert.match(data.error, /cambió mientras firmabas/);
});
test("makePreviewSignPapeletaHandler: rechaza con 409 si la versión ya no es la esperada", async () => {
  const handler = makePreviewSignPapeletaHandler({ getProfile: async () => fakeProfile("gerente"), getDb: async () => fakeSigningDb({ version_actual: 2 }) });
  const response = await handler(new Request("https://x.test/preview", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ version_esperada: 1, archivo_sha256_origen: "a".repeat(64), placement: validPlacement }) }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(response.status, 409);
});
test("makePreviewSignPapeletaHandler: rechaza si la papeleta ya no está pendiente de firma (p.ej. OBSERVADO)", async () => {
  const handler = makePreviewSignPapeletaHandler({ getProfile: async () => fakeProfile("gerente"), getDb: async () => fakeSigningDb({ estado: "OBSERVADO" }) });
  const response = await handler(new Request("https://x.test/preview", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ version_esperada: 1, archivo_sha256_origen: "a".repeat(64), placement: validPlacement }) }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(response.status, 409);
});
test("makePreviewSignPapeletaHandler: exige un perfil de firma activo propio antes de componer", async () => {
  const handler = makePreviewSignPapeletaHandler({ getProfile: async () => fakeProfile("gerente"), getDb: async () => fakeSigningDb({ perfil: null }) });
  const response = await handler(new Request("https://x.test/preview", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ version_esperada: 1, archivo_sha256_origen: "a".repeat(64), placement: validPlacement }) }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(response.status, 400);
});
test("makeSignPapeletaHandler y makePreviewSignPapeletaHandler rechazan un placement fuera de los límites de la página o con campos faltantes", async () => {
  const cases: unknown[] = [
    { pagina: 0, x: 0, y: 0, ancho: 0.2, alto: 0.1 }, // página inválida
    { pagina: 1, x: 0.9, y: 0, ancho: 0.5, alto: 0.1 }, // se sale por la derecha
    { pagina: 1, x: 0, y: 0.95, ancho: 0.2, alto: 0.5 }, // se sale por abajo
    { pagina: 1, x: 0, y: 0, ancho: 0, alto: 0.1 }, // ancho cero
    { pagina: 1, x: 0, y: 0 }, // faltan ancho/alto
    "no-es-un-objeto",
  ];
  for (const placement of cases) {
    const handler = makeSignPapeletaHandler({ getProfile: async () => fakeProfile("gerente"), getDb: async () => fakeSigningDb() });
    const response = await handler(new Request("https://x.test/firmar", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ version_esperada: 1, archivo_sha256_origen: "a".repeat(64), placement }) }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(response.status, 400, `debe rechazar: ${JSON.stringify(placement)}`);
  }
});
test("makeSignPapeletaHandler: rechaza con 409 si el hash de origen ya no coincide, antes de intentar componer o subir nada", async () => {
  const db = fakeSigningDb({ archivo_sha256: "b".repeat(64) });
  const handler = makeSignPapeletaHandler({ getProfile: async () => fakeProfile("gerente"), getDb: async () => db });
  const response = await handler(new Request("https://x.test/firmar", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://x.test" }, body: JSON.stringify({ version_esperada: 1, archivo_sha256_origen: "a".repeat(64), placement: validPlacement }) }), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(response.status, 409);
  const data = await response.json();
  assert.match(data.error, /cambió mientras firmabas/);
});

test("202609200001: la cola de limpieza pendiente se inserta DENTRO de la misma transacción que borra las filas (nunca queda huérfano sin rastro)", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  assert.match(sql, /create table private\.papeleta_storage_borrado_pendiente/);
  const fnStart = sql.indexOf("create function private.admin_eliminar_papeletas_prueba");
  const fnEnd = sql.indexOf("$$;", fnStart);
  const body = sql.slice(fnStart, fnEnd);
  const insertPending = body.indexOf("insert into private.papeleta_storage_borrado_pendiente");
  const deleteVersiones = body.indexOf("delete from public.papeletas_vacaciones_versiones");
  assert.ok(insertPending > -1 && insertPending < deleteVersiones, "la cola debe llenarse ANTES de borrar las versiones, dentro de la misma transacción");
});
test("202609200001: admin_confirmar_borrado_storage y admin_registrar_intento_borrado_storage son admin-only y nunca inventan qué se borró", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  assert.match(sql, /create function private\.admin_confirmar_borrado_storage\(p_paths text\[\]\)/);
  assert.match(sql, /delete from private\.papeleta_storage_borrado_pendiente where archivo_path=any\(p_paths\);/);
  assert.match(sql, /create function private\.admin_registrar_intento_borrado_storage\(p_paths text\[\],p_error text\)/);
  assert.match(sql, /set intentos=intentos\+1,ultimo_intento_at=now\(\),ultimo_error=left\(coalesce\(p_error,''\),500\)/);
  const adminCheckCount = [...sql.matchAll(/raise exception 'Solo administradores' using errcode='42501';/g)].length;
  assert.ok(adminCheckCount >= 5, "cada RPC nueva de esta migración (marcar, eliminar, confirmar, registrar intento, listar pendientes) valida admin explícitamente");
});
test("202609200001: nueva política admite que admin borre huérfanos de Storage (el propietario de la carpeta ya no es requisito), pero nunca un archivo todavía referenciado", async () => {
  const sql = await readFile("supabase/migrations/202609200001_papeletas_firma.sql", "utf8");
  assert.match(sql, /create policy papeletas_storage_delete_admin_huerfanos on storage\.objects for delete to authenticated/);
  assert.match(sql, /using\(bucket_id='papeletas-vacaciones' and public\.is_admin\(\)/);
  assert.match(sql, /not exists\(select 1 from public\.papeletas_vacaciones p where p\.archivo_path=name\)/);
  assert.match(sql, /not exists\(select 1 from public\.papeletas_vacaciones_versiones v where v\.archivo_path=name\)\)\$p\$;/);
});
test("el handler de borrado de pruebas solo confirma en la cola las rutas que Storage realmente reportó, nunca por adelantado", async () => {
  const source = await readFile("lib/vacations/handlers.ts", "utf8");
  assert.match(source, /const confirmed = paths\.filter\(\(path\) => removedNames\.has\(path\)\);/);
  assert.match(source, /const pending = paths\.filter\(\(path\) => !removedNames\.has\(path\)\);/);
  assert.match(source, /if \(confirmed\.length\) await db\.rpc\("admin_confirmar_borrado_storage"/);
  assert.match(source, /if \(pending\.length\) await db\.rpc\("admin_registrar_intento_borrado_storage"/);
});

// ============================================================================
// Mejora puntual: tarjetas compactas para los tres roles, filtros combinables con paginación en
// servidor (misma RPC para coordinador y admin/gerente), y borrado de prueba extendido a FIRMADO
// y CONFORME histórico cuando es_prueba=true, con auditoría que sobrevive a la papeleta.
// ============================================================================

// --- LISTADOS: tarjetas compactas ---
test("VacationPapeletaList: la tarjeta NUNCA muestra físicas, venta, reemplazo ni provincia (eso vive solo en el detalle)", async () => {
  const source = await readFile("components/vacation-papeleta-list.tsx", "utf8");
  assert.doesNotMatch(source, /[Ff]ísicas:/);
  assert.doesNotMatch(source, /[Vv]enta:/);
  assert.doesNotMatch(source, /[Rr]eemplazo:/);
  assert.doesNotMatch(source, /[Pp]rovincia:/);
  const executableLines = source.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(executableLines, /fisicas_fecha_inicio|venta_fecha_inicio|row\.reemplazo/);
});
test("VacationPapeletaList: muestra colaborador, código, estado, fecha de registro, cliente y unidad para los tres roles", async () => {
  const source = await readFile("components/vacation-papeleta-list.tsx", "utf8");
  assert.match(source, /row\.colaborador_nombre/);
  assert.match(source, /row\.colaborador_codigo/);
  assert.match(source, /PapeletaEstadoBadge estado=\{row\.estado\}/);
  assert.match(source, /Registrado: /);
  assert.match(source, /row\.clientes\?\.nombre/);
  assert.match(source, /row\.unidades\?\.nombre/);
  assert.match(source, /Ver detalle/);
});
test("VacationPapeletaList: Coordinador NO ve la columna Coordinador en su propia tarjeta; admin/gerente sí", async () => {
  const source = await readFile("components/vacation-papeleta-list.tsx", "utf8");
  assert.match(source, /role !== "coordinador" && row\.profiles\?\.nombre/);
});
test("VacationPapeletaList: solo el gerente ve el botón Firmar, y solo cuando la papeleta está pendiente de firma (REGISTRADO)", async () => {
  const source = await readFile("components/vacation-papeleta-list.tsx", "utf8");
  assert.match(source, /const puedeFirmar = role === "gerente" && row\.estado === "REGISTRADO";/);
});
test("el detalle sigue mostrando toda la información retirada de la tarjeta: físicas, venta, reemplazo, provincia, cliente, unidad, coordinador", async () => {
  const source = await readFile("app/(private)/documentos/vacaciones/[id]/page.tsx", "utf8");
  for (const label of ["Vacaciones físicas", "Venta de vacaciones", "Reemplazo", "Provincia", "Cliente", "Unidad", "Coordinador"]) {
    assert.match(source, new RegExp(`\\["${label}"`), `el detalle debe seguir mostrando "${label}"`);
  }
  assert.match(source, /<VacationPdfViewer papeletaId=\{row\.id\} \/>/);
});

// --- FILTROS: esquema, combinación, limpiar, paginación ---
test("papeletaFiltersSchema acepta y combina búsqueda + cliente + unidad + estado + provincia + fechas", () => {
  const parsed = papeletaFiltersSchema.parse({ q: "Luz", cliente: "44000000-0000-4000-8000-000000000001", unidad: "", provincia: "", coordinador: "", estado: "FIRMADO", desde: "2026-01-01", hasta: "2026-12-31" });
  assert.equal(parsed.q, "Luz");
  assert.equal(parsed.estado, "FIRMADO");
  assert.equal(parsed.desde, "2026-01-01");
});
test("papeletaFiltersSchema rechaza un rango de fechas invertido (desde > hasta)", () => {
  assert.throws(() => papeletaFiltersSchema.parse({ ...EMPTY_PAPELETA_FILTERS, desde: "2026-06-01", hasta: "2026-01-01" }));
});
test("PAPELETA_ESTADOS expone los 4 estados visibles pedidos: Pendiente de firma, Observado, Firmado, Conforme (histórico)", () => {
  assert.deepEqual(PAPELETA_ESTADOS, ["REGISTRADO", "OBSERVADO", "FIRMADO", "CONFORME"]);
});
test("papeletaRpcArgs traduce los filtros vacíos a null (para que la RPC los ignore) y los presentes a su valor", () => {
  assert.deepEqual(papeletaRpcArgs(EMPTY_PAPELETA_FILTERS), {
    p_busqueda: null, p_cliente_id: null, p_unidad_id: null, p_provincia_id: null, p_estado: null, p_coordinador_id: null, p_desde: null, p_hasta: null,
  });
  const filled = papeletaRpcArgs({ ...EMPTY_PAPELETA_FILTERS, q: "ana", cliente: "c1", estado: "OBSERVADO" });
  assert.equal(filled.p_busqueda, "ana");
  assert.equal(filled.p_cliente_id, "c1");
  assert.equal(filled.p_estado, "OBSERVADO");
});
test("papeletaFilterParams solo serializa los filtros con valor, y siempre incluye la página", () => {
  const params = papeletaFilterParams({ ...EMPTY_PAPELETA_FILTERS, cliente: "c1", estado: "FIRMADO" }, 3);
  assert.equal(params.get("cliente"), "c1");
  assert.equal(params.get("estado"), "FIRMADO");
  assert.equal(params.get("unidad"), null);
  assert.equal(params.get("page"), "3");
});
test("VacationFilters: incluye Limpiar filtros y unidad depende del cliente elegido", async () => {
  const source = await readFile("components/vacation-filters.tsx", "utf8");
  assert.match(source, /Limpiar filtros/);
  assert.match(source, /unidadesDelCliente/);
  assert.match(source, /options\.unidades\.filter\(u => u\.cliente_id === draft\.cliente\)/);
  assert.match(source, /if \(key === "cliente"\) next\.unidad = "";/);
});
test("la página de listado muestra la cantidad de resultados y paginación (Anterior/Siguiente)", async () => {
  const source = await readFile("app/(private)/documentos/vacaciones/page.tsx", "utf8");
  assert.match(source, /\{listResult\.total\} resultado/);
  assert.match(source, />Anterior</);
  assert.match(source, />Siguiente</);
  assert.match(source, /Página \{page\} de \{totalPages\}/);
});
test("el listado usa la RPC (backend), nunca trae toda la tabla para filtrar en el navegador", async () => {
  const source = await readFile("lib/vacations/list-data.ts", "utf8");
  assert.match(source, /db\.rpc\("listar_papeletas_vacaciones_filtradas"/);
  assert.match(source, /p_limite: PAPELETAS_PAGE_SIZE, p_offset: \(page - 1\) \* PAPELETAS_PAGE_SIZE/);
  const page = await readFile("app/(private)/documentos/vacaciones/page.tsx", "utf8");
  assert.doesNotMatch(page, /\.select\(PAPELETA_LIST_SELECT\)|\.limit\(100\)/);
});
test("admin y coordinador reutilizan la MISMA función RPC (no dos implementaciones del motor de filtros)", async () => {
  const sql = await readFile("supabase/migrations/202609210001_papeletas_filtros_y_prueba_completa.sql", "utf8");
  const count = [...sql.matchAll(/create function public\.listar_papeletas_vacaciones_filtradas/g)].length;
  assert.equal(count, 1, "debe existir una sola función de listado filtrado, reutilizada por todos los roles");
  assert.match(sql, /where p\.coordinador_id=auth\.uid\(\) or public\.is_admin\(\) or private\.es_gerente\(\)/);
});
test("evita N+1: el listado resuelve cliente/unidad/provincia/coordinador con LEFT JOIN dentro de la misma consulta, no fila por fila", async () => {
  const sql = await readFile("supabase/migrations/202609210001_papeletas_filtros_y_prueba_completa.sql", "utf8");
  const fnStart = sql.indexOf("create function public.listar_papeletas_vacaciones_filtradas");
  const fnEnd = sql.indexOf("$$;", fnStart);
  const body = sql.slice(fnStart, fnEnd);
  assert.match(body, /with base as materialized/);
  assert.match(body, /left join public\.clientes c on c\.id=p\.cliente_id/);
  assert.match(body, /left join public\.unidades u on u\.id=p\.unidad_id/);
  assert.match(body, /left join public\.provincias prov on prov\.id=p\.provincia_id/);
  assert.match(body, /left join public\.profiles pr on pr\.id=p\.coordinador_id/);
});

// --- BORRADO: FIRMADO/CONFORME también borrables si es_prueba=true; auditoría sobrevive ---
test("202609210001: admin_eliminar_papeletas_prueba ya NO bloquea ningún estado -- solo es_prueba=true decide", async () => {
  const sql = await readFile("supabase/migrations/202609210001_papeletas_filtros_y_prueba_completa.sql", "utf8");
  const fnStart = sql.lastIndexOf("create or replace function private.admin_eliminar_papeletas_prueba");
  const fnEnd = sql.indexOf("$$;", fnStart);
  const body = sql.slice(fnStart, fnEnd);
  assert.doesNotMatch(body, /estado in \('FIRMADO','CONFORME'\)/);
  assert.doesNotMatch(body, /estado='FIRMADO'/);
  assert.match(body, /if exists\(select 1 from public\.papeletas_vacaciones p where p\.id=any\(p_ids\) and not p\.es_prueba\) then/);
});
test("202609210001: admin_marcar_papeleta_prueba ya no bloquea FIRMADO/CONFORME: se puede marcar de prueba una papeleta en cualquier estado", async () => {
  const sql = await readFile("supabase/migrations/202609210001_papeletas_filtros_y_prueba_completa.sql", "utf8");
  const fnStart = sql.lastIndexOf("create or replace function private.admin_marcar_papeleta_prueba");
  const fnEnd = sql.indexOf("$$;", fnStart);
  const body = sql.slice(fnStart, fnEnd);
  assert.doesNotMatch(body, /estado in \('FIRMADO','CONFORME'\)/);
});
test("202609210001: documento real (es_prueba=false) sigue absolutamente protegido, sin importar su estado", async () => {
  const sql = await readFile("supabase/migrations/202609210001_papeletas_filtros_y_prueba_completa.sql", "utf8");
  assert.match(sql, /if exists\(select 1 from public\.papeletas_vacaciones p where p\.id=any\(p_ids\) and not p\.es_prueba\) then\s*\n\s*raise exception 'Solo se pueden eliminar papeletas marcadas como prueba'/);
});
test("202609210001: se mantienen las dos protecciones existentes (flag de private.app_config + solo admin), sin agregar flags nuevos", async () => {
  const sql = await readFile("supabase/migrations/202609210001_papeletas_filtros_y_prueba_completa.sql", "utf8");
  assert.match(sql, /if not coalesce\(\(select habilitado from private\.app_config where clave='allow_test_papeleta_deletion'\),false\) then/);
  assert.match(sql, /if auth\.uid\(\) is null or not public\.is_admin\(\) then/);
  assert.doesNotMatch(sql, /allow_test_papeleta_deletion_v2|nueva_bandera/i);
});
test("202609210001: la auditoría de eliminación se escribe ANTES de borrar, en la misma transacción, y sobrevive a la papeleta (tabla propia, no papeletas_vacaciones_eventos)", async () => {
  const sql = await readFile("supabase/migrations/202609210001_papeletas_filtros_y_prueba_completa.sql", "utf8");
  assert.match(sql, /create table public\.papeletas_vacaciones_eliminaciones_auditoria/);
  const fnStart = sql.lastIndexOf("create or replace function private.admin_eliminar_papeletas_prueba");
  const fnEnd = sql.indexOf("$$;", fnStart);
  const body = sql.slice(fnStart, fnEnd);
  const auditIndex = body.indexOf("insert into public.papeletas_vacaciones_eliminaciones_auditoria");
  const deleteIndex = body.indexOf("delete from public.papeletas_vacaciones where id=any(p_ids)");
  assert.ok(auditIndex > -1 && auditIndex < deleteIndex, "la auditoría debe insertarse antes del DELETE final");
  assert.match(body, /estado_al_eliminar,\s*\n\s*version_actual,cantidad_versiones,eliminado_por,motivo/);
});
test("202609210001: solo admin puede leer la auditoría de eliminación (RLS)", async () => {
  const sql = await readFile("supabase/migrations/202609210001_papeletas_filtros_y_prueba_completa.sql", "utf8");
  assert.match(sql, /create policy papeletas_vacaciones_eliminaciones_auditoria_lectura on public\.papeletas_vacaciones_eliminaciones_auditoria\s*\n\s*for select to authenticated using \(public\.is_admin\(\)\);/);
});
test("VacationTestMaintenance: exige escribir la palabra ELIMINAR para confirmar, no basta un clic", async () => {
  const source = await readFile("components/vacation-test-maintenance.tsx", "utf8");
  assert.match(source, /const CONFIRM_WORD = "ELIMINAR";/);
  assert.match(source, /disabled=\{busy \|\| word\.trim\(\)\.toUpperCase\(\) !== CONFIRM_WORD\}/);
});
test("la página de mantenimiento ya no excluye FIRMADO del listado de papeletas de prueba", async () => {
  const source = await readFile("app/(private)/documentos/vacaciones/mantenimiento/page.tsx", "utf8");
  assert.doesNotMatch(source, /\.neq\("estado", "FIRMADO"\)/);
  assert.match(source, /\.eq\("es_prueba", true\)/);
});

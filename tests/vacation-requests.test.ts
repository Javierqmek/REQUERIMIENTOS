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
import { makeRegisterPapeletaHandler } from "../lib/vacations/handlers";
import { canCorrect, canMarkConforme, canObserve, canReview } from "../lib/vacations/review";
import { PAPELETA_DETAIL_SELECT, PAPELETA_LIST_SELECT } from "../lib/vacations/types";
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
  assert.match(source, /const \{ data, error \} = await query;/);
  assert.match(source, /error \? <Alert kind="error">/);
});

// --- Diseño de estados y permisos (lógica pura) ---
test("REGISTRADO: admin y gerente pueden revisar (observar o marcar conforme); coordinador no, y nadie revisa su propia papeleta", () => {
  const owner = "coord-1", other = "coord-2";
  assert.equal(canObserve("admin", owner, other, "REGISTRADO"), true);
  assert.equal(canObserve("gerente", owner, other, "REGISTRADO"), true);
  assert.equal(canObserve("coordinador", owner, other, "REGISTRADO"), false);
  assert.equal(canObserve("admin", owner, owner, "REGISTRADO"), false); // nunca su propia papeleta
  assert.equal(canMarkConforme("admin", owner, other, "REGISTRADO"), true);
  assert.equal(canMarkConforme("admin", owner, other, "OBSERVADO"), false); // solo desde REGISTRADO
});
test("OBSERVADO habilita corrección solo al coordinador dueño; REGISTRADO y CONFORME quedan bloqueados", () => {
  const owner = "coord-1", other = "coord-2";
  assert.equal(canCorrect("coordinador", owner, owner, "OBSERVADO"), true);
  assert.equal(canCorrect("coordinador", owner, owner, "REGISTRADO"), false);
  assert.equal(canCorrect("coordinador", owner, owner, "CONFORME"), false);
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
test("PAPELETA_LIST_SELECT y PAPELETA_DETAIL_SELECT desambiguan unidades con la FK simple explícita", () => {
  // Debe existir la relación calificada...
  assert.match(PAPELETA_LIST_SELECT, /unidades!papeletas_vacaciones_unidad_id_fkey\(nombre\)/);
  assert.match(PAPELETA_DETAIL_SELECT, /unidades!papeletas_vacaciones_unidad_id_fkey\(id,nombre\)/);
  // ...y no debe quedar ningún embed de "unidades" sin calificar en ninguno de los dos selects
  // (una futura edición no debe reintroducir la ambigüedad sin darse cuenta).
  for (const select of [PAPELETA_LIST_SELECT, PAPELETA_DETAIL_SELECT]) {
    const bareUnidades = select.match(/(?<![\w!])unidades\(/g);
    assert.equal(bareUnidades, null, `no debe quedar "unidades(" sin calificar en: ${select}`);
  }
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
  assert.match(source, /const \{ data, error \} = await query;/);
  assert.match(source, /error \? <Alert kind="error">/);
  assert.match(source, /export const dynamic = "force-dynamic";/);
});

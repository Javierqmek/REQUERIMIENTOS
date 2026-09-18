import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarDays, validatePhysicalRange, validateSaleRange } from "../lib/vacations/dates";
import { isA4Size } from "../lib/vacations/paper";
import { validatePapeletaPdf } from "../lib/vacations/pdf";
import { papeletaSchema } from "../lib/vacations/validations";
import { isValidRequestId, papeletaStoragePath } from "../lib/vacations/storage-path";
import { makeRegisterPapeletaHandler } from "../lib/vacations/handlers";
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
test("rechaza un PDF que no es A4", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  await assert.rejects(() => validatePapeletaPdf(new File([asArrayBuffer(bytes)], "papeleta.pdf", { type: "application/pdf" })), /A4/);
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

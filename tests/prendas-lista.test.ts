import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCatalogRows, parseCatalogQuery } from "../lib/admin/maintenance";
import { prendasFilterArgs, prendasFilterParams, type PrendasFilters } from "../lib/admin/prendas-filters";
import { getPrendasExport } from "../lib/admin/prendas-export";

const UUID = "11111111-1111-4111-8111-111111111111";
const none: PrendasFilters = { q: "", cliente: "", sinAsignar: "", puesto: "", genero: "", renovacion: "", almacen: "", estado: "activas" };
function fakeDb() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: name === "admin_exportar_prendas" ? [] : { rows: [], total: 0, almacenes: ["EPP"] }, error: null }; } } as unknown as SupabaseClient;
  return { db, calls };
}

test("la consulta de prendas trae Activas por defecto y todos los filtros opcionales", () => {
  const q = parseCatalogQuery(new URLSearchParams({ catalogo: "prendas" }));
  assert.equal(q.estado, "activas");
  assert.deepEqual([q.q, q.cliente, q.sinAsignar, q.puesto, q.genero, q.renovacion, q.almacen], ["", "", "", "", "", "", ""]);
  const full = parseCatalogQuery(new URLSearchParams({ catalogo: "prendas", q: " chaleco ", cliente: UUID, puesto: UUID, genero: "MUJER", renovacion: "INVIERNO", almacen: "UNF1", estado: "todas", sinAsignar: "1" }));
  assert.deepEqual([full.q, full.cliente, full.puesto, full.genero, full.renovacion, full.almacen, full.estado, full.sinAsignar], ["chaleco", UUID, UUID, "MUJER", "INVIERNO", "UNF1", "todas", "1"]);
});
test("filtros inválidos se rechazan", () => {
  for (const bad of ([{ estado: "borradas" }, { genero: "X" }, { renovacion: "PRIMAVERA" }, { cliente: "no-uuid" }, { sinAsignar: "2" }, { almacen: "x".repeat(81) }] as Record<string, string>[])) {
    assert.throws(() => parseCatalogQuery(new URLSearchParams({ catalogo: "prendas", ...bad })), Object.keys(bad)[0]);
  }
});
test("la lista de prendas usa admin_listar_prendas (incluye las sin asignar) con los filtros y devuelve los almacenes", async () => {
  const { db, calls } = fakeDb();
  const result = await getCatalogRows(db, parseCatalogQuery(new URLSearchParams({ catalogo: "prendas", q: "arbol", sinAsignar: "1", estado: "todas", page: "2" })));
  assert.equal(calls[0].name, "admin_listar_prendas");
  assert.deepEqual(calls[0].args, { p_busqueda: "arbol", p_cliente_id: null, p_sin_asignar: true, p_puesto_id: null, p_genero: null, p_renovacion: null, p_almacen: null, p_estado: "todas", p_limite: 50, p_offset: 50 });
  assert.deepEqual(result.almacenes, ["EPP"]);
  assert.equal(result.page, 2);
});
test("los demás catálogos siguen usando admin_listar_catalogo", async () => {
  const { db, calls } = fakeDb();
  await getCatalogRows(db, parseCatalogQuery(new URLSearchParams({ catalogo: "clientes", q: "ren" })));
  assert.equal(calls[0].name, "admin_listar_catalogo");
});
test("argumentos y parámetros de URL de los filtros (lista y exportación comparten la misma conversión)", () => {
  const f: PrendasFilters = { q: "camisa", cliente: UUID, sinAsignar: "", puesto: UUID, genero: "HOMBRE", renovacion: "AMBOS", almacen: "UNF1", estado: "inactivas" };
  assert.deepEqual(prendasFilterArgs(f), { p_busqueda: "camisa", p_cliente_id: UUID, p_sin_asignar: false, p_puesto_id: UUID, p_genero: "HOMBRE", p_renovacion: "AMBOS", p_almacen: "UNF1", p_estado: "inactivas" });
  assert.deepEqual(Object.fromEntries(prendasFilterParams(f)), { q: "camisa", cliente: UUID, puesto: UUID, genero: "HOMBRE", renovacion: "AMBOS", almacen: "UNF1", estado: "inactivas" });
  assert.equal(prendasFilterParams(none).toString(), "estado=activas");
  assert.equal(prendasFilterParams({ ...none, sinAsignar: "1", estado: "todas" }).toString(), "sinAsignar=1&estado=todas");
});
test("la exportación envía los mismos filtros a la RPC", async () => {
  const { db, calls } = fakeDb();
  await getPrendasExport(db, { ...none, sinAsignar: "1", estado: "todas" });
  assert.equal(calls[0].name, "admin_exportar_prendas");
  assert.deepEqual(calls[0].args, { p_busqueda: null, p_cliente_id: null, p_sin_asignar: true, p_puesto_id: null, p_genero: null, p_renovacion: null, p_almacen: null, p_estado: "todas" });
});
test("la ruta de exportación sin estado exporta todas (activas e inactivas); la pantalla manda el estado elegido", async () => {
  const route = await readFile("app/api/admin/prendas/exportar/route.ts", "utf8");
  assert.match(route, /estado: z\.enum\(PRENDA_ESTADOS\)\.default\("todas"\)/);
  assert.match(route, /esAdminUniformes/);
});
test("el error de código repetido trae el id de la ficha existente y la pantalla ofrece abrirla", async () => {
  const route = await readFile("app/api/admin/catalogos/route.ts", "utf8");
  assert.match(route, /existing_id/);
  const dialog = await readFile("components/admin-catalog-dialog.tsx", "utf8");
  assert.match(dialog, /Abrir prenda existente/);
  const sql = await readFile("supabase/migrations/202611120001_prendas_lista_filtros.sql", "utf8");
  assert.match(sql, /using errcode='23505',detail=v_prenda_id::text/);
});

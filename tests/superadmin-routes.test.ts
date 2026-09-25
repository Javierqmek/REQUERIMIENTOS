import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { esAdminUniformes } from "../lib/roles";

test("esAdminUniformes: solo admin y superadmin, ningún otro rol", () => {
  assert.equal(esAdminUniformes("admin"), true);
  assert.equal(esAdminUniformes("superadmin"), true);
  for (const role of ["coordinador", "gerente", "capacitador", "agente", null, undefined] as const) {
    assert.equal(esAdminUniformes(role), false, `${role} no debería contar como admin de uniformes`);
  }
});

// Las páginas server component no son fácilmente inyectables (getCurrentProfile() no recibe
// dependencias, a diferencia de lib/vacations/handlers.ts) -- por eso, además de la revisión de
// código, se confirma aquí por el TEXTO FUENTE que cada guard sigue existiendo y sigue excluyendo
// a admin: el verdadero límite de seguridad es RLS/RPC (ver supabase/tests/superadmin-split.sql,
// que sí ejecuta las políticas reales contra Postgres), esto es una red de reaseguro contra que
// alguien borre un guard de ruta sin darse cuenta.
function leer(ruta: string) { return readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8"); }

test("Inicio: admin no ve la tarjeta de Documentos (solo uniformes)", () => {
  const inicio = leer("app/(private)/inicio/page.tsx");
  assert.match(inicio, /role\s*===\s*"admin"\s*\n?\s*\?\s*uniformOptions/);
});

test("ruta: /documentos (y todo lo anidado, incluida Vacaciones) redirige a admin fuera", () => {
  const layout = leer("app/(private)/documentos/layout.tsx");
  assert.match(layout, /role\s*===\s*"admin"/);
  assert.match(layout, /redirect\(/);
});

test("ruta: /capacitaciones/gestion/agentes exige superadmin", () => {
  const page = leer("app/capacitaciones/gestion/agentes/page.tsx");
  assert.match(page, /role\s*!==\s*"superadmin"/);
  assert.match(page, /redirect\(/);
});

test("ruta: /capacitaciones/gestion (y sub-páginas) exige superadmin o capacitador, nunca admin solo", () => {
  for (const ruta of ["app/capacitaciones/gestion/nueva/page.tsx", "app/capacitaciones/gestion/[id]/page.tsx", "app/capacitaciones/gestion/[id]/reporte/page.tsx"]) {
    const page = leer(ruta);
    assert.match(page, /role\s*!==\s*"superadmin"/);
    assert.doesNotMatch(page, /role\s*!==\s*"admin"/);
  }
});

test("lib/capacitaciones/auth.ts: la whitelist ya no incluye \"admin\" (solo superadmin)", () => {
  const auth = leer("lib/capacitaciones/auth.ts");
  assert.match(auth, /\["superadmin",\s*"agente",\s*"capacitador"\]/);
  assert.doesNotMatch(auth, /\["admin",\s*"agente",\s*"capacitador"\]/);
});

test("API /api/capacitaciones/agentes/[id]/desvincular exige superadmin (403 para cualquier otro rol)", () => {
  const route = leer("app/api/capacitaciones/agentes/[id]/desvincular/route.ts");
  assert.match(route, /role\s*!==\s*"superadmin"/);
  assert.match(route, /403/);
});

test("API de gestión de capacitaciones (crear/publicar/preguntas/asignación/nota mínima/subir) exige superadmin, no admin", () => {
  for (const ruta of [
    "app/api/capacitaciones/route.ts",
    "app/api/capacitaciones/[id]/publicar/route.ts",
    "app/api/capacitaciones/[id]/asignacion/route.ts",
    "app/api/capacitaciones/[id]/nota-minima/route.ts",
    "app/api/capacitaciones/[id]/preguntas/route.ts",
    "app/api/capacitaciones/[id]/subir/route.ts",
    "app/api/capacitaciones/[id]/video-youtube/route.ts",
  ]) {
    const route = leer(ruta);
    assert.match(route, /role\s*!==\s*"superadmin"/, `${ruta} debería exigir superadmin`);
  }
});

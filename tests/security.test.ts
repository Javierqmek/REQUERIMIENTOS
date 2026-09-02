import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import type { createServerClient } from "@supabase/ssr";
import { csvCell } from "../lib/admin/csv";
import { contentSecurityPolicy } from "../lib/security/headers";
import { assertSameOrigin, readJsonBody, HttpInputError } from "../lib/security/http";
import { updateSession } from "../lib/supabase/middleware";
import { buildSidigeWorkbook } from "../lib/admin/workbook";
import { fixtureRequirement } from "./fixtures/admin";

for (const value of ["=1+1","+SUM(1)","-1+cmd","@SUM(A1)","  =HYPERLINK(1)","\t=1","\r=1","\n+1","＝1"]) test("CSV neutraliza " + JSON.stringify(value), () => {
  assert.ok(csvCell(value).startsWith(`"'`));
});
test("CSV conserva números y escapa comillas/separadores", () => {
  assert.equal(csvCell(12.5), '"12.5"'); assert.equal(csvCell(-2), '"-2"');
  assert.equal(csvCell('A;"B"'), '"A;""B"""');
});
test("XLSX no crea fórmulas para = + - @", async () => {
  for (const value of ["=HYPERLINK(\"https://evil.test\")","+1","-1","@SUM(A1)"]) {
    const row = fixtureRequirement(); row.detalle_requerimiento[0].prendas!.codigo_prenda = value;
    async function* rows() { yield row; }
    const bytes = await buildSidigeWorkbook(rows());
    const book = new ExcelJS.Workbook(); await book.xlsx.load(new Uint8Array(bytes).buffer);
    assert.equal(book.worksheets[0].getCell("G2").type, ExcelJS.ValueType.String);
    assert.equal(book.worksheets[0].getCell("G2").formula, undefined);
    assert.equal(book.worksheets[0].getCell("G2").value, value);
  }
});
test("rechaza CSRF cross-origin y permite mismo origen", () => {
  assert.throws(() => assertSameOrigin(new Request("https://app.test/api/x", { method:"PATCH", headers:{ origin:"https://evil.test" } })), HttpInputError);
  assert.doesNotThrow(() => assertSameOrigin(new Request("https://app.test/api/x", { method:"PATCH", headers:{ origin:"https://app.test" } })));
});
test("JSON acotado incluso sin Content-Length", async () => {
  await assert.rejects(readJsonBody(new Request("https://app.test", { method:"POST", body:JSON.stringify({ text:"x".repeat(2000) }) }), 1024), (e: unknown) => e instanceof HttpInputError && e.status===413);
  await assert.rejects(readJsonBody(new Request("https://app.test", { method:"POST", body:"{" })), (e: unknown) => e instanceof HttpInputError && e.status===400);
});
test("CSP producción restringe scripts y conexión a Supabase concreto", () => {
  const csp = contentSecurityPolicy("testNonce", "https://example.supabase.co", true);
  assert.match(csp,/nonce-testNonce/); assert.match(csp,/frame-ancestors 'none'/);
  assert.ok(!csp.includes("unsafe-eval")); assert.ok(!csp.includes("https:;"));
});
function sessionFactory(user: boolean, role = "coordinador", refresh = false): typeof createServerClient {
  return ((_url: string,_key: string,options: { cookies: { setAll: (cookies: unknown[]) => void } }) => ({
    auth: { getUser: async () => {
      if (refresh) options.cookies.setAll([{ name:"sb-test",value:"refreshed",options:{ path:"/",httpOnly:false,sameSite:"lax" } }]);
      return { data:{ user:user ? { id:"user",user_metadata:{ role:"admin" } } : null },error:null };
    } },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data:role ? { role } : null }) }) }) }),
  })) as unknown as typeof createServerClient;
}
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
for (const path of ["/","/inicio","/requerimientos","/requerimientos/other/editar","/admin/requerimientos"]) test("sin sesión no accede a " + path, async () => {
  const response = await updateSession(new NextRequest("https://app.test"+path), sessionFactory(false));
  assert.equal(response.status,307); assert.equal(response.headers.get("location"),"https://app.test/login");
  assert.match(response.headers.get("cache-control")!,/no-store/);
});
test("API sin sesión devuelve 401 JSON, no HTML de login", async () => {
  const response = await updateSession(new NextRequest("https://app.test/api/admin/requerimientos/sidige"), sessionFactory(false));
  assert.equal(response.status,401); assert.match(response.headers.get("content-type")!,/json/);
});
test("redirect conserva cookies renovadas y CSP no reutiliza nonce", async () => {
  const a = await updateSession(new NextRequest("https://app.test/login"),sessionFactory(true,"coordinador",true));
  const b = await updateSession(new NextRequest("https://app.test/login"),sessionFactory(true));
  assert.equal(a.headers.get("location"),"https://app.test/inicio");
  assert.equal(a.cookies.get("sb-test")?.value,"refreshed");
  assert.notEqual(a.headers.get("content-security-policy"),b.headers.get("content-security-policy"));
});
test("perfil ausente o rol inventado no causa bucle login/inicio", async () => {
  for (const role of ["","inventado"]) {
    const response = await updateSession(new NextRequest("https://app.test/login"),sessionFactory(true,role));
    assert.equal(response.status,200); assert.equal(response.headers.get("location"),null);
  }
});

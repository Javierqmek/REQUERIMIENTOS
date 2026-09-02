// Requiere next start local en 3107. No hace peticiones al Supabase remoto.
import assert from "node:assert/strict";
const base = "http://127.0.0.1:3107";
const login = await fetch(base+"/login");
assert.equal(login.status,200);
const csp = login.headers.get("content-security-policy");
const nonce = csp.match(/'nonce-([^']+)'/)[1];
const html = await login.text();
assert.ok(html.includes('nonce="'+nonce+'"'));
assert.match(csp,/frame-ancestors 'none'/);
assert.ok(!csp.includes("unsafe-eval"));
assert.match(login.headers.get("cache-control"),/no-store/);
for (const name of ["x-content-type-options","referrer-policy","permissions-policy","strict-transport-security"]) assert.ok(login.headers.get(name),name);
for (const path of ["/","/inicio","/requerimientos","/admin/requerimientos","/requerimientos/00000000-0000-4000-8000-000000000001/editar"]) {
  const result = await fetch(base+path,{ redirect:"manual",headers:{"x-middleware-subrequest":"proxy:proxy:proxy","x-role":"admin","cookie":"role=admin"} });
  assert.equal(result.status,307); assert.equal(new URL(result.headers.get("location"),base).pathname,"/login");
}
for (const path of ["/api/admin/requerimientos","/api/admin/requerimientos/csv","/api/admin/requerimientos/sidige","/api/requerimientos/00000000-0000-4000-8000-000000000001/prendas"]) {
  const result = await fetch(base+path,{ redirect:"manual" }); assert.equal(result.status,401);
  assert.match(result.headers.get("content-type"),/application\/json/);
}
const csrf = await fetch(base+"/api/admin/requerimientos",{ method:"PATCH",headers:{ origin:"https://evil.test" },body:"{}" });
assert.equal(csrf.status,403);
console.log("PASS: Next production HTML/nonces/headers, private pages, spoofed headers, anonymous APIs and CSRF.");

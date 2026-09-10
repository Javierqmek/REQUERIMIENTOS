// Servidor de pruebas aislado. No importa Auth ni conecta a Supabase.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { fixtureRequirement, IDS } from "../fixtures/admin";
import { EMPTY_FILTERS, parseAdminQuery } from "../../lib/admin/filters";
import { buildSidigeWorkbook, sidigeFilename } from "../../lib/admin/workbook";
import { SidigeValidationError } from "../../lib/admin/sidige";
import type { AdminFilters } from "../../lib/admin/filters";
import type { AdminOptions, SidigeRequirement } from "../../lib/admin/types";
import type { Estado } from "../../lib/types";
import { editGarments } from "../fixtures/edit";

const options: AdminOptions = {
  clientes: [{ id: IDS.cliente, nombre: "RENIEC" }, { id: "55000000-0000-4000-8000-000000000002", nombre: "CLIENTE CON NOMBRE CORPORATIVO EXTENSO" }],
  unidades: [{ id: IDS.unidad, cliente_id: IDS.cliente, nombre: "OFICINA REGISTRAL ATE" }, { id: "66000000-0000-4000-8000-000000000002", cliente_id: "55000000-0000-4000-8000-000000000002", nombre: "SEDE OPERACIONAL CON NOMBRE EXTENSO – LIMA" }],
  coordinadores: [{ id: IDS.coordinador, nombre: "Javier Quispe", email: "qa@example.test" }],
};
const records = Array.from({ length: 62 }, (_, index) => {
  const other = index % 3 === 1;
  return fixtureRequirement({
    id: "44000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"),
    cliente_id: options.clientes[other ? 1 : 0].id, unidad_id: options.unidades[other ? 1 : 0].id,
    clientes: { nombre: options.clientes[other ? 1 : 0].nombre }, unidades: { nombre: options.unidades[other ? 1 : 0].nombre },
    personal: { cargo: "AGENTE", nombre: index === 0 ? "RAMÍREZ RIVERA JERY" : index === 1 ? "MARÍA DE LOS ÁNGELES FERNÁNDEZ DEL CASTILLO" : "AGENTE OPERATIVO " + (index + 1), dni: "071389725" },
    estado: (["Pendiente", "Atendido", "Observado"] as Estado[])[index % 3],
  });
});
function filtered(filters: AdminFilters) {
  if (filters.q === "sesion") return [fixtureRequirement()];
  if (filters.q === "incompleto") return [fixtureRequirement({ unidades: null })];
  return records.filter(row => (!filters.cliente || row.cliente_id === filters.cliente) && (!filters.unidad || row.unidad_id === filters.unidad) &&
    (!filters.coordinador || row.usuario_creador_id === filters.coordinador) && (!filters.estado || row.estado === filters.estado) &&
    (!filters.q || [row.personal?.nombre, row.personal?.dni, row.clientes?.nombre, row.unidades?.nombre, row.profiles?.nombre].join(" ").toLowerCase().includes(filters.q.toLowerCase())));
}
function pageData(filters: AdminFilters, page: number) {
  const rows = filtered(filters);
  return { total: rows.length, page, pageSize: 50, rows: rows.slice((page - 1) * 50, page * 50).map(row => {
    const { detalle_requerimiento, ...compact } = row; void detalle_requerimiento; return compact;
  }) };
}
async function* groups(rows: SidigeRequirement[]) { yield* rows; }
async function main() {
  const js = await build({
    entryPoints: ["tests/visual/entry.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    plugins: [{ name: "isolated-test-adapters", setup(builder) {
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: "test-adapter" }));
      builder.onResolve({ filter: /lib\/supabase\/client$/ }, () => ({ path: "supabase", namespace: "test-adapter" }));
      builder.onLoad({ filter: /.*/, namespace: "test-adapter" }, args => ({
        contents: args.path === "next/link" ? 'import React from "react"; export default function Link(p){return React.createElement("a",p)}' :
          args.path === "next/navigation" ? 'export const usePathname=()=>window.location.pathname; export const useRouter=()=>({replace(){},refresh(){}});' :
          `const catalogs=${JSON.stringify({
            clientes: [{ id: IDS.cliente, nombre: "RENIEC", activo: true }],
            unidades: [{ id: IDS.unidad, cliente_id: IDS.cliente, nombre: "OFICINA REGISTRAL ATE", activo: true }],
            prendas: editGarments,
          })}; const agents=[{id:"22000000-0000-4000-8000-000000000001",codigo_personal:"PER-001",nombre:"MARÍA AGENTE OPERATIVA",dni:"12345678",cargo:"AGENTE",activo:true}];
          export const createClient=()=>({auth:{signOut:async()=>({})},rpc(name){const result=name==="buscar_personal"?{data:agents,error:null}:{data:"44000000-0000-4000-8000-000000000099",error:null};const chain={select(){return chain},async abortSignal(){await new Promise(r=>setTimeout(r,80));return result},then(resolve,reject){return Promise.resolve(result).then(resolve,reject)}};return chain},from(table){let rows=[...(catalogs[table]||[])];const chain={select(){return chain},eq(column,value){rows=rows.filter(row=>row[column]===value);return chain},in(column,values){rows=rows.filter(row=>values.includes(row[column]));return chain},order(){return chain},range(from,to){rows=rows.slice(from,to+1);return chain},async abortSignal(){await new Promise(r=>setTimeout(r,80));return {data:rows,error:null}}};return chain}});`, loader: "js", resolveDir: process.cwd(),
      }));
    } }],
  });
  const css = await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1:3099");
      const sendJson = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
      if (url.pathname === "/test.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(js.outputFiles[0].text); return; }
      if (url.pathname === "/test.css") { res.writeHead(200, { "Content-Type": "text/css" }); res.end(css.css); return; }
      if (req.method === "PATCH") {
        if (url.pathname.endsWith("/prendas")) { await delay(700); sendJson({ message: "Prendas actualizadas correctamente." }); return; }
        let body = ""; for await (const chunk of req) body += chunk.toString();
        const update = JSON.parse(body); const row = records.find(r => r.id === update.id);
        if (row) row.estado = update.estado;
        await delay(300); sendJson({ id: row?.id, estado: row?.estado }); return;
      }
      const { filters, page } = parseAdminQuery(url.searchParams);
      if (url.pathname.startsWith("/api/")) {
        await delay(400);
        if (filters.q === "sesion" && url.pathname.endsWith("/sidige")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<html>Login</html>"); return; }
        if (filters.q === "error") { sendJson({ error: "Error simulado de consulta. Intenta nuevamente." }, 500); return; }
        if (url.pathname.endsWith("/sidige")) {
          try {
            const bytes = await buildSidigeWorkbook(groups(filtered(filters)));
            res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="' + sidigeFilename() + '"' }); res.end(bytes);
          } catch (error) {
            sendJson(error instanceof SidigeValidationError ? { error: error.message, issues: error.issues, totalIncomplete: error.total } : { error: "No hay requerimientos para exportar con los filtros seleccionados." }, 422);
          }
          return;
        }
        sendJson(pageData(filters, page)); return;
      }
      const fixture = { initial: pageData(filters, page), options, initialFilters: { ...EMPTY_FILTERS, ...filters } };
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"/><title>QA Administración · Datos ficticios</title><link rel="stylesheet" href="/test.css"/></head><body><div id="root"></div><script>window.__ADMIN_FIXTURE__=' + JSON.stringify(fixture).replaceAll("<", "\\u003c") + '</script><script src="/test.js"></script></body></html>');
    } catch { res.writeHead(500); res.end("Error en servidor de pruebas"); }
  });
  server.listen(3099, "127.0.0.1", () => console.log("QA visual aislado: http://127.0.0.1:3099"));
}
void main();

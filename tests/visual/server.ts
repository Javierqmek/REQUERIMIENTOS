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
import { parseRequirementQuery, type RequirementFilters } from "../../lib/requirements/list-filters";
import { editGarments } from "../fixtures/edit";
import { PDFDocument } from "pdf-lib";
import { makeCorporateStamp } from "../../lib/documents/security";

const options: AdminOptions = {
  clientes: [{ id: IDS.cliente, nombre: "RENIEC" }, { id: "55000000-0000-4000-8000-000000000002", nombre: "CLIENTE CON NOMBRE CORPORATIVO EXTENSO" }],
  unidades: [{ id: IDS.unidad, cliente_id: IDS.cliente, nombre: "OFICINA REGISTRAL ATE" }, { id: "66000000-0000-4000-8000-000000000002", cliente_id: "55000000-0000-4000-8000-000000000002", nombre: "SEDE OPERACIONAL CON NOMBRE EXTENSO – LIMA" }],
  coordinadores: [{ id: IDS.coordinador, nombre: "Javier Quispe", email: "qa@example.test" }],
};
const initialRecords = Array.from({ length: 62 }, (_, index) => {
  const other = index % 3 === 1;
  return fixtureRequirement({
    id: "44000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"),
    cliente_id: options.clientes[other ? 1 : 0].id, unidad_id: options.unidades[other ? 1 : 0].id,
    clientes: { nombre: options.clientes[other ? 1 : 0].nombre }, unidades: { nombre: options.unidades[other ? 1 : 0].nombre },
    personal: { cargo: "AGENTE", nombre: index === 0 ? "RAMÍREZ RIVERA JERY" : index === 1 ? "MARÍA DE LOS ÁNGELES FERNÁNDEZ DEL CASTILLO" : "AGENTE OPERATIVO " + (index + 1), dni: "071389725" },
    estado: (["Pendiente", "Atendido", "Observado"] as Estado[])[index % 3],
    cantidad_prendas: index % 4 + 1, unidades_totales: index % 4 + 3,
    generos: [["HOMBRE"],["MUJER"],["AMBOS"]][index % 3] as ("HOMBRE"|"MUJER"|"AMBOS")[],
  });
});
const initialCatalogRows = {
  clientes: options.clientes.map((row,index)=>({...row,activo:index===0})),
  unidades: options.unidades.map((row,index)=>({...row,clientes:{nombre:options.clientes[index].nombre},activo:index===0})),
  personal: [{id:"22000000-0000-4000-8000-000000000001",codigo_personal:"PER-001",nombre:"MARÍA DE LOS ÁNGELES FERNÁNDEZ",dni:"12345678",cargo:"AGENTE OPERATIVO",activo:true}],
  prendas: editGarments.map((row,index)=>({...row,activo:index!==1})),
  provincias: [{id:"aa100000-0000-4000-8000-000000000001",nombre:"Lima",activo:true},{id:"aa100000-0000-4000-8000-000000000002",nombre:"Arequipa",activo:true}],
};
const recordsByProject=new Map<string,typeof initialRecords>();
function recordsFor(project:string){let rows=recordsByProject.get(project);if(!rows){rows=initialRecords.map(row=>({...row}));recordsByProject.set(project,rows)}return rows}
type CatalogRows=typeof initialCatalogRows;
const catalogRowsByProject=new Map<string,CatalogRows>();
function catalogsFor(project:string){let rows=catalogRowsByProject.get(project);if(!rows){rows={clientes:initialCatalogRows.clientes.map(row=>({...row})),unidades:initialCatalogRows.unidades.map(row=>({...row,clientes:{...row.clientes}})),personal:initialCatalogRows.personal.map(row=>({...row})),prendas:initialCatalogRows.prendas.map(row=>({...row})),provincias:initialCatalogRows.provincias.map(row=>({...row}))};catalogRowsByProject.set(project,rows)}return rows}
let catalogSequence=100;
function catalogId(){catalogSequence++;return "99000000-0000-4000-8000-"+String(catalogSequence).padStart(12,"0")}
type VisualFilters = Partial<AdminFilters & RequirementFilters>;
function filtered(filters: VisualFilters,records=initialRecords) {
  if (filters.q === "sesion") return [fixtureRequirement()];
  if (filters.q === "incompleto") return [fixtureRequirement({ unidades: null })];
  return records.filter(row => (!filters.cliente || row.cliente_id === filters.cliente) && (!filters.unidad || row.unidad_id === filters.unidad) &&
    (!filters.coordinador || row.usuario_creador_id === filters.coordinador) && (!filters.estado || row.estado === filters.estado) &&
    (!filters.genero || (filters.genero==="AMBOS"?row.generos?.includes("AMBOS"):row.generos?.some(value=>value===filters.genero||value==="AMBOS"))) &&
    (!filters.prendasMin || row.cantidad_prendas>=Number(filters.prendasMin)) && (!filters.prendasMax || row.cantidad_prendas<=Number(filters.prendasMax)) &&
    (!filters.unidadesMin || row.unidades_totales>=Number(filters.unidadesMin)) && (!filters.unidadesMax || row.unidades_totales<=Number(filters.unidadesMax)) &&
    (!filters.q || [row.personal?.nombre, row.personal?.dni, row.clientes?.nombre, row.unidades?.nombre, row.profiles?.nombre].join(" ").toLowerCase().includes(filters.q.toLowerCase())));
}
function pageData(filters: VisualFilters, page: number,records=initialRecords) {
  const rows = filtered(filters,records);
  return { total: rows.length, duplicateTotal: 0, duplicateGroups: 0, page, pageSize: 50, rows: rows.slice((page - 1) * 50, page * 50).map(row => {
    const { detalle_requerimiento, ...compact } = row; void detalle_requerimiento; return compact;
  }) };
}
async function* groups(rows: SidigeRequirement[]) { yield* rows; }
async function main() {
  const testPdf=await PDFDocument.create();testPdf.addPage([595,842]);testPdf.addPage([595,842]);testPdf.addPage([595,842]);const testPdfBytes=await testPdf.save();const testStamp=await makeCorporateStamp("Gerente Seguroc","Gerente");
  const js = await build({
    entryPoints: ["tests/visual/entry.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", target: ["chrome109","edge109","firefox115","safari15.6"],
    plugins: [{ name: "isolated-test-adapters", setup(builder) {
      builder.onResolve({ filter: /^next\/(link|navigation|image)$/ }, args => ({ path: args.path, namespace: "test-adapter" }));
      builder.onResolve({ filter: /^pdfjs-dist(?:\/legacy\/build\/pdf\.mjs)?$/ }, () => ({ path: "pdfjs-dist", namespace: "test-adapter" }));
      builder.onResolve({ filter: /lib\/supabase\/client$/ }, () => ({ path: "supabase", namespace: "test-adapter" }));
      builder.onLoad({ filter: /.*/, namespace: "test-adapter" }, args => ({
        contents: args.path === "pdfjs-dist" ? 'export const GlobalWorkerOptions={workerSrc:"/test-worker.mjs"};export const getDocument=()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getViewport:({scale})=>{const nonA4=new URLSearchParams(window.location.search).get("nonA4")==="1";const w=nonA4?612:595,h=nonA4?792:842;return {width:w*scale,height:h*scale}},render:({canvasContext})=>{const c=canvasContext.canvas;canvasContext.fillStyle="#174EA6";canvasContext.fillRect(0,0,c.width,c.height);return {promise:Promise.resolve()}}})})});' :
          args.path === "next/link" ? 'import React from "react"; export default function Link(p){return React.createElement("a",p)}' :
          args.path === "next/image" ? 'import React from "react"; export default function Image({fill,unoptimized,...p}){void fill;void unoptimized;return React.createElement("img",p)}' :
          args.path === "next/navigation" ? 'export const usePathname=()=>window.location.pathname; export const useRouter=()=>({replace(){},refresh(){}});' :
          `const catalogs=${JSON.stringify({
            clientes: [{ id: IDS.cliente, nombre: "RENIEC", activo: true }],
            unidades: [{ id: IDS.unidad, cliente_id: IDS.cliente, nombre: "OFICINA REGISTRAL ATE", activo: true }],
            prendas: editGarments,
            provincias: [{ id: "aa100000-0000-4000-8000-000000000001", nombre: "AREQUIPA", activo: true }, { id: "aa100000-0000-4000-8000-000000000002", nombre: "CUSCO", activo: true }],
          })}; const agents=[{id:"22000000-0000-4000-8000-000000000001",codigo_personal:"PER-001",nombre:"MARÍA AGENTE OPERATIVA",dni:"12345678",cargo:"AGENTE",activo:true},{id:"22000000-0000-4000-8000-000000000002",codigo_personal:"PER-002",nombre:"CARLOS REEMPLAZO OPERATIVO",dni:"87654321",cargo:"AGENTE",activo:true}];
          export const createClient=()=>({auth:{signOut:async()=>({})},rpc(name){const result=name==="buscar_personal"?{data:agents,error:null}:{data:"44000000-0000-4000-8000-000000000099",error:null};const chain={select(){return chain},async abortSignal(){await new Promise(r=>setTimeout(r,80));return result},then(resolve,reject){return Promise.resolve(result).then(resolve,reject)}};return chain},from(table){let rows=[...(table==="papeletas_vacaciones"?[{id:"aa000000-0000-4000-8000-000000000099"}]:(table==="provincias"&&new URLSearchParams(window.location.search).get("sinProvincias")==="1")?[]:(catalogs[table]||[]))];const chain={select(){return chain},eq(column,value){rows=rows.filter(row=>row[column]===value);return chain},in(column,values){rows=rows.filter(row=>values.includes(row[column]));return chain},order(){return chain},range(from,to){rows=rows.slice(from,to+1);return chain},async abortSignal(){await new Promise(r=>setTimeout(r,80));return {data:rows,error:null}},async maybeSingle(){await new Promise(r=>setTimeout(r,20));return {data:rows[0]??null,error:null}}};return chain}});`, loader: "js", resolveDir: process.cwd(),
      }));
    } }],
  });
  const css = await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1:3099");
      const project=String(req.headers["x-qa-project"]||"default"),records=recordsFor(project),catalogRows=catalogsFor(project);
      const sendJson = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
      if (url.pathname === "/test.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(js.outputFiles[0].text); return; }
      if (url.pathname === "/test.css") { res.writeHead(200, { "Content-Type": "text/css" }); res.end(css.css); return; }
      if (url.pathname.startsWith("/api/documentos/") && url.pathname.endsWith("/archivo")) { res.writeHead(200, { "Content-Type": "application/pdf" }); res.end(testPdfBytes); return; }
      if (url.pathname.startsWith("/api/documentos/") && url.pathname.endsWith("/preview") && req.method === "POST") { res.writeHead(200, { "Content-Type": "application/pdf", "Cache-Control":"private, no-store" }); res.end(testPdfBytes); return; }
      if (url.pathname === "/api/perfil/firma") { res.writeHead(200, { "Content-Type": "image/png" }); res.end(testStamp.bytes); return; }
      if (url.pathname.startsWith("/api/documentos/") && url.pathname.endsWith("/accion") && req.method === "POST") { sendJson({ok:true}); return; }
      if (url.pathname === "/api/documentos/vacaciones" && req.method === "POST") {
        for await (const chunk of req) void chunk; // drena el multipart sin parsearlo: solo se prueba la UI
        await delay(300); sendJson({ id: "aa000000-0000-4000-8000-000000000099" }, 201); return;
      }
      if (/^\/api\/documentos\/vacaciones\/[^/]+\/revisar$/.test(url.pathname) && req.method === "POST") {
        let body=""; for await(const chunk of req) body+=chunk.toString();
        const input=JSON.parse(body||"{}") as { accion?:string; motivo?:string };
        await delay(200);
        if (input.accion==="observar" && !input.motivo?.trim()) { sendJson({ error:"El motivo de observación es obligatorio." },400); return; }
        sendJson({ ok:true }); return;
      }
      if (/^\/api\/documentos\/vacaciones\/[^/]+\/corregir$/.test(url.pathname) && req.method === "POST") {
        for await (const chunk of req) void chunk;
        await delay(300); sendJson({ id: "aa000000-0000-4000-8000-000000000001" }, 200); return;
      }
      if (url.pathname === "/api/admin/requerimientos/eliminar" && req.method === "DELETE") {
        let body=""; for await(const chunk of req) body+=chunk.toString();
        const ids=(JSON.parse(body).ids??[]) as string[];
        for(const id of ids){const index=records.findIndex(row=>row.id===id);if(index>=0)records.splice(index,1)}
        await delay(300); sendJson({eliminados:ids.length}); return;
      }
      if (url.pathname === "/api/admin/importaciones" && req.method === "POST") {
        let body=""; for await(const chunk of req) body+=chunk.toString(); const input=JSON.parse(body);
        await delay(250); sendJson(input.mode==="preview"?{rows:input.rows,issues:[],nuevos:input.rows.length,actualizados:0,omitidos:0,errores:0}:{nuevos:input.rows.length,actualizados:0,omitidos:0,errores:0}); return;
      }
      if (url.pathname === "/api/admin/catalogos") {
        if(req.method!=="GET"){
          let body="";for await(const chunk of req)body+=chunk.toString();const input=JSON.parse(body);
          const kind=input.catalogo as keyof typeof catalogRows,rows=catalogRows[kind] as Record<string,unknown>[];
          if(req.method==="PATCH"){const row=rows.find(item=>item.id===input.id);if(row)row.activo=input.activo;sendJson(row??{error:"Registro no encontrado"},row?200:404);return;}
          if(req.method==="DELETE"){const index=rows.findIndex(item=>item.id===input.id);if(index<0){sendJson({error:"Registro no encontrado"},404);return;}rows.splice(index,1);sendJson({id:input.id,catalogo:kind});return;}
          const values=input.valores as Record<string,unknown>;
          if(kind==="clientes"&&rows.some(row=>String(row.nombre).toLowerCase()===String(values.nombre).toLowerCase()&&row.id!==input.id)){sendJson({error:"Ya existe un cliente con ese nombre"},409);return;}
          if(kind==="provincias"&&rows.some(row=>String(row.nombre).trim().toLowerCase()===String(values.nombre).trim().toLowerCase()&&row.id!==input.id)){sendJson({error:"Ya existe una provincia con ese nombre"},409);return;}
          let row=rows.find(item=>item.id===input.id);
          if(!row){row={id:catalogId(),activo:true};rows.push(row);}
          Object.assign(row,values);
          if(kind==="unidades"){const selected=options.clientes.find(client=>client.id===values.cliente_id);row.clientes={nombre:selected?.nombre??"Cliente nuevo"};}
          if(kind==="prendas"){const selected=options.clientes.find(client=>client.id===values.cliente_id);row.cliente=selected?.nombre??"Cliente nuevo";delete row.cliente_id;}
          sendJson({accion:req.method==="POST"?"crear":"editar",row},req.method==="POST"?201:200);return;
        }
        const kind=(url.searchParams.get("catalogo")||"clientes") as keyof typeof catalogRows;
        let rows=[...catalogRows[kind]] as Record<string,unknown>[]; const q=(url.searchParams.get("q")||"").toLowerCase();
        if(q)rows=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(q)); const client=url.searchParams.get("cliente");
        if(client&&kind==="unidades")rows=rows.filter(row=>row.cliente_id===client);
        if(client&&kind==="prendas")rows=rows.filter(row=>row.cliente===options.clientes.find(c=>c.id===client)?.nombre);
        const gender=url.searchParams.get("genero");if(gender&&kind==="prendas")rows=rows.filter(row=>row.genero===gender);
        if(kind==="clientes"||kind==="unidades")rows=rows.map(row=>({...row,puede_eliminar:!["RENIEC","CLIENTE CON NOMBRE CORPORATIVO EXTENSO","OFICINA REGISTRAL ATE","SEDE OPERACIONAL CON NOMBRE EXTENSO – LIMA"].includes(String(row.nombre)),...(kind==="unidades"?{puede_cambiar_cliente:!String(row.nombre).includes("OFICINA")}: {})}));
        await delay(150);sendJson({rows,total:rows.length,page:Number(url.searchParams.get("page")||1),pageSize:50});return;
      }
      if (req.method === "PATCH") {
        if (url.pathname.endsWith("/prendas")) {
          const id=url.pathname.split("/").at(-2);
          await delay(700);sendJson({data:{requerimiento:{id}}});return;
        }
        let body = ""; for await (const chunk of req) body += chunk.toString();
        const update = JSON.parse(body); const row = records.find(r => r.id === update.id);
        if (row) row.estado = update.estado;
        await delay(300); sendJson({ id: row?.id, estado: row?.estado }); return;
      }
      if (url.pathname === "/api/requerimientos") {
        const parsed=parseRequirementQuery(url.searchParams);await delay(250);sendJson(pageData(parsed.filters,parsed.page,records));return;
      }
      const { filters, page } = parseAdminQuery(url.searchParams);
      if (url.pathname.startsWith("/api/")) {
        await delay(400);
        if (filters.q === "sesion" && url.pathname.endsWith("/sidige")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<html>Login</html>"); return; }
        if (filters.q === "error") { sendJson({ error: "Error simulado de consulta. Intenta nuevamente." }, 500); return; }
        if (url.pathname.endsWith("/sidige")) {
          try {
            const bytes = await buildSidigeWorkbook(groups(filtered(filters,records)));
            res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="' + sidigeFilename() + '"' }); res.end(bytes);
          } catch (error) {
            sendJson(error instanceof SidigeValidationError ? { error: error.message, issues: error.issues, totalIncomplete: error.total } : { error: "No hay requerimientos para exportar con los filtros seleccionados." }, 422);
          }
          return;
        }
        sendJson(pageData(filters, page,records)); return;
      }
      const own=url.pathname==="/requerimientos"?parseRequirementQuery(url.searchParams):null;
      const fixture = { initial: pageData(own?.filters??filters, own?.page??page,records), options, initialFilters: { ...EMPTY_FILTERS, ...filters } };
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"/><title>QA Administración · Datos ficticios</title><link rel="stylesheet" href="/test.css"/></head><body><div id="root"></div><script>window.__ADMIN_FIXTURE__=' + JSON.stringify(fixture).replaceAll("<", "\\u003c") + '</script><script src="/test.js"></script></body></html>');
    } catch { res.writeHead(500); res.end("Error en servidor de pruebas"); }
  });
  server.listen(3099, "127.0.0.1", () => console.log("QA visual aislado: http://127.0.0.1:3099"));
}
void main();

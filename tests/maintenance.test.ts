import assert from "node:assert/strict";
import {test} from "node:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {parseCsv} from "../lib/admin/csv-import";
import {catalogCreateSchema,catalogDeleteSchema,catalogUpdateSchema} from "../lib/admin/maintenance";
import {makeAdminDeleteHandler} from "../lib/admin/handlers";
import type {Profile} from "../lib/types";

const admin:Profile={id:"11000000-0000-4000-8000-000000000001",email:"a@test.local",nombre:"Admin",role:"admin"};
test("CSV respeta comillas, comas y encabezados",()=>{const parsed=parseCsv('codigo_personal,nombre,dni,cargo,activo\nP1,"Pérez, Ana",12345678,Agente,true');assert.equal(parsed.rows[0].nombre,"Pérez, Ana");assert.equal(parsed.headers.length,5)});
test("CSV rechaza filas incompletas y comillas abiertas",()=>{assert.throws(()=>parseCsv("a,b\n1"));assert.throws(()=>parseCsv('a,b\n"1,2'))});
test("endpoint de borrado exige admin y configuración servidor",async()=>{let calls=0;const db={rpc:()=>{calls++;return Promise.resolve({data:1,error:null})}} as unknown as SupabaseClient;const request=()=>new Request("http://localhost/api/admin/requerimientos/eliminar",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:["44000000-0000-4000-8000-000000000001"]})});assert.equal((await makeAdminDeleteHandler({getProfile:async()=>({...admin,role:"coordinador"}),getDb:async()=>db},()=>true)(request())).status,403);assert.equal((await makeAdminDeleteHandler({getProfile:async()=>admin,getDb:async()=>db},()=>false)(request())).status,403);assert.equal(calls,0);const ok=await makeAdminDeleteHandler({getProfile:async()=>admin,getDb:async()=>db},()=>true)(request());assert.equal(ok.status,200);assert.equal((await ok.json()).eliminados,1);assert.equal(calls,1)});
test("CRUD manual valida cliente, unidad, personal y prenda",()=>{
  const client=catalogCreateSchema.parse({catalogo:"clientes",valores:{nombre:"  RENIEC  "}});
  assert.equal(client.catalogo,"clientes");if(client.catalogo==="clientes")assert.equal(client.valores.nombre,"RENIEC");
  assert.throws(()=>catalogCreateSchema.parse({catalogo:"unidades",valores:{cliente_id:"mal",nombre:"Sede"}}));
  assert.throws(()=>catalogCreateSchema.parse({catalogo:"personal",valores:{codigo_personal:"P1",nombre:"Ana",dni:"ABC",cargo:"Agente"}}));
  assert.throws(()=>catalogCreateSchema.parse({catalogo:"prendas",valores:{codigo_prenda:"G1",nombre_prenda:"Camisa",codigo_almacen:"A1",precio:20.555,cantidad:0,cliente_id:"58000000-0000-4000-8000-000000000001",genero:"AMBOS"}}));
});
test("edición y borrado rechazan IDs o campos manipulados",()=>{
  assert.throws(()=>catalogUpdateSchema.parse({catalogo:"clientes",id:"no-uuid",valores:{nombre:"Cliente"}}));
  assert.throws(()=>catalogUpdateSchema.parse({catalogo:"clientes",id:"58000000-0000-4000-8000-000000000001",valores:{nombre:"Cliente",activo:false}}));
  assert.throws(()=>catalogDeleteSchema.parse({catalogo:"personal",id:"58000000-0000-4000-8000-000000000001"}));
});

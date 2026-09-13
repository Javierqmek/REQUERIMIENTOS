import assert from "node:assert/strict";
import {test} from "node:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {parseCsv} from "../lib/admin/csv-import";
import {catalogCreateSchema,catalogDeleteSchema,catalogUpdateSchema,prepareImport} from "../lib/admin/maintenance";
import {makeAdminDeleteHandler} from "../lib/admin/handlers";
import type {Profile} from "../lib/types";

const admin:Profile={id:"11000000-0000-4000-8000-000000000001",email:"a@test.local",nombre:"Admin",role:"admin"};
test("CSV respeta comillas, comas y encabezados",()=>{const parsed=parseCsv('codigo_personal,nombre,dni,cargo,activo\nP1,"Pérez, Ana",12345678,Agente,true');assert.equal(parsed.rows[0].nombre,"Pérez, Ana");assert.equal(parsed.headers.length,5)});
test("CSV rechaza filas incompletas y comillas abiertas",()=>{assert.throws(()=>parseCsv("a,b\n1"));assert.throws(()=>parseCsv('a,b\n"1,2'))});
function validationDb(){return {from:(table:string)=>({select:(column:string)=>({in:(_key:string,values:string[])=>Promise.resolve({data:values.filter(value=>(table==="personal"&&value==="EXISTE")||(table==="clientes"&&value==="RENIEC")).map(value=>({[column]:value})),error:null})})})} as unknown as SupabaseClient}
test("previsualización detecta nuevos, actualizados, duplicados y DNI inválido",async()=>{const {preview}=await prepareImport(validationDb(),{kind:"personal",mode:"preview",headers:["codigo_personal","nombre","dni","cargo","activo"],rows:[{codigo_personal:"EXISTE",nombre:"Uno",dni:"12345678",cargo:"Agente",activo:"true"},{codigo_personal:"NUEVO",nombre:"Dos",dni:"87654321",cargo:"Agente",activo:"sí"},{codigo_personal:"NUEVO",nombre:"Repetido",dni:"87654321",cargo:"Agente",activo:"true"},{codigo_personal:"MAL",nombre:"Tres",dni:"ABC",cargo:"Agente",activo:"true"}]});assert.deepEqual([preview.nuevos,preview.actualizados,preview.omitidos,preview.errores],[1,1,1,1]);assert.equal(preview.rows.length,2)});
test("previsualización de prendas exige cliente, género, precio y cantidad válidos",async()=>{const {preview}=await prepareImport(validationDb(),{kind:"prendas",mode:"preview",headers:["codigo_prenda","nombre_prenda","codigo_almacen","precio","cantidad","cliente","genero","activo"],rows:[{codigo_prenda:"G1",nombre_prenda:"Camisa",codigo_almacen:"A1",precio:"20.50",cantidad:"2",cliente:"RENIEC",genero:"HOMBRE",activo:"true"},{codigo_prenda:"G2",nombre_prenda:"Pantalón",codigo_almacen:"A2",precio:"-1",cantidad:"0",cliente:"OTRO",genero:"X",activo:"true"}]});assert.equal(preview.rows.length,1);assert.equal(preview.errores,1)});
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

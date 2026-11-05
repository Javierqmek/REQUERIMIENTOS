-- Prendas por puesto (cliente BCR) y exportación de prendas, con "set local role authenticated".
--  A. Cliente con puestos (BCR) y cliente sin puestos (RENIEC) en el mismo flujo; la misma prenda en dos puestos con
--     cantidades distintas; AMBOS vs VERANO/INVIERNO solo dentro de cada puesto; puesto obligatorio / prohibido.
--  B. crear_requerimiento y edición validan el puesto; el puesto no cambia después; listados y filtros lo devuelven.
--  C. Importación con y sin la columna puesto.
--  D. Exportar e importar el mismo archivo da 0 cambios.
--  E. Los clientes actuales no se ven afectados.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.denied(command text,code text,label text) returns void language plpgsql as $$
begin
  begin execute command; exception when others then
    if sqlstate=code then raise notice 'PASS: % (rechazado %)',label,code; return; end if;
    raise exception 'FAIL % expected %, got %: %',label,code,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: % fue aceptado', label;
end $$;
create function pg_temp.ver(p uuid) returns text language sql as $$ select public.obtener_edicion_prendas(p)->>'version' $$;
-- Convierte el JSON de la exportación en las filas que recibe la importación (lo que haría la pantalla al leer el CSV).
create function pg_temp.a_importacion(p jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('fila',t.n+1,'codigo_prenda',t.e->>'codigo_prenda','nombre_prenda',t.e->>'nombre_prenda',
    'codigo_almacen',t.e->>'codigo_almacen','precio',(t.e->>'precio')::numeric,'cantidad',(t.e->>'cantidad')::int,'genero',t.e->>'genero',
    'renovacion',t.e->>'renovacion','activo',(t.e->>'activo')::boolean,'puesto',t.e->>'puesto') order by t.n),'[]'::jsonb)
  from jsonb_array_elements(p) with ordinality t(e,n) $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('e1000000-0000-4000-8000-000000000001','admin-pue@example.test','{}'),
 ('e1000000-0000-4000-8000-000000000002','coord-pue@example.test','{}');
update public.profiles set role='admin' where id='e1000000-0000-4000-8000-000000000001';
update public.profiles set role='coordinador' where id='e1000000-0000-4000-8000-000000000002';
insert into public.clientes(id,nombre,activo) values
 ('e2000000-0000-4000-8000-000000000001','RENIEC',true),('e2000000-0000-4000-8000-000000000002','BCR',true),
 ('e2000000-0000-4000-8000-000000000003','OTRO CLIENTE',true);
insert into public.unidades(id,cliente_id,nombre,activo) values
 ('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','RENIEC SEDE',true),
 ('e3000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000002','BCR SEDE',true);
insert into public.personal(id,codigo_personal,nombre,dni,cargo,activo) values
 ('e4000000-0000-4000-8000-000000000001','PUE-1','AGENTE UNO','55555551','AGENTE',true);
select pg_temp.ok((select bool_and(not diferencia_puestos) from public.clientes),'los clientes existentes quedan con diferencia_puestos=false');

\echo '--- E. cliente actual sin puestos: flujo previo intacto ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select public.admin_importar_prendas('e2000000-0000-4000-8000-000000000001',
 '[{"fila":2,"codigo_prenda":"CAM-BL","nombre_prenda":"CAMISA BLANCA MANGA CORTA","codigo_almacen":"UNF1","precio":40,"cantidad":1,"genero":"HOMBRE","renovacion":"AMBOS","activo":true}]',true);
select pg_temp.ok((select count(*)=1 and bool_and(puesto_id is null) from public.prenda_clientes where cliente_id='e2000000-0000-4000-8000-000000000001'),'RENIEC: la asignación importada sin la columna puesto queda con puesto_id nulo');
select pg_temp.denied($q$select public.admin_importar_prendas('e2000000-0000-4000-8000-000000000001','[{"fila":2,"codigo_prenda":"CAM-BL","nombre_prenda":"CAMISA BLANCA MANGA CORTA","codigo_almacen":"UNF1","precio":40,"cantidad":1,"genero":"HOMBRE","renovacion":"AMBOS","activo":true,"puesto":"Vigilante"}]',false)$q$,'22023','cliente sin puestos: la columna puesto con valor es error (importación)');
select pg_temp.ok((select count(*)=1 from public.listar_prendas_cliente('e2000000-0000-4000-8000-000000000001','VERANO')),'RENIEC: listar_prendas_cliente sin puesto sigue funcionando');
select pg_temp.denied($q$select * from public.listar_prendas_cliente('e2000000-0000-4000-8000-000000000001','VERANO',gen_random_uuid())$q$,'22023','RENIEC: pasar un puesto es inválido');

\echo '--- A. cliente con puestos ---'
select public.admin_guardar_catalogo('clientes','e2000000-0000-4000-8000-000000000002','{"nombre":"BCR","diferencia_puestos":true}');
select pg_temp.ok((select diferencia_puestos from public.clientes where id='e2000000-0000-4000-8000-000000000002'),'BCR: "Diferencia prendas por puesto" se activa desde Mantenimiento');
select pg_temp.denied($q$select public.admin_guardar_catalogo('puestos',null,'{"cliente_id":"e2000000-0000-4000-8000-000000000001","nombre":"Vigilante"}')$q$,'22023','un cliente sin la opción no admite puestos');
select public.admin_guardar_catalogo('puestos',null,'{"cliente_id":"e2000000-0000-4000-8000-000000000002","nombre":"Vigilante Masculino"}');
select public.admin_guardar_catalogo('puestos',null,'{"cliente_id":"e2000000-0000-4000-8000-000000000002","nombre":"Vigilante Masculino (Terno)"}');
select public.admin_guardar_catalogo('puestos',null,'{"cliente_id":"e2000000-0000-4000-8000-000000000002","nombre":"Vigilante Femenino"}');
select set_config('qa.pa',(select id::text from public.puestos where nombre='Vigilante Masculino'),true);
select set_config('qa.pb',(select id::text from public.puestos where nombre='Vigilante Masculino (Terno)'),true);
select set_config('qa.pc',(select id::text from public.puestos where nombre='Vigilante Femenino'),true);
select pg_temp.denied($q$select public.admin_guardar_catalogo('puestos',null,'{"cliente_id":"e2000000-0000-4000-8000-000000000002","nombre":"vigilante masculino"}')$q$,'23505','nombre de puesto repetido (sin distinguir mayúsculas) en el mismo cliente');
select pg_temp.ok((public.admin_listar_catalogo('puestos',null,'e2000000-0000-4000-8000-000000000002')->>'total')::int=3
  and (public.admin_listar_catalogo('clientes','BCR')->'rows'->0->>'diferencia_puestos')::boolean,'Mantenimiento lista los puestos del cliente y el campo del cliente');
select pg_temp.denied($q$select public.admin_guardar_catalogo('clientes','e2000000-0000-4000-8000-000000000001','{"nombre":"RENIEC","diferencia_puestos":true}')$q$,'55000','activar la opción con asignaciones vigentes sin puesto se rechaza');

-- Prenda 1: la misma camisa en dos puestos de BCR con distinta cantidad, y sin puesto para RENIEC
select set_config('qa.cam',(select id::text from public.prendas where codigo_prenda='CAM-BL'),true);
select public.admin_guardar_catalogo('prendas',current_setting('qa.cam')::uuid,format($j${"codigo_prenda":"CAM-BL","nombre_prenda":"CAMISA BLANCA MANGA CORTA","codigo_almacen":"UNF1","precio":40,
  "asignaciones":[{"cliente_id":"e2000000-0000-4000-8000-000000000002","puesto_id":"%s","renovacion":"AMBOS","genero":"HOMBRE","cantidad":2,"activo":true},
                  {"cliente_id":"e2000000-0000-4000-8000-000000000002","puesto_id":"%s","renovacion":"AMBOS","genero":"HOMBRE","cantidad":3,"activo":true}]}$j$,
  current_setting('qa.pa'),current_setting('qa.pb'))::jsonb);
select pg_temp.ok((select count(*)=2 from public.prenda_clientes where prenda_id=current_setting('qa.cam')::uuid and cliente_id='e2000000-0000-4000-8000-000000000002'),'la misma prenda queda en dos puestos del mismo cliente');
select pg_temp.denied(format($q$select public.admin_guardar_catalogo('prendas',%L,'{"codigo_prenda":"CAM-BL","nombre_prenda":"CAMISA BLANCA MANGA CORTA","codigo_almacen":"UNF1","precio":40,
  "asignaciones":[{"cliente_id":"e2000000-0000-4000-8000-000000000002","renovacion":"VERANO","genero":"HOMBRE","cantidad":1,"activo":true}]}')$q$,current_setting('qa.cam')),'22023','cliente con puestos: asignación sin puesto rechazada');
select pg_temp.denied(format($q$select public.admin_guardar_catalogo('prendas',%L,'{"codigo_prenda":"CAM-BL","nombre_prenda":"CAMISA BLANCA MANGA CORTA","codigo_almacen":"UNF1","precio":40,
  "asignaciones":[{"cliente_id":"e2000000-0000-4000-8000-000000000001","puesto_id":"%s","renovacion":"VERANO","genero":"HOMBRE","cantidad":1,"activo":true}]}')$q$,current_setting('qa.cam'),current_setting('qa.pa')),'22023','cliente sin puestos: asignación con puesto (de otro cliente) rechazada');
select pg_temp.denied(format($q$select public.admin_guardar_catalogo('prendas',%L,'{"codigo_prenda":"CAM-BL","nombre_prenda":"CAMISA BLANCA MANGA CORTA","codigo_almacen":"UNF1","precio":40,
  "asignaciones":[{"cliente_id":"e2000000-0000-4000-8000-000000000002","puesto_id":"%s","renovacion":"VERANO","genero":"HOMBRE","cantidad":1,"activo":true}]}')$q$,current_setting('qa.cam'),current_setting('qa.pa')),'23P01','AMBOS convive con VERANO: se rechaza dentro del mismo puesto');
select public.admin_guardar_catalogo('prendas',current_setting('qa.cam')::uuid,format($j${"codigo_prenda":"CAM-BL","nombre_prenda":"CAMISA BLANCA MANGA CORTA","codigo_almacen":"UNF1","precio":40,
  "asignaciones":[{"cliente_id":"e2000000-0000-4000-8000-000000000002","puesto_id":"%s","renovacion":"VERANO","genero":"HOMBRE","cantidad":1,"activo":true}]}$j$,current_setting('qa.pc'))::jsonb);
select pg_temp.ok((select count(*)=1 from public.prenda_clientes where prenda_id=current_setting('qa.cam')::uuid and puesto_id=current_setting('qa.pc')::uuid and renovacion='VERANO'),'VERANO en otro puesto puede coexistir con AMBOS en los demás');
reset role;
update public.prenda_clientes set activo=false where prenda_id=current_setting('qa.cam')::uuid and puesto_id=current_setting('qa.pc')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);

-- Prenda 2: solo en el puesto B
select public.admin_guardar_catalogo('prendas',null,format($j${"codigo_prenda":"PAN-GR","nombre_prenda":"PANTALON GRIS","codigo_almacen":"UNF2","precio":60,
  "asignaciones":[{"cliente_id":"e2000000-0000-4000-8000-000000000002","puesto_id":"%s","renovacion":"AMBOS","genero":"HOMBRE","cantidad":1,"activo":true}]}$j$,current_setting('qa.pb'))::jsonb);
select set_config('qa.pan',(select id::text from public.prendas where codigo_prenda='PAN-GR'),true);
reset role;

\echo '--- B. formulario de requerimientos ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
select pg_temp.ok((select cantidad=2 from public.listar_prendas_cliente('e2000000-0000-4000-8000-000000000002','VERANO',current_setting('qa.pa')::uuid) where codigo_prenda='CAM-BL')
  and (select cantidad=3 from public.listar_prendas_cliente('e2000000-0000-4000-8000-000000000002','VERANO',current_setting('qa.pb')::uuid) where codigo_prenda='CAM-BL'),'la camisa blanca sale con cantidad 2 en un puesto y 3 en el otro');
select pg_temp.ok((select count(*)=1 from public.listar_prendas_cliente('e2000000-0000-4000-8000-000000000002','VERANO',current_setting('qa.pa')::uuid))
  and (select count(*)=2 from public.listar_prendas_cliente('e2000000-0000-4000-8000-000000000002','INVIERNO',current_setting('qa.pb')::uuid)),'cada puesto lista solo sus prendas');
select pg_temp.denied($q$select * from public.listar_prendas_cliente('e2000000-0000-4000-8000-000000000002','VERANO')$q$,'22023','cliente con puestos: listar sin puesto es inválido');
select pg_temp.denied(format($q$select * from public.listar_prendas_cliente('e2000000-0000-4000-8000-000000000002','VERANO',%L)$q$,gen_random_uuid()),'22023','puesto que no es del cliente es inválido');

select set_config('qa.r1',public.crear_requerimiento('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','VERANO',
  format('[{"prenda_id":"%s"}]',current_setting('qa.cam'))::jsonb,gen_random_uuid(),'HOMBRE',current_setting('qa.pa')::uuid)::text,true);
select set_config('qa.r2',public.crear_requerimiento('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','VERANO',
  format('[{"prenda_id":"%s"},{"prenda_id":"%s"}]',current_setting('qa.cam'),current_setting('qa.pan'))::jsonb,gen_random_uuid(),'HOMBRE',current_setting('qa.pb')::uuid)::text,true);
select pg_temp.ok((select puesto_id=current_setting('qa.pa')::uuid from public.requerimientos where id=current_setting('qa.r1')::uuid)
  and (select cantidad=2 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.r1')::uuid)
  and (select cantidad=3 from public.detalle_requerimiento d join public.prendas p on p.id=d.prenda_id where d.requerimiento_id=current_setting('qa.r2')::uuid and p.codigo_prenda='CAM-BL'),'el puesto se guarda en el requerimiento y la cantidad es la de la asignación de ese puesto (2 y 3)');
select pg_temp.denied(format($q$select public.crear_requerimiento('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','VERANO','[{"prenda_id":"%s"}]'::jsonb,gen_random_uuid(),'HOMBRE')$q$,current_setting('qa.cam')),'22023','cliente con puestos: crear sin puesto es inválido');
select pg_temp.denied(format($q$select public.crear_requerimiento('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','VERANO','[{"prenda_id":"%s"}]'::jsonb,gen_random_uuid(),'HOMBRE',%L)$q$,current_setting('qa.pan'),current_setting('qa.pa')),'22023','una prenda que no está asignada al puesto elegido se rechaza');
select pg_temp.denied(format($q$select public.crear_requerimiento('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','VERANO','[{"prenda_id":"%s"}]'::jsonb,gen_random_uuid(),'HOMBRE',%L)$q$,current_setting('qa.cam'),gen_random_uuid()),'22023','puesto inexistente o de otro cliente se rechaza');
select pg_temp.denied(format($q$select public.crear_requerimiento('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"%s"}]'::jsonb,gen_random_uuid(),'HOMBRE',%L)$q$,current_setting('qa.cam'),current_setting('qa.pa')),'22023','cliente sin puestos: enviar un puesto se rechaza');
-- mismo flujo con el cliente sin puestos
select set_config('qa.r3',public.crear_requerimiento('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','VERANO',
  format('[{"prenda_id":"%s"}]',current_setting('qa.cam'))::jsonb,gen_random_uuid(),'HOMBRE')::text,true);
select pg_temp.ok((select puesto_id is null and cliente_id='e2000000-0000-4000-8000-000000000001' from public.requerimientos where id=current_setting('qa.r3')::uuid)
  and (select cantidad=1 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.r3')::uuid),'RENIEC (sin puestos) crea su requerimiento como siempre: puesto nulo y su cantidad 1');

\echo '--- B. edición ---'
reset role;
-- La asignación del puesto A cambia de cantidad (2 -> 5) por el administrador
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select public.admin_guardar_catalogo('prendas',current_setting('qa.cam')::uuid,format($j${"codigo_prenda":"CAM-BL","nombre_prenda":"CAMISA BLANCA MANGA CORTA","codigo_almacen":"UNF1","precio":40,
  "asignaciones":[{"id":"%s","cliente_id":"e2000000-0000-4000-8000-000000000002","puesto_id":"%s","renovacion":"AMBOS","genero":"HOMBRE","cantidad":5,"activo":true}]}$j$,
  (select id from public.prenda_clientes where prenda_id=current_setting('qa.cam')::uuid and puesto_id=current_setting('qa.pa')::uuid),current_setting('qa.pa'))::jsonb);
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
select pg_temp.ok(public.obtener_edicion_prendas(current_setting('qa.r1')::uuid)#>>'{requerimiento,puestos,nombre}'='Vigilante Masculino'
  and (public.obtener_edicion_prendas(current_setting('qa.r1')::uuid)#>>'{requerimiento,detalle_requerimiento,0,prendas,cantidad}')::int=5,'la edición trae el puesto y la cantidad de la asignación de ese puesto');
select set_config('qa.lineas',(select jsonb_agg(jsonb_build_object('prenda_id',x->>'prenda_id','detalle_id',x->>'id'))::text
  from jsonb_array_elements(public.obtener_edicion_prendas(current_setting('qa.r1')::uuid)#>'{requerimiento,detalle_requerimiento}') x),true);
select public.editar_prendas_requerimiento(current_setting('qa.r1')::uuid,pg_temp.ver(current_setting('qa.r1')::uuid),current_setting('qa.lineas')::jsonb,'HOMBRE');
select pg_temp.ok((select cantidad=5 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.r1')::uuid and activo),'editar refresca la cantidad con la del puesto (5), no con la de otro puesto (3)');
select pg_temp.denied(format($q$select public.editar_prendas_requerimiento(%L,%L,%L::jsonb,'HOMBRE')$q$,current_setting('qa.r1'),pg_temp.ver(current_setting('qa.r1')::uuid),
  (current_setting('qa.lineas')::jsonb||format('[{"prenda_id":"%s"}]',current_setting('qa.pan'))::jsonb)::text),'22023','editar: agregar una prenda que no es del puesto del requerimiento se rechaza');
select pg_temp.ok((select cantidad=3 from public.detalle_requerimiento d join public.prendas p on p.id=d.prenda_id where d.requerimiento_id=current_setting('qa.r2')::uuid and p.codigo_prenda='CAM-BL'),'el requerimiento del otro puesto conserva su cantidad (3)');

\echo '--- B. el puesto no se cambia y se lista ---'
reset role;
select pg_temp.denied(format($q$update public.requerimientos set puesto_id=%L where id=%L$q$,current_setting('qa.pb'),current_setting('qa.r1')),'P0001','el puesto de un requerimiento no puede cambiar');
select pg_temp.denied($q$insert into public.requerimientos(agente_id,usuario_creador_id,cliente_id,unidad_id) values('e4000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002')$q$,'22023','el trigger exige puesto para clientes con puestos aunque se inserte directo');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
select pg_temp.ok((public.listar_requerimientos_filtrados(p_puesto_id=>current_setting('qa.pa')::uuid)->>'total')::int=1
  and (public.listar_requerimientos_filtrados(p_puesto_id=>current_setting('qa.pa')::uuid)#>>'{rows,0,puestos,nombre}')='Vigilante Masculino'
  and (public.listar_requerimientos_filtrados()->>'total')::int=3,'el listado propio filtra por puesto y devuelve su nombre');
select pg_temp.ok((public.listar_requerimientos_filtrados(p_cliente_id=>'e2000000-0000-4000-8000-000000000001')#>'{rows,0,puestos}') is not distinct from null
  or (public.listar_requerimientos_filtrados(p_cliente_id=>'e2000000-0000-4000-8000-000000000001')#>>'{rows,0,puestos}') is null,'los requerimientos de RENIEC no tienen puesto');
select pg_temp.ok((public.opciones_requerimientos_propios()->'puestos') @> '[{"nombre":"Vigilante Masculino"}]'::jsonb,'las opciones de filtro incluyen los puestos usados');
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select pg_temp.ok((public.admin_consultar_requerimientos_v2(p_puesto_id=>current_setting('qa.pb')::uuid)->>'total')::int=1
  and (public.admin_consultar_requerimientos_v2(p_puesto_id=>current_setting('qa.pb')::uuid,p_exportar=>true)#>>'{rows,0,puestos,nombre}')='Vigilante Masculino (Terno)'
  and (public.admin_consultar_requerimientos_v2(p_busqueda=>'Terno')->>'total')::int=1,'administración filtra por puesto, lo busca por texto y lo devuelve para exportar');
select pg_temp.ok((public.admin_opciones_requerimientos()->'puestos') @> '[{"nombre":"Vigilante Femenino"}]'::jsonb,'administración ofrece los puestos como filtro');

\echo '--- activar/desactivar y reglas del cliente ---'
select public.admin_actualizar_catalogo_activo('puestos',current_setting('qa.pc')::uuid,false);
select pg_temp.ok((select not activo from public.puestos where id=current_setting('qa.pc')::uuid),'un puesto se desactiva (no se borra)');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
select pg_temp.denied(format($q$select public.crear_requerimiento('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','VERANO','[{"prenda_id":"%s"}]'::jsonb,gen_random_uuid(),'HOMBRE',%L)$q$,current_setting('qa.cam'),current_setting('qa.pc')),'22023','crear con un puesto inactivo se rechaza');
reset role;
select pg_temp.denied($q$update public.clientes set diferencia_puestos=false where id='e2000000-0000-4000-8000-000000000002'$q$,'55000','quitar la opción con asignaciones vigentes por puesto se rechaza');
select pg_temp.ok((select puesto_id is null from public.prenda_clientes where cliente_id='e2000000-0000-4000-8000-000000000001' and activo),'las asignaciones de RENIEC siguen sin puesto');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
reset role;

\echo '--- C. importación con y sin puesto ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select set_config('qa.imp',jsonb_build_array(
  jsonb_build_object('fila',2,'codigo_prenda','CAM-BL','nombre_prenda','CAMISA BLANCA MANGA CORTA','codigo_almacen','UNF1','precio',40,'cantidad',5,'genero','HOMBRE','renovacion','AMBOS','activo',true,'puesto','vigilante masculino'),
  jsonb_build_object('fila',3,'codigo_prenda','CAM-BL','nombre_prenda','CAMISA BLANCA MANGA CORTA','codigo_almacen','UNF1','precio',40,'cantidad',3,'genero','HOMBRE','renovacion','AMBOS','activo',true,'puesto','Vigilante Masculino (Terno)'),
  jsonb_build_object('fila',4,'codigo_prenda','COR-AZ','nombre_prenda','CORBATA AZUL','codigo_almacen','UNF3','precio',15,'cantidad',1,'genero','AMBOS','renovacion','AMBOS','activo',true,'puesto','Vigilante Masculino'))::text,true);
select set_config('qa.p1',public.admin_importar_prendas('e2000000-0000-4000-8000-000000000002',current_setting('qa.imp')::jsonb,false)::text,true);
select pg_temp.ok((current_setting('qa.p1')::jsonb->>'asignaciones_nuevas')::int=1 and (current_setting('qa.p1')::jsonb->>'sin_cambios')::int=2
  and (current_setting('qa.p1')::jsonb->>'cantidades_actualizadas')::int=0 and (current_setting('qa.p1')::jsonb->>'prendas_nuevas')::int=1,'vista previa con puesto (sin importar mayúsculas): 1 nueva, 2 sin cambios');
select pg_temp.denied(format($q$select public.admin_importar_prendas('e2000000-0000-4000-8000-000000000002',%L::jsonb,false)$q$,
  '[{"fila":2,"codigo_prenda":"CAM-BL","nombre_prenda":"CAMISA BLANCA MANGA CORTA","codigo_almacen":"UNF1","precio":40,"cantidad":5,"genero":"HOMBRE","renovacion":"AMBOS","activo":true}]'),'22023','cliente con puestos: filas sin puesto se rechazan');
select pg_temp.denied(format($q$select public.admin_importar_prendas('e2000000-0000-4000-8000-000000000002',%L::jsonb,false)$q$,
  '[{"fila":7,"codigo_prenda":"CAM-BL","nombre_prenda":"CAMISA BLANCA MANGA CORTA","codigo_almacen":"UNF1","precio":40,"cantidad":5,"genero":"HOMBRE","renovacion":"AMBOS","activo":true,"puesto":"No existe"}]'),'22023','cliente con puestos: puesto inexistente en el catálogo se rechaza (con número de fila)');
select pg_temp.denied(format($q$select public.admin_importar_prendas('e2000000-0000-4000-8000-000000000002',%L::jsonb,false)$q$,
  '[{"fila":7,"codigo_prenda":"CAM-BL","nombre_prenda":"CAMISA BLANCA MANGA CORTA","codigo_almacen":"UNF1","precio":40,"cantidad":5,"genero":"HOMBRE","renovacion":"AMBOS","activo":true,"puesto":"Vigilante Femenino"}]'),'22023','puesto inactivo con fila activa se rechaza');
select public.admin_importar_prendas('e2000000-0000-4000-8000-000000000002',current_setting('qa.imp')::jsonb,true);
select pg_temp.ok((select count(*)=1 from public.prenda_clientes a join public.prendas p on p.id=a.prenda_id where p.codigo_prenda='COR-AZ' and a.puesto_id=current_setting('qa.pa')::uuid),'la importación crea la asignación en su puesto');
select pg_temp.ok((public.admin_importar_prendas('e2000000-0000-4000-8000-000000000002',current_setting('qa.imp')::jsonb,false)->>'sin_cambios')::int=3,'reimportar el mismo archivo: 3 sin cambios');
-- Cambio de renovación dentro de un puesto: AMBOS -> VERANO + INVIERNO en el puesto A solo afecta a ese puesto
select set_config('qa.imp2',jsonb_build_array(
  jsonb_build_object('fila',2,'codigo_prenda','CAM-BL','nombre_prenda','CAMISA BLANCA MANGA CORTA','codigo_almacen','UNF1','precio',40,'cantidad',5,'genero','HOMBRE','renovacion','VERANO','activo',true,'puesto','Vigilante Masculino'))::text,true);
select set_config('qa.p2',public.admin_importar_prendas('e2000000-0000-4000-8000-000000000002',current_setting('qa.imp2')::jsonb,true)::text,true);
select pg_temp.ok(jsonb_array_length(current_setting('qa.p2')::jsonb->'renovaciones_actualizadas')=1
  and (select renovacion='VERANO' from public.prenda_clientes where prenda_id=current_setting('qa.cam')::uuid and puesto_id=current_setting('qa.pa')::uuid and activo)
  and (select renovacion='AMBOS' and cantidad=3 from public.prenda_clientes where prenda_id=current_setting('qa.cam')::uuid and puesto_id=current_setting('qa.pb')::uuid and activo),'AMBOS->VERANO en un puesto no toca el mismo código en otro puesto');
-- se restablece
select public.admin_importar_prendas('e2000000-0000-4000-8000-000000000002',jsonb_build_array(
  jsonb_build_object('fila',2,'codigo_prenda','CAM-BL','nombre_prenda','CAMISA BLANCA MANGA CORTA','codigo_almacen','UNF1','precio',40,'cantidad',5,'genero','HOMBRE','renovacion','AMBOS','activo',true,'puesto','Vigilante Masculino')),true);
reset role;

\echo '--- D. exportar e importar el mismo archivo ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"SOLA-01","nombre_prenda":"PRENDA SIN ASIGNACION","codigo_almacen":"UNF9","precio":9.5}');
-- una asignación inactiva también se exporta
select public.admin_importar_prendas('e2000000-0000-4000-8000-000000000002','[{"fila":2,"codigo_prenda":"GOR-NE","nombre_prenda":"GORRA NEGRA","codigo_almacen":"UNF7","precio":20,"cantidad":1,"genero":"AMBOS","renovacion":"INVIERNO","activo":false,"puesto":"Vigilante Masculino"}]',true);
select set_config('qa.exp',public.admin_exportar_prendas('e2000000-0000-4000-8000-000000000002')::text,true);
select pg_temp.ok(jsonb_array_length(current_setting('qa.exp')::jsonb)=(select count(*) from public.prenda_clientes where cliente_id='e2000000-0000-4000-8000-000000000002')
  and jsonb_array_length(current_setting('qa.exp')::jsonb)=6,'la exportación por cliente trae TODAS sus asignaciones (6, con las inactivas)');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(current_setting('qa.exp')::jsonb) e where e->>'codigo_prenda'='GOR-NE' and (e->>'activo')::boolean is false and e->>'puesto'='Vigilante Masculino' and e->>'cliente'='BCR')
  and exists(select 1 from jsonb_array_elements(current_setting('qa.exp')::jsonb) e where e->>'codigo_prenda'='CAM-BL' and e->>'puesto'='Vigilante Masculino (Terno)' and (e->>'cantidad')::int=3 and e->>'precio'='40.00'),'trae cliente, puesto, cantidad, precio con 2 decimales y el estado');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(current_setting('qa.exp')::jsonb) e where e->>'codigo_prenda'='SOLA-01'),'con filtro de cliente no trae prendas sin asignación');
select set_config('qa.expall',public.admin_exportar_prendas()::text,true);
select pg_temp.ok((select count(*)=1 from jsonb_array_elements(current_setting('qa.expall')::jsonb) e where e->>'codigo_prenda'='SOLA-01' and e->>'cliente' is null)
  and jsonb_array_length(current_setting('qa.expall')::jsonb)=(select count(*) from public.prenda_clientes)+1,'sin filtro: todas las asignaciones y las prendas sin asignación UNA sola vez');
select set_config('qa.rt',public.admin_importar_prendas('e2000000-0000-4000-8000-000000000002',pg_temp.a_importacion(current_setting('qa.exp')::jsonb),false)::text,true);
select pg_temp.ok((current_setting('qa.rt')::jsonb->>'asignaciones_nuevas')::int=0 and (current_setting('qa.rt')::jsonb->>'cantidades_actualizadas')::int=0
  and (current_setting('qa.rt')::jsonb->>'generos_actualizados')::int=0 and (current_setting('qa.rt')::jsonb->>'estados_actualizados')::int=0
  and (current_setting('qa.rt')::jsonb->>'prendas_nuevas')::int=0 and jsonb_array_length(current_setting('qa.rt')::jsonb->'alertas')=0
  and jsonb_array_length(current_setting('qa.rt')::jsonb->'renovaciones_actualizadas')=0 and (current_setting('qa.rt')::jsonb->>'sin_cambios')::int=6,'BCR: exportar e importar el mismo archivo = 0 cambios (6 sin cambios)');
select set_config('qa.exp1',public.admin_exportar_prendas('e2000000-0000-4000-8000-000000000001')::text,true);
select set_config('qa.rt1',public.admin_importar_prendas('e2000000-0000-4000-8000-000000000001',pg_temp.a_importacion(current_setting('qa.exp1')::jsonb),false)::text,true);
select pg_temp.ok((current_setting('qa.rt1')::jsonb->>'asignaciones_nuevas')::int=0 and (current_setting('qa.rt1')::jsonb->>'cantidades_actualizadas')::int=0
  and (current_setting('qa.rt1')::jsonb->>'estados_actualizados')::int=0 and jsonb_array_length(current_setting('qa.rt1')::jsonb->'alertas')=0
  and (current_setting('qa.rt1')::jsonb->>'sin_cambios')::int=1 and current_setting('qa.exp1')::jsonb->0->>'puesto' is null,'RENIEC (sin puestos): exportar e importar = 0 cambios y puesto vacío');
select pg_temp.denied($q$select public.admin_exportar_prendas('e2000000-0000-4000-8000-0000000000ff')$q$,'P0002','exportar un cliente inexistente');
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
select pg_temp.denied($q$select public.admin_exportar_prendas()$q$,'42501','un coordinador no puede exportar prendas');
reset role;
select pg_temp.ok((select count(*)>=4 from private.admin_catalog_audit where catalogo='puestos'),'crear y desactivar puestos queda en la auditoría');
select pg_temp.ok((select coalesce(has_function_privilege('anon','public.admin_exportar_prendas(uuid)','execute'),false)=false),'anon no ejecuta la exportación');

rollback;

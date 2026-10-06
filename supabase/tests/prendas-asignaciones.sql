-- Reproduce el incidente real y valida el modelo ficha única + asignaciones por cliente/renovación,
-- siempre con "set local role authenticated" (nunca superusuario) salvo las comprobaciones de restricciones:
--   1. se importa el archivo de RENIEC; 2. luego el de INDECOPI con códigos compartidos (corbata, camisa, ...)
--   -> RENIEC conserva todas sus prendas y cantidades;
--   3. el bloqueador ACS0206 de INDECOPI (Verano 6, Invierno 3) sale con la cantidad de la renovación del
--      requerimiento; una prenda no asignada al cliente/renovación se rechaza al crear y al editar;
--   4. alerta de precio distinto (no cambia la ficha salvo que se pida), conflictos, duplicados y
--      "Reemplazar catálogo de este cliente" (desactiva, no borra, y solo del cliente);
--   5. restricciones de base de datos (única por prenda+cliente+renovación; AMBOS no convive con VERANO/INVIERNO).
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
-- cantidad de una prenda para un cliente/renovación, tal como la ve el formulario
create function pg_temp.qty(cliente uuid,renov text,codigo text) returns integer language sql as $$
  select cantidad from public.listar_prendas_cliente(cliente,renov) where codigo_prenda=codigo $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('d1000000-0000-4000-8000-000000000001','admin-asig@example.test','{}'),
 ('d1000000-0000-4000-8000-000000000002','coord-asig@example.test','{}');
update public.profiles set role='admin' where id='d1000000-0000-4000-8000-000000000001';
update public.profiles set role='coordinador' where id='d1000000-0000-4000-8000-000000000002';
insert into public.clientes(id,nombre,activo) values
 ('d2000000-0000-4000-8000-000000000001','RENIEC',true),('d2000000-0000-4000-8000-000000000002','INDECOPI',true);
insert into public.unidades(id,cliente_id,nombre,activo) values
 ('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','RENIEC SEDE',true),
 ('d3000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000002','INDECOPI SEDE',true);
insert into public.personal(id,codigo_personal,nombre,dni,cargo,activo) values
 ('d4000000-0000-4000-8000-000000000001','ASG-1','TRABAJADOR UNO','55555551','AGENTE',true);

\echo '--- 1. importar el archivo de RENIEC ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('qa.reniec',public.admin_importar_prendas('d2000000-0000-4000-8000-000000000001',
 '[{"fila":2,"codigo_prenda":"COR001","nombre_prenda":"CORBATA","codigo_almacen":"UNF1","precio":15,"cantidad":10,"genero":"AMBOS","renovacion":"AMBOS","activo":true},
   {"fila":3,"codigo_prenda":"COR002","nombre_prenda":"CORREA","codigo_almacen":"UNF2","precio":20,"cantidad":1,"genero":"HOMBRE","renovacion":"AMBOS","activo":true},
   {"fila":4,"codigo_prenda":"MED001","nombre_prenda":"MEDIAS","codigo_almacen":"UNF3","precio":5,"cantidad":2,"genero":"AMBOS","renovacion":"VERANO","activo":true},
   {"fila":5,"codigo_prenda":"MED001","nombre_prenda":"MEDIAS","codigo_almacen":"UNF3","precio":5,"cantidad":3,"genero":"AMBOS","renovacion":"INVIERNO","activo":true},
   {"fila":6,"codigo_prenda":"CAM001","nombre_prenda":"CAMISA","codigo_almacen":"UNF4","precio":40,"cantidad":4,"genero":"HOMBRE","renovacion":"AMBOS","activo":true}]',true)::text,true);
select pg_temp.ok((current_setting('qa.reniec')::jsonb->>'prendas_nuevas')::int=4 and (current_setting('qa.reniec')::jsonb->>'asignaciones_nuevas')::int=5,'RENIEC: 4 prendas y 5 asignaciones nuevas (MEDIAS Verano 2 e Invierno 3 son válidas)');
select pg_temp.ok((select count(*)=5 from public.prenda_clientes a where a.cliente_id='d2000000-0000-4000-8000-000000000001'),'RENIEC tiene 5 asignaciones');
reset role;

\echo '--- 2. importar INDECOPI con códigos compartidos: vista previa (no escribe) ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('qa.ind_rows','[{"fila":2,"codigo_prenda":"COR001","nombre_prenda":"CORBATA","codigo_almacen":"UNF1","precio":15,"cantidad":2,"genero":"AMBOS","renovacion":"AMBOS","activo":true},
   {"fila":3,"codigo_prenda":"CAM001","nombre_prenda":"CAMISA","codigo_almacen":"UNF4","precio":45,"cantidad":1,"genero":"HOMBRE","renovacion":"AMBOS","activo":true},
   {"fila":4,"codigo_prenda":"ACS0206","nombre_prenda":"BLOQUEADOR SOLAR","codigo_almacen":"UNF9","precio":12,"cantidad":6,"genero":"AMBOS","renovacion":"VERANO","activo":true},
   {"fila":5,"codigo_prenda":"ACS0206","nombre_prenda":"BLOQUEADOR SOLAR","codigo_almacen":"UNF9","precio":12,"cantidad":3,"genero":"AMBOS","renovacion":"INVIERNO","activo":true},
   {"fila":6,"codigo_prenda":"ZAP001","nombre_prenda":"ZAPATOS","codigo_almacen":"UNF5","precio":80,"cantidad":1,"genero":"HOMBRE","renovacion":"AMBOS","activo":true}]',true);
select set_config('qa.prev',public.admin_importar_prendas('d2000000-0000-4000-8000-000000000002',current_setting('qa.ind_rows')::jsonb,false)::text,true);
select pg_temp.ok((current_setting('qa.prev')::jsonb->>'prendas_nuevas')::int=2 and (current_setting('qa.prev')::jsonb->>'asignaciones_nuevas')::int=5,'vista previa INDECOPI: 2 prendas nuevas (ACS0206, ZAP001) y 5 asignaciones nuevas');
select pg_temp.ok(current_setting('qa.prev')::jsonb->'alertas'->0->>'codigo'='CAM001'
  and current_setting('qa.prev')::jsonb->'alertas'->0->'cambios'->0->>'campo'='precio'
  and current_setting('qa.prev')::jsonb->'alertas'->0->'cambios'->0->>'actual'='40.00'
  and current_setting('qa.prev')::jsonb->'alertas'->0->'cambios'->0->>'archivo'='45.00','alerta de precio: actual 40.00, en el archivo 45.00');
select pg_temp.ok(jsonb_array_length(current_setting('qa.prev')::jsonb->'alertas')=1,'solo CAM001 trae una diferencia de ficha (COR001 coincide)');
select pg_temp.ok((select count(*)=0 from public.prenda_clientes where cliente_id='d2000000-0000-4000-8000-000000000002'),'la vista previa no escribe nada');
select pg_temp.ok((select precio=40 from public.prendas where codigo_prenda='CAM001'),'la vista previa no cambia el precio');

\echo '--- 3. aplicar INDECOPI (Mantener actual por defecto) ---'
select public.admin_importar_prendas('d2000000-0000-4000-8000-000000000002',current_setting('qa.ind_rows')::jsonb,true);
select pg_temp.ok((select count(*)=1 from public.prendas where codigo_prenda in ('COR001') ) and (select count(*)=5 from public.prenda_clientes where cliente_id='d2000000-0000-4000-8000-000000000002'),'se reutiliza la ficha de COR001 y INDECOPI queda con 5 asignaciones');
select pg_temp.ok((select precio=40 from public.prendas where codigo_prenda='CAM001'),'"Mantener actual": la ficha de CAM001 conserva su precio 40');
select pg_temp.ok((select count(*)=5 from public.prenda_clientes where cliente_id='d2000000-0000-4000-8000-000000000001' and activo),'RENIEC conserva sus 5 asignaciones tras importar INDECOPI');
select pg_temp.ok(pg_temp.qty('d2000000-0000-4000-8000-000000000001','VERANO','COR001')=10
  and pg_temp.qty('d2000000-0000-4000-8000-000000000001','VERANO','COR002')=1
  and pg_temp.qty('d2000000-0000-4000-8000-000000000001','VERANO','CAM001')=4
  and pg_temp.qty('d2000000-0000-4000-8000-000000000001','VERANO','MED001')=2
  and pg_temp.qty('d2000000-0000-4000-8000-000000000001','INVIERNO','MED001')=3,'RENIEC: el formulario sigue ofreciendo corbata, correa, camisa y medias con sus cantidades');
select pg_temp.ok(pg_temp.qty('d2000000-0000-4000-8000-000000000001','VERANO','ACS0206') is null and pg_temp.qty('d2000000-0000-4000-8000-000000000001','VERANO','ZAP001') is null,'RENIEC no recibe las prendas exclusivas de INDECOPI');
select pg_temp.ok(pg_temp.qty('d2000000-0000-4000-8000-000000000002','VERANO','COR001')=2 and pg_temp.qty('d2000000-0000-4000-8000-000000000002','INVIERNO','COR001')=2,'INDECOPI: la corbata AMBOS sale en ambas renovaciones con SU cantidad (2, no la de RENIEC)');
select pg_temp.ok(pg_temp.qty('d2000000-0000-4000-8000-000000000002','VERANO','ACS0206')=6 and pg_temp.qty('d2000000-0000-4000-8000-000000000002','INVIERNO','ACS0206')=3,'bloqueador ACS0206: Verano 6 e Invierno 3 (la segunda fila no sobrescribe a la primera)');
select pg_temp.ok((select count(*)=1 from public.listar_prendas_cliente('d2000000-0000-4000-8000-000000000002','VERANO') where codigo_prenda='ACS0206'),'el formulario ofrece ACS0206 una sola vez por renovación');
reset role;
select pg_temp.ok((select count(*)=1 from private.admin_catalog_audit where accion='IMPORTAR' and registro_id='d2000000-0000-4000-8000-000000000002'),'la importación queda auditada');
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
reset role;

\echo '--- 4. requerimientos: cantidad según renovación, y prendas no asignadas ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
select set_config('qa.acs',(select id::text from public.prendas where codigo_prenda='ACS0206'),true);
select set_config('qa.cor',(select id::text from public.prendas where codigo_prenda='COR001'),true);
select set_config('qa.cam',(select id::text from public.prendas where codigo_prenda='CAM001'),true);
select set_config('qa.reqv',public.crear_requerimiento('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000002','VERANO',
  format('[{"prenda_id":"%s"},{"prenda_id":"%s"}]',current_setting('qa.acs'),current_setting('qa.cor'))::jsonb,gen_random_uuid())::text,true);
select set_config('qa.reqi',public.crear_requerimiento('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000002','INVIERNO',
  format('[{"prenda_id":"%s"}]',current_setting('qa.acs'))::jsonb,gen_random_uuid())::text,true);
select pg_temp.ok((select d.cantidad=6 and d.precio_unitario=12 from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.reqv')::uuid and d.prenda_id=current_setting('qa.acs')::uuid),'requerimiento VERANO de INDECOPI: bloqueador cantidad 6');
select pg_temp.ok((select d.cantidad=3 and d.precio_unitario=12 from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.reqi')::uuid),'requerimiento INVIERNO de INDECOPI: bloqueador cantidad 3');
select pg_temp.ok((select d.cantidad=2 from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.reqv')::uuid and d.prenda_id=current_setting('qa.cor')::uuid),'la corbata de INDECOPI usa la cantidad de INDECOPI (2)');
select set_config('qa.reqr',public.crear_requerimiento('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','VERANO',
  format('[{"prenda_id":"%s"},{"prenda_id":"%s"}]',current_setting('qa.cor'),current_setting('qa.cam'))::jsonb,gen_random_uuid())::text,true);
select pg_temp.ok((select d.cantidad=10 from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.reqr')::uuid and d.prenda_id=current_setting('qa.cor')::uuid),'la misma corbata en RENIEC usa la cantidad de RENIEC (10)');
select pg_temp.ok((select d.cantidad=4 and d.precio_unitario=40 from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.reqr')::uuid and d.prenda_id=current_setting('qa.cam')::uuid),'camisa de RENIEC: cantidad 4 y precio 40');
select pg_temp.denied(format($q$select public.crear_requerimiento('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"%s"}]',gen_random_uuid())$q$,current_setting('qa.acs')),'22023','RENIEC no puede pedir una prenda que solo tiene INDECOPI');
select pg_temp.denied(format($q$select public.crear_requerimiento('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"%s"},{"prenda_id":"%s"}]',gen_random_uuid())$q$,current_setting('qa.cor'),current_setting('qa.acs')),'22023','una sola prenda no asignada rechaza todo el requerimiento');
select pg_temp.denied(format($q$select public.crear_requerimiento('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"%s"},{"prenda_id":"%s"}]',gen_random_uuid())$q$,current_setting('qa.cor'),current_setting('qa.cor')),'22023','prenda repetida en el mismo requerimiento');
select pg_temp.ok((select count(*)=3 from public.requerimientos),'los rechazos no dejan cabeceras');
-- edición: prenda no asignada rechazada; asignada aceptada con su cantidad
select set_config('qa.ver',(public.obtener_edicion_prendas(current_setting('qa.reqr')::uuid)->>'version'),true);
select set_config('qa.dc',(select id::text from public.detalle_requerimiento where requerimiento_id=current_setting('qa.reqr')::uuid and prenda_id=current_setting('qa.cor')::uuid),true);
select set_config('qa.dm',(select id::text from public.detalle_requerimiento where requerimiento_id=current_setting('qa.reqr')::uuid and prenda_id=current_setting('qa.cam')::uuid),true);
select pg_temp.denied(format($q$select public.editar_prendas_requerimiento('%s','%s','[{"prenda_id":"%s","detalle_id":"%s"},{"prenda_id":"%s","detalle_id":"%s"},{"prenda_id":"%s"}]')$q$,
  current_setting('qa.reqr'),current_setting('qa.ver'),current_setting('qa.cor'),current_setting('qa.dc'),current_setting('qa.cam'),current_setting('qa.dm'),current_setting('qa.acs')),'22023','editar: agregar una prenda no asignada al cliente');
select public.editar_prendas_requerimiento(current_setting('qa.reqr')::uuid,current_setting('qa.ver'),
  format('[{"prenda_id":"%s","detalle_id":"%s"},{"prenda_id":"%s"}]',current_setting('qa.cor'),current_setting('qa.dc'),(select id from public.prendas where codigo_prenda='MED001'))::jsonb);
select pg_temp.ok((select d.cantidad=2 from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.reqr')::uuid and d.activo and d.prenda_id=(select id from public.prendas where codigo_prenda='MED001')),'editar: una prenda asignada entra con la cantidad de la asignación VERANO (2)');
reset role;

\echo '--- 5. precio distinto: Actualizar solo cuando se pide, y el historial no cambia ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select public.admin_importar_prendas('d2000000-0000-4000-8000-000000000002',current_setting('qa.ind_rows')::jsonb,true,array['CAM001']);
select pg_temp.ok((select precio=45 from public.prendas where codigo_prenda='CAM001'),'"Actualizar": CAM001 pasa a precio 45');
select pg_temp.ok((select count(*)=5 from public.prenda_clientes where cliente_id='d2000000-0000-4000-8000-000000000001' and activo),'RENIEC sigue con sus 5 asignaciones');
reset role;
select pg_temp.ok((select precio_unitario=40 and cantidad=4 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.reqr')::uuid and prenda_id=current_setting('qa.cam')::uuid),'la línea histórica conserva precio 40 y cantidad 4');

\echo '--- 6. errores y conflictos del archivo ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select pg_temp.denied($q$select public.admin_importar_prendas('d2000000-0000-4000-8000-000000000002','[{"fila":2,"codigo_prenda":"DUP1","nombre_prenda":"X","codigo_almacen":"A","precio":1,"cantidad":1,"genero":"AMBOS","renovacion":"VERANO","activo":true},{"fila":3,"codigo_prenda":"DUP1","nombre_prenda":"X","codigo_almacen":"A","precio":1,"cantidad":2,"genero":"AMBOS","renovacion":"VERANO","activo":true}]',true)$q$,'22023','mismo código, cliente y renovación repetidos en el archivo');
select pg_temp.denied($q$select public.admin_importar_prendas('d2000000-0000-4000-8000-000000000002','[{"fila":2,"codigo_prenda":"DUP2","nombre_prenda":"X","codigo_almacen":"A","precio":1,"cantidad":1,"genero":"AMBOS","renovacion":"VERANO","activo":true},{"fila":3,"codigo_prenda":"DUP2","nombre_prenda":"X","codigo_almacen":"A","precio":9,"cantidad":1,"genero":"AMBOS","renovacion":"INVIERNO","activo":true}]',true)$q$,'22023','mismo código con precios distintos dentro del archivo');
select pg_temp.denied($q$select public.admin_importar_prendas('d2000000-0000-4000-8000-000000000002','[{"fila":2,"codigo_prenda":"DUP3","nombre_prenda":"X","codigo_almacen":"A","precio":1,"cantidad":1,"genero":"AMBOS","renovacion":"AMBOS","activo":true},{"fila":3,"codigo_prenda":"DUP3","nombre_prenda":"X","codigo_almacen":"A","precio":1,"cantidad":1,"genero":"AMBOS","renovacion":"VERANO","activo":true}]',true)$q$,'22023','AMBOS junto con VERANO en el archivo');
select pg_temp.ok((select count(*)=0 from public.prendas where codigo_prenda like 'DUP%'),'los archivos rechazados no dejan fichas');
select pg_temp.denied($q$select public.admin_importar_prendas('d2000000-0000-4000-8000-000000000002','[{"fila":2,"codigo_prenda":"X1","nombre_prenda":"X","codigo_almacen":"A","precio":1,"cantidad":1,"genero":"AMBOS","renovacion":"OTOÑO","activo":true}]',false)$q$,'22023','renovación inválida');
-- ACS0206 AMBOS contra las asignaciones VERANO/INVIERNO existentes de INDECOPI: conflicto, no se aplica
select set_config('qa.conf',public.admin_importar_prendas('d2000000-0000-4000-8000-000000000002',
  '[{"fila":7,"codigo_prenda":"ACS0206","nombre_prenda":"BLOQUEADOR SOLAR","codigo_almacen":"UNF9","precio":12,"cantidad":9,"genero":"AMBOS","renovacion":"AMBOS","activo":true}]',true)::text,true);
select pg_temp.ok(jsonb_array_length(current_setting('qa.conf')::jsonb->'conflictos')=1 and current_setting('qa.conf')::jsonb->'conflictos'->0->>'fila'='7' and (current_setting('qa.conf')::jsonb->>'asignaciones_nuevas')::int=0,'AMBOS contra VERANO/INVIERNO existentes: conflicto en la fila 7, no se aplica');
select pg_temp.ok(pg_temp.qty('d2000000-0000-4000-8000-000000000002','VERANO','ACS0206')=6 and pg_temp.qty('d2000000-0000-4000-8000-000000000002','INVIERNO','ACS0206')=3,'ACS0206 sigue con Verano 6 e Invierno 3');
reset role;

\echo '--- 7. Reemplazar catálogo de este cliente ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('qa.rep',public.admin_importar_prendas('d2000000-0000-4000-8000-000000000002',
  '[{"fila":2,"codigo_prenda":"COR001","nombre_prenda":"CORBATA","codigo_almacen":"UNF1","precio":15,"cantidad":5,"genero":"AMBOS","renovacion":"AMBOS","activo":true}]',false,'{}',true)::text,true);
select pg_temp.ok((select count(*)=4 from jsonb_array_elements(current_setting('qa.rep')::jsonb->'desactivar') x)
  and not exists(select 1 from jsonb_array_elements(current_setting('qa.rep')::jsonb->'desactivar') x where x->>'codigo'='COR001'),'la vista previa lista (4) lo que se desactivaría y no incluye lo que viene en el archivo');
select pg_temp.ok((select count(*)=5 from public.prenda_clientes where cliente_id='d2000000-0000-4000-8000-000000000002' and activo),'la vista previa no desactiva nada');
select public.admin_importar_prendas('d2000000-0000-4000-8000-000000000002',
  '[{"fila":2,"codigo_prenda":"COR001","nombre_prenda":"CORBATA","codigo_almacen":"UNF1","precio":15,"cantidad":5,"genero":"AMBOS","renovacion":"AMBOS","activo":true}]',true,'{}',true);
select pg_temp.ok((select count(*)=1 from public.prenda_clientes where cliente_id='d2000000-0000-4000-8000-000000000002' and activo)
  and (select count(*)=5 from public.prenda_clientes where cliente_id='d2000000-0000-4000-8000-000000000002'),'reemplazar desactiva (no borra) lo que no venía: 1 activa, 5 filas en total');
select pg_temp.ok(pg_temp.qty('d2000000-0000-4000-8000-000000000002','VERANO','COR001')=5 and pg_temp.qty('d2000000-0000-4000-8000-000000000002','VERANO','ACS0206') is null,'INDECOPI ya solo ofrece la corbata (cantidad 5)');
select pg_temp.ok((select count(*)=5 from public.prenda_clientes where cliente_id='d2000000-0000-4000-8000-000000000001' and activo) and (select count(*)=4 from public.prendas where codigo_prenda in ('COR001','COR002','MED001','CAM001')),'reemplazar INDECOPI no toca a RENIEC ni borra fichas');
-- al reemplazar, la asignación AMBOS vigente que no viene en el archivo se desactiva primero: pasar a VERANO es válido
select public.admin_importar_prendas('d2000000-0000-4000-8000-000000000002','[{"fila":2,"codigo_prenda":"COR001","nombre_prenda":"CORBATA","codigo_almacen":"UNF1","precio":15,"cantidad":7,"genero":"AMBOS","renovacion":"VERANO","activo":true}]',true,'{}',true);
select pg_temp.ok(pg_temp.qty('d2000000-0000-4000-8000-000000000002','VERANO','COR001')=7 and pg_temp.qty('d2000000-0000-4000-8000-000000000002','INVIERNO','COR001') is null,'reemplazar AMBOS por VERANO: queda solo VERANO (cantidad 7) y la AMBOS antigua inactiva');
reset role;
select pg_temp.ok((select count(*)>=2 from private.admin_catalog_audit where accion='IMPORTAR' and registro_id='d2000000-0000-4000-8000-000000000002' and valores_antes is not null),'las importaciones guardan el estado anterior para poder recuperarlo');
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
reset role;

\echo '--- 8. permisos ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
select pg_temp.denied($q$select public.admin_importar_prendas('d2000000-0000-4000-8000-000000000002','[{"fila":2,"codigo_prenda":"NOP","nombre_prenda":"X","codigo_almacen":"A","precio":1,"cantidad":1,"genero":"AMBOS","renovacion":"AMBOS","activo":true}]',true)$q$,'42501','un coordinador no puede importar');
select pg_temp.denied($q$insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad) select id,'d2000000-0000-4000-8000-000000000001','VERANO',1 from public.prendas limit 1$q$,'42501','escritura directa en asignaciones denegada');
select pg_temp.ok((select count(*)>0 from public.listar_prendas_cliente('d2000000-0000-4000-8000-000000000001','VERANO')),'un coordinador sí ve las prendas del cliente en el formulario');
select pg_temp.denied($q$select * from public.listar_prendas_cliente('d2000000-0000-4000-8000-000000000001','AMBOS')$q$,'22023','el formulario solo pide VERANO o INVIERNO');
reset role;

\echo '--- 9. restricciones de base de datos ---'
select pg_temp.denied($q$insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad) select p.id,'d2000000-0000-4000-8000-000000000001','VERANO',9 from public.prendas p where p.codigo_prenda='MED001'$q$,'23505','duplicado (prenda, cliente, renovación)');
select pg_temp.denied($q$insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad) select p.id,'d2000000-0000-4000-8000-000000000001','AMBOS',9 from public.prendas p where p.codigo_prenda='MED001'$q$,'23P01','AMBOS no convive con VERANO/INVIERNO activos');
select pg_temp.denied($q$insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad) select p.id,'d2000000-0000-4000-8000-000000000001','VERANO',9 from public.prendas p where p.codigo_prenda='COR001'$q$,'23P01','VERANO no convive con AMBOS activo');
select pg_temp.denied($q$insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad) select p.id,'d2000000-0000-4000-8000-000000000001','VERANO',0 from public.prendas p where p.codigo_prenda='ZAP001'$q$,'23514','cantidad debe ser positiva');
-- una asignación AMBOS inactiva sí permite VERANO activo, pero no se puede reactivar mientras haya VERANO activo
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad,activo) select p.id,'d2000000-0000-4000-8000-000000000001','AMBOS',1,false from public.prendas p where p.codigo_prenda='ZAP001';
insert into public.prenda_clientes(prenda_id,cliente_id,renovacion,cantidad,activo) select p.id,'d2000000-0000-4000-8000-000000000001','VERANO',1,true from public.prendas p where p.codigo_prenda='ZAP001';
select pg_temp.denied($q$update public.prenda_clientes a set activo=true from public.prendas p where p.id=a.prenda_id and p.codigo_prenda='ZAP001' and a.cliente_id='d2000000-0000-4000-8000-000000000001' and a.renovacion='AMBOS'$q$,'23P01','reactivar AMBOS con VERANO activo');
select pg_temp.denied($q$update public.prenda_clientes set cliente_id='d2000000-0000-4000-8000-000000000002' where cantidad=1 and renovacion='VERANO' and cliente_id='d2000000-0000-4000-8000-000000000001'$q$,'55000','una asignación no cambia de cliente');
select pg_temp.denied($q$select public.admin_eliminar_catalogo('clientes','d2000000-0000-4000-8000-000000000001')$q$,'42501','sin sesión admin no se elimina un cliente');

\echo '--- 10. Mantenimiento: ficha + asignaciones ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('qa.nueva',(public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"MNT001","nombre_prenda":"GORRA","codigo_almacen":"UNF7","precio":18,"genero":"AMBOS","asignaciones":[{"cliente_id":"d2000000-0000-4000-8000-000000000001","renovacion":"VERANO","cantidad":2,"activo":true},{"cliente_id":"d2000000-0000-4000-8000-000000000001","renovacion":"INVIERNO","cantidad":1,"activo":true},{"cliente_id":"d2000000-0000-4000-8000-000000000002","renovacion":"AMBOS","cantidad":5,"activo":true}]}')->'row'->>'id'),true);
select pg_temp.ok(pg_temp.qty('d2000000-0000-4000-8000-000000000001','VERANO','MNT001')=2 and pg_temp.qty('d2000000-0000-4000-8000-000000000001','INVIERNO','MNT001')=1 and pg_temp.qty('d2000000-0000-4000-8000-000000000002','VERANO','MNT001')=5,'crear ficha con 3 asignaciones: cantidades distintas por cliente y renovación');
select pg_temp.ok((select jsonb_array_length(r->'asignaciones')=3 from jsonb_array_elements(public.admin_listar_catalogo('prendas',p_busqueda=>'MNT001')->'rows') r),'el listado muestra las asignaciones de la ficha');
select pg_temp.ok((public.admin_listar_catalogo('prendas',p_cliente_id=>'d2000000-0000-4000-8000-000000000001')->>'total')::int=(select count(distinct a.prenda_id) from public.prenda_clientes a where a.cliente_id='d2000000-0000-4000-8000-000000000001'),'el filtro por cliente muestra solo las fichas asignadas a ese cliente');
select pg_temp.denied(format($q$select public.admin_guardar_catalogo('prendas','%s','{"codigo_prenda":"MNT001","nombre_prenda":"GORRA","codigo_almacen":"UNF7","precio":18,"genero":"AMBOS","asignaciones":[{"cliente_id":"d2000000-0000-4000-8000-000000000001","renovacion":"VERANO","cantidad":3,"activo":true}]}')$q$,current_setting('qa.nueva')),'23505','asignación repetida al editar la ficha');
select pg_temp.denied(format($q$select public.admin_guardar_catalogo('prendas','%s','{"codigo_prenda":"MNT001","nombre_prenda":"GORRA","codigo_almacen":"UNF7","precio":18,"genero":"AMBOS","asignaciones":[{"cliente_id":"d2000000-0000-4000-8000-000000000001","renovacion":"AMBOS","cantidad":3,"activo":true}]}')$q$,current_setting('qa.nueva')),'23P01','AMBOS junto a VERANO/INVIERNO activos al editar la ficha');
-- cambiar de VERANO+INVIERNO a AMBOS en un solo guardado: primero se desactiva, luego se activa
select public.admin_guardar_catalogo('prendas',current_setting('qa.nueva')::uuid,format('{"codigo_prenda":"MNT001","nombre_prenda":"GORRA","codigo_almacen":"UNF7","precio":18,"genero":"AMBOS","asignaciones":[{"id":"%s","renovacion":"VERANO","cantidad":2,"activo":false},{"id":"%s","renovacion":"INVIERNO","cantidad":1,"activo":false},{"cliente_id":"d2000000-0000-4000-8000-000000000001","renovacion":"AMBOS","cantidad":4,"activo":true}]}',
  (select id from public.prenda_clientes where prenda_id=current_setting('qa.nueva')::uuid and cliente_id='d2000000-0000-4000-8000-000000000001' and renovacion='VERANO'),
  (select id from public.prenda_clientes where prenda_id=current_setting('qa.nueva')::uuid and cliente_id='d2000000-0000-4000-8000-000000000001' and renovacion='INVIERNO'))::jsonb);
select pg_temp.ok(pg_temp.qty('d2000000-0000-4000-8000-000000000001','VERANO','MNT001')=4 and pg_temp.qty('d2000000-0000-4000-8000-000000000001','INVIERNO','MNT001')=4,'VERANO+INVIERNO pasan a AMBOS (cantidad 4) en un solo guardado');
select pg_temp.denied($q$select public.admin_eliminar_catalogo('clientes','d2000000-0000-4000-8000-000000000001')$q$,'55000','un cliente con asignaciones solo se desactiva');
select pg_temp.ok((public.admin_capacidades_catalogo('clientes',array['d2000000-0000-4000-8000-000000000001']::uuid[])->>'d2000000-0000-4000-8000-000000000001')::boolean=false,'capacidades: cliente con asignaciones no se puede eliminar');
reset role;

rollback;

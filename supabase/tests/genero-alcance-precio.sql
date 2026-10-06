-- Valida (con "set local role authenticated") dos cosas:
--  A. El género va en la asignación por cliente: la corbata guinda 11UNTCPLC073 es HOMBRE para RENIEC y AMBOS para
--     INDECOPI; las casacas taslan 11UNCASTASL001 son MUJER para RENIEC y AMBOS para INDECOPI. El formulario y
--     crear_requerimiento / editar_prendas_requerimiento validan contra la asignación del cliente, y reimportar un
--     cliente actualiza solo SU género (sin alerta de ficha).
--  B. Cambio de precio / código de almacén con alcance (ahora | tramite | todos): "ahora" no toca requerimientos,
--     "tramite" actualiza Pendiente/Observado, "todos" (solo superadmin) también Atendido; todo queda en
--     admin_catalog_audit con las líneas afectadas y sus valores anteriores; los totales salen de las líneas.
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
create function pg_temp.gen(cliente uuid,codigo text) returns text language sql as $$
  select genero from public.listar_prendas_cliente(cliente,'VERANO') where codigo_prenda=codigo $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('f1000000-0000-4000-8000-000000000001','admin-gen@example.test','{}'),
 ('f1000000-0000-4000-8000-000000000002','coord-gen@example.test','{}'),
 ('f1000000-0000-4000-8000-000000000003','super-gen@example.test','{}');
update public.profiles set role='admin' where id='f1000000-0000-4000-8000-000000000001';
update public.profiles set role='coordinador' where id='f1000000-0000-4000-8000-000000000002';
update public.profiles set role='superadmin' where id='f1000000-0000-4000-8000-000000000003';
insert into public.clientes(id,nombre,activo) values
 ('f2000000-0000-4000-8000-000000000001','RENIEC',true),('f2000000-0000-4000-8000-000000000002','INDECOPI',true);
insert into public.unidades(id,cliente_id,nombre,activo) values
 ('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','RENIEC SEDE',true),
 ('f3000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000002','INDECOPI SEDE',true);
insert into public.personal(id,codigo_personal,nombre,dni,cargo,activo) values
 ('f4000000-0000-4000-8000-000000000001','GEN-1','TRABAJADOR','55555551','AGENTE',true);

\echo '--- A. género por cliente ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select public.admin_importar_prendas('f2000000-0000-4000-8000-000000000001',
 '[{"fila":2,"codigo_prenda":"11UNTCPLC073","nombre_prenda":"CORBATA GUINDA","codigo_almacen":"UNF1","precio":15,"cantidad":1,"genero":"HOMBRE","renovacion":"AMBOS","activo":true},
   {"fila":3,"codigo_prenda":"11UNCASTASL001","nombre_prenda":"CASACA TASLAN","codigo_almacen":"UNF2","precio":120,"cantidad":1,"genero":"MUJER","renovacion":"AMBOS","activo":true},
   {"fila":4,"codigo_prenda":"CAM001","nombre_prenda":"CAMISA","codigo_almacen":"UNF4","precio":40,"cantidad":2,"genero":"HOMBRE","renovacion":"AMBOS","activo":true}]',true);
select set_config('qa.ind',public.admin_importar_prendas('f2000000-0000-4000-8000-000000000002',
 '[{"fila":2,"codigo_prenda":"11UNTCPLC073","nombre_prenda":"CORBATA GUINDA","codigo_almacen":"UNF1","precio":15,"cantidad":3,"genero":"AMBOS","renovacion":"AMBOS","activo":true},
   {"fila":3,"codigo_prenda":"11UNCASTASL001","nombre_prenda":"CASACA TASLAN","codigo_almacen":"UNF2","precio":120,"cantidad":2,"genero":"AMBOS","renovacion":"AMBOS","activo":true}]',true)::text,true);
select pg_temp.ok(jsonb_array_length(current_setting('qa.ind')::jsonb->'alertas')=0,'importar INDECOPI con otro género para las mismas prendas NO genera alerta de ficha');
select pg_temp.ok((select count(*)=2 from public.prendas where codigo_prenda in ('11UNTCPLC073','11UNCASTASL001')),'la ficha es una sola por código');
select pg_temp.ok(pg_temp.gen('f2000000-0000-4000-8000-000000000001','11UNTCPLC073')='HOMBRE' and pg_temp.gen('f2000000-0000-4000-8000-000000000002','11UNTCPLC073')='AMBOS','la corbata guinda es HOMBRE para RENIEC y AMBOS para INDECOPI');
select pg_temp.ok(pg_temp.gen('f2000000-0000-4000-8000-000000000001','11UNCASTASL001')='MUJER' and pg_temp.gen('f2000000-0000-4000-8000-000000000002','11UNCASTASL001')='AMBOS','la casaca taslan es MUJER para RENIEC y AMBOS para INDECOPI');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select set_config('qa.cor',(select id::text from public.prendas where codigo_prenda='11UNTCPLC073'),true);
select set_config('qa.cas',(select id::text from public.prendas where codigo_prenda='11UNCASTASL001'),true);
select set_config('qa.cam',(select id::text from public.prendas where codigo_prenda='CAM001'),true);
select pg_temp.denied(format($q$select public.crear_requerimiento('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"%s"}]',gen_random_uuid(),'MUJER')$q$,current_setting('qa.cor')),'22023','RENIEC: corbata (HOMBRE) para una trabajadora MUJER se rechaza');
select pg_temp.denied(format($q$select public.crear_requerimiento('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"%s"}]',gen_random_uuid(),'HOMBRE')$q$,current_setting('qa.cas')),'22023','RENIEC: casaca (MUJER) para un trabajador HOMBRE se rechaza');
select set_config('qa.r1',public.crear_requerimiento('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','VERANO',format('[{"prenda_id":"%s"}]',current_setting('qa.cor'))::jsonb,gen_random_uuid(),'HOMBRE')::text,true);
select set_config('qa.r2',public.crear_requerimiento('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000002','VERANO',format('[{"prenda_id":"%s"},{"prenda_id":"%s"}]',current_setting('qa.cor'),current_setting('qa.cas'))::jsonb,gen_random_uuid(),'MUJER')::text,true);
select pg_temp.ok((select count(*)=1 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.r1')::uuid) and (select count(*)=2 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.r2')::uuid),'RENIEC HOMBRE con la corbata y INDECOPI MUJER con corbata y casaca (AMBOS) se aceptan');
select pg_temp.denied(format($q$select public.crear_requerimiento('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"%s"}]',gen_random_uuid(),null)$q$,current_setting('qa.cor')),'22023','el género es obligatorio al crear');
select pg_temp.denied(format($q$select public.crear_requerimiento('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','VERANO','[{"prenda_id":"%s"}]',gen_random_uuid(),'AMBOS')$q$,current_setting('qa.cor')),'22023','el género de la trabajadora es HOMBRE o MUJER, no AMBOS');
-- edición: las prendas NUEVAS se validan con el género indicado (según la asignación del cliente)
select set_config('qa.ver',(public.obtener_edicion_prendas(current_setting('qa.r1')::uuid)->>'version'),true);
select set_config('qa.d',(select id::text from public.detalle_requerimiento where requerimiento_id=current_setting('qa.r1')::uuid),true);
select pg_temp.ok((public.obtener_edicion_prendas(current_setting('qa.r1')::uuid)->'requerimiento'->'detalle_requerimiento'->0->'prendas'->>'genero')='HOMBRE','la edición expone el género de la asignación (HOMBRE en RENIEC)');
select pg_temp.denied(format($q$select public.editar_prendas_requerimiento('%s','%s','[{"prenda_id":"%s","detalle_id":"%s"},{"prenda_id":"%s"}]','MUJER')$q$,current_setting('qa.r1'),current_setting('qa.ver'),current_setting('qa.cor'),current_setting('qa.d'),current_setting('qa.cam')),'22023','editar: la camisa (HOMBRE en RENIEC) no cuadra con género MUJER');
select pg_temp.denied(format($q$select public.editar_prendas_requerimiento('%s','%s','[{"prenda_id":"%s","detalle_id":"%s"},{"prenda_id":"%s"}]','AMBOS')$q$,current_setting('qa.r1'),current_setting('qa.ver'),current_setting('qa.cor'),current_setting('qa.d'),current_setting('qa.cam')),'22023','editar: género inválido');
select public.editar_prendas_requerimiento(current_setting('qa.r1')::uuid,current_setting('qa.ver'),format('[{"prenda_id":"%s","detalle_id":"%s"},{"prenda_id":"%s"}]',current_setting('qa.cor'),current_setting('qa.d'),current_setting('qa.cam'))::jsonb,'HOMBRE');
select pg_temp.ok((select count(*)=2 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.r1')::uuid and activo),'editar: la camisa HOMBRE entra con género HOMBRE');
reset role;

\echo '--- A. el listado de requerimientos filtra por el género de la asignación del cliente ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select pg_temp.ok((public.admin_consultar_requerimientos_v2(p_genero=>'MUJER')->>'total')::int=1 and (public.admin_consultar_requerimientos_v2(p_genero=>'HOMBRE')->>'total')::int=2,'filtro MUJER: solo el de INDECOPI (AMBOS); filtro HOMBRE: ambos (HOMBRE en RENIEC, AMBOS en INDECOPI)');

\echo '--- A. reimportar un cliente actualiza solo su género ---'
select set_config('qa.reimp',public.admin_importar_prendas('f2000000-0000-4000-8000-000000000001',
 '[{"fila":2,"codigo_prenda":"11UNTCPLC073","nombre_prenda":"CORBATA GUINDA","codigo_almacen":"UNF1","precio":15,"cantidad":1,"genero":"AMBOS","renovacion":"AMBOS","activo":true}]',false)::text,true);
select pg_temp.ok((current_setting('qa.reimp')::jsonb->>'generos_actualizados')::int=1 and jsonb_array_length(current_setting('qa.reimp')::jsonb->'alertas')=0 and (current_setting('qa.reimp')::jsonb->>'asignaciones_nuevas')::int=0,'vista previa: 1 género actualizado, sin alerta de ficha, sin asignaciones nuevas');
select pg_temp.ok(pg_temp.gen('f2000000-0000-4000-8000-000000000001','11UNTCPLC073')='HOMBRE','la vista previa no cambia nada');
select public.admin_importar_prendas('f2000000-0000-4000-8000-000000000001','[{"fila":2,"codigo_prenda":"11UNTCPLC073","nombre_prenda":"CORBATA GUINDA","codigo_almacen":"UNF1","precio":15,"cantidad":1,"genero":"AMBOS","renovacion":"AMBOS","activo":true}]',true);
select pg_temp.ok(pg_temp.gen('f2000000-0000-4000-8000-000000000001','11UNTCPLC073')='AMBOS','RENIEC: la corbata pasa a AMBOS');
select pg_temp.ok(pg_temp.gen('f2000000-0000-4000-8000-000000000002','11UNTCPLC073')='AMBOS' and pg_temp.gen('f2000000-0000-4000-8000-000000000001','11UNCASTASL001')='MUJER' and pg_temp.gen('f2000000-0000-4000-8000-000000000001','CAM001')='HOMBRE','INDECOPI y las demás prendas de RENIEC no cambian de género');
select pg_temp.ok((select count(*)=1 from public.prendas where codigo_prenda='11UNTCPLC073'),'sigue habiendo una sola ficha');
reset role;

\echo '--- Mantenimiento: el género se edita en cada asignación ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select public.admin_guardar_catalogo('prendas',current_setting('qa.cor')::uuid,format('{"codigo_prenda":"11UNTCPLC073","nombre_prenda":"CORBATA GUINDA","codigo_almacen":"UNF1","precio":15,"asignaciones":[{"id":"%s","cliente_id":"f2000000-0000-4000-8000-000000000001","renovacion":"AMBOS","genero":"HOMBRE","cantidad":1,"activo":true}]}',
  (select a.id from public.prenda_clientes a where a.prenda_id=current_setting('qa.cor')::uuid and a.cliente_id='f2000000-0000-4000-8000-000000000001'))::jsonb);
select pg_temp.ok(pg_temp.gen('f2000000-0000-4000-8000-000000000001','11UNTCPLC073')='HOMBRE' and pg_temp.gen('f2000000-0000-4000-8000-000000000002','11UNTCPLC073')='AMBOS','editar el género de la asignación de RENIEC no toca la de INDECOPI');
select pg_temp.denied(format($q$select public.admin_guardar_catalogo('prendas','%s','{"codigo_prenda":"11UNTCPLC073","nombre_prenda":"CORBATA GUINDA","codigo_almacen":"UNF1","precio":15,"genero":"HOMBRE"}')$q$,current_setting('qa.cor')),'22023','la ficha ya no admite género');
select pg_temp.denied(format($q$select public.admin_guardar_catalogo('prendas','%s','{"codigo_prenda":"11UNTCPLC073","nombre_prenda":"CORBATA GUINDA","codigo_almacen":"UNF1","precio":15,"asignaciones":[{"cliente_id":"f2000000-0000-4000-8000-000000000001","renovacion":"VERANO","cantidad":1,"activo":true}]}')$q$,current_setting('qa.cor')),'22023','una asignación sin género se rechaza');
select pg_temp.ok((select bool_and(a->>'genero' is not null) from jsonb_array_elements((select r->'asignaciones' from jsonb_array_elements(public.admin_listar_catalogo('prendas',p_busqueda=>'11UNTCPLC073')->'rows') r)) a),'el listado devuelve el género en cada asignación');
select pg_temp.ok((public.admin_listar_catalogo('prendas',p_cliente_id=>'f2000000-0000-4000-8000-000000000001',p_genero=>'MUJER')->>'total')::int=1,'filtro por cliente + género: solo la casaca (MUJER en RENIEC)');
reset role;

\echo '--- B. cambio de precio con alcance ---'
-- requerimientos de RENIEC con la camisa (precio 40): r1 (Pendiente, ya existe), Pendiente, Observado y Atendido
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select set_config('qa.rp',public.crear_requerimiento('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','VERANO',format('[{"prenda_id":"%s"}]',current_setting('qa.cam'))::jsonb,gen_random_uuid(),'HOMBRE')::text,true);
select set_config('qa.ro',public.crear_requerimiento('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','VERANO',format('[{"prenda_id":"%s"}]',current_setting('qa.cam'))::jsonb,gen_random_uuid(),'HOMBRE')::text,true);
select set_config('qa.ra',public.crear_requerimiento('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','VERANO',format('[{"prenda_id":"%s"}]',current_setting('qa.cam'))::jsonb,gen_random_uuid(),'HOMBRE')::text,true);
reset role;
update public.requerimientos set estado='Observado' where id=current_setting('qa.ro')::uuid;
update public.requerimientos set estado='Atendido' where id=current_setting('qa.ra')::uuid;
create function pg_temp.precios() returns text language sql as $$
  select string_agg(r.estado::text||':'||d.precio_unitario::text,' ' order by r.estado::text) from public.detalle_requerimiento d join public.requerimientos r on r.id=d.requerimiento_id
  where d.prenda_id=current_setting('qa.cam')::uuid and r.id in (current_setting('qa.rp')::uuid,current_setting('qa.ro')::uuid,current_setting('qa.ra')::uuid) $$;
select pg_temp.ok(pg_temp.precios()='Atendido:40.00 Observado:40.00 Pendiente:40.00','punto de partida: las líneas de la camisa tienen precio 40');
select pg_temp.denied($q$update public.detalle_requerimiento set precio_unitario=1 where prenda_id=(select id from public.prendas where codigo_prenda='CAM001')$q$,'P0001','el historial sigue protegido contra cambios directos');

set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('qa.imp',public.admin_impacto_cambio_ficha(current_setting('qa.cam')::uuid,45,'UNF4')::text,true);
select pg_temp.ok((current_setting('qa.imp')::jsonb->'tramite'->>'requerimientos')::int=3 and (current_setting('qa.imp')::jsonb->'tramite'->>'lineas')::int=3 and (current_setting('qa.imp')::jsonb->'todos'->>'requerimientos')::int=4,'impacto 40 -> 45: en trámite 3 requerimientos/3 líneas (r1, Pendiente, Observado); en total 4');
select pg_temp.ok((public.admin_impacto_cambio_ficha(current_setting('qa.cam')::uuid,40,'UNF4')->'todos'->>'lineas')::int=0,'sin cambio de precio ni de almacén no hay impacto');
select pg_temp.denied(format($q$select public.admin_guardar_catalogo('prendas','%s','{"codigo_prenda":"CAM001","nombre_prenda":"CAMISA","codigo_almacen":"UNF4","precio":45}')$q$,current_setting('qa.cam')),'22023','cambiar el precio sin elegir alcance se rechaza');
select pg_temp.denied(format($q$select public.admin_guardar_catalogo('prendas','%s','{"codigo_prenda":"CAM001","nombre_prenda":"CAMISA","codigo_almacen":"UNF4","precio":45,"alcance":"todos"}')$q$,current_setting('qa.cam')),'42501','"Todos" exige superadmin (un admin es rechazado)');
select pg_temp.ok((select precio=40 from public.prendas where codigo_prenda='CAM001') and pg_temp.precios()='Atendido:40.00 Observado:40.00 Pendiente:40.00','el rechazo no dejó cambios a medias');
-- Solo desde ahora
select public.admin_guardar_catalogo('prendas',current_setting('qa.cam')::uuid,'{"codigo_prenda":"CAM001","nombre_prenda":"CAMISA","codigo_almacen":"UNF4","precio":45,"alcance":"ahora"}');
select pg_temp.ok((select precio=45 from public.prendas where codigo_prenda='CAM001') and pg_temp.precios()='Atendido:40.00 Observado:40.00 Pendiente:40.00','"Solo desde ahora": la ficha pasa a 45 y NINGÚN requerimiento existente cambia');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select set_config('qa.rn',public.crear_requerimiento('f4000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','VERANO',format('[{"prenda_id":"%s"}]',current_setting('qa.cam'))::jsonb,gen_random_uuid(),'HOMBRE')::text,true);
select pg_temp.ok((select precio_unitario=45 from public.detalle_requerimiento where requerimiento_id=current_setting('qa.rn')::uuid),'una línea nueva guarda como copia el precio vigente (45)');
reset role;

-- También requerimientos en trámite
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('qa.imp2',public.admin_impacto_cambio_ficha(current_setting('qa.cam')::uuid,50,'UNF4')::text,true);
select pg_temp.ok((current_setting('qa.imp2')::jsonb->'tramite'->>'lineas')::int=3 and (current_setting('qa.imp2')::jsonb->'todos'->>'lineas')::int=5,'impacto 45 -> 50: 3 líneas en trámite (la nueva incluida, r1 no: sigue en 40... ver abajo) y 5 en total');
select public.admin_guardar_catalogo('prendas',current_setting('qa.cam')::uuid,'{"codigo_prenda":"CAM001","nombre_prenda":"CAMISA","codigo_almacen":"UNF4","precio":50,"alcance":"tramite"}');
select pg_temp.ok(pg_temp.precios()='Atendido:40.00 Observado:50.00 Pendiente:50.00','"También en trámite": Pendiente y Observado pasan a 50; Atendido sigue en 40');
reset role;
select pg_temp.ok((select d.precio_unitario=50 from public.detalle_requerimiento d where d.requerimiento_id=current_setting('qa.r1')::uuid and d.prenda_id=current_setting('qa.cam')::uuid),'el requerimiento en trámite r1 también se actualizó');

-- Los totales salen de las líneas: nada que recalcular
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select pg_temp.ok((select (r->>'total_requerimiento')::numeric=100 from jsonb_array_elements(public.admin_consultar_requerimientos_v2()->'rows') r where r->>'id'=current_setting('qa.rp')),'el total del requerimiento afectado (cantidad 2 x 50) es 100: se recalcula solo');
reset role;

-- Todos: solo superadmin
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
select public.admin_guardar_catalogo('prendas',current_setting('qa.cam')::uuid,'{"codigo_prenda":"CAM001","nombre_prenda":"CAMISA","codigo_almacen":"UNF4","precio":55,"alcance":"todos"}');
select pg_temp.ok(pg_temp.precios()='Atendido:55.00 Observado:55.00 Pendiente:55.00','"Todos" (superadmin): incluso el requerimiento Atendido pasa a 55');
reset role;

\echo '--- B. auditoría: líneas afectadas con valores anteriores ---'
select pg_temp.ok((select count(*)=3 from private.admin_catalog_audit where accion='CAMBIAR_FICHA' and registro_id=current_setting('qa.cam')::uuid),'se registró cada cambio de precio (ahora, tramite, todos)');
select pg_temp.ok((select valores_despues->>'alcance'='ahora' and (valores_despues->>'lineas_afectadas')::int=0 and valores_antes->>'precio'='40.00' from private.admin_catalog_audit where accion='CAMBIAR_FICHA' and valores_despues->>'alcance'='ahora' and registro_id=current_setting('qa.cam')::uuid),'"ahora": 0 líneas afectadas, precio anterior 40');
select pg_temp.ok((select (valores_despues->>'lineas_afectadas')::int=4 and jsonb_array_length(valores_despues->'lineas')=4 and valores_despues->'lineas'->0->>'precio_anterior' is not null and valores_despues->'lineas'->0->>'id' is not null and valores_despues->>'origen'='MANTENIMIENTO' from private.admin_catalog_audit where accion='CAMBIAR_FICHA' and valores_despues->>'alcance'='tramite' and registro_id=current_setting('qa.cam')::uuid),'"tramite": líneas con id y precio anterior (para poder revertir)');
select pg_temp.ok((select usuario_id='f1000000-0000-4000-8000-000000000003' and (valores_despues->>'lineas_afectadas')::int=5 from private.admin_catalog_audit where accion='CAMBIAR_FICHA' and valores_despues->>'alcance'='todos' and registro_id=current_setting('qa.cam')::uuid),'"todos": registra al superadmin y las 5 líneas');

\echo '--- B. código de almacén y nombre ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select public.admin_guardar_catalogo('prendas',current_setting('qa.cam')::uuid,'{"codigo_prenda":"CAM001","nombre_prenda":"CAMISA MANGA LARGA","codigo_almacen":"UNF4B","precio":55,"alcance":"tramite"}');
reset role;
select pg_temp.ok((select count(*) filter(where d.codigo_almacen='UNF4B')=4 and count(*) filter(where d.codigo_almacen='UNF4')=1 from public.detalle_requerimiento d where d.prenda_id=current_setting('qa.cam')::uuid),'código de almacén: 4 líneas en trámite lo actualizan; la del requerimiento Atendido conserva UNF4');
select pg_temp.ok((select p.nombre_prenda='CAMISA MANGA LARGA' from public.detalle_requerimiento d join public.prendas p on p.id=d.prenda_id where d.requerimiento_id=current_setting('qa.ra')::uuid),'el nombre NO se copia a las líneas: se lee en vivo (también en el requerimiento Atendido)');

\echo '--- B. importación: "Actualizar" con alcance ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('qa.al',public.admin_importar_prendas('f2000000-0000-4000-8000-000000000001','[{"fila":2,"codigo_prenda":"CAM001","nombre_prenda":"CAMISA MANGA LARGA","codigo_almacen":"UNF4B","precio":60,"cantidad":2,"genero":"HOMBRE","renovacion":"AMBOS","activo":true}]',false)::text,true);
select pg_temp.ok(current_setting('qa.al')::jsonb->'alertas'->0->'impacto'->'tramite'->>'lineas'='4' and current_setting('qa.al')::jsonb->'alertas'->0->'impacto'->'todos'->>'lineas'='5','la alerta de importación trae el impacto: 4 líneas en trámite, 5 en total');
select public.admin_importar_prendas('f2000000-0000-4000-8000-000000000001','[{"fila":2,"codigo_prenda":"CAM001","nombre_prenda":"CAMISA MANGA LARGA","codigo_almacen":"UNF4B","precio":60,"cantidad":2,"genero":"HOMBRE","renovacion":"AMBOS","activo":true}]',true,'{}'::jsonb);
select pg_temp.ok((select precio=55 from public.prendas where codigo_prenda='CAM001'),'"Mantener actual" (sin decisión): la ficha conserva 55');
select pg_temp.denied($q$select public.admin_importar_prendas('f2000000-0000-4000-8000-000000000001','[{"fila":2,"codigo_prenda":"CAM001","nombre_prenda":"CAMISA MANGA LARGA","codigo_almacen":"UNF4B","precio":60,"cantidad":2,"genero":"HOMBRE","renovacion":"AMBOS","activo":true}]',true,'{"CAM001":"todos"}'::jsonb)$q$,'42501','importar con alcance "todos" exige superadmin');
select pg_temp.denied($q$select public.admin_importar_prendas('f2000000-0000-4000-8000-000000000001','[{"fila":2,"codigo_prenda":"CAM001","nombre_prenda":"CAMISA MANGA LARGA","codigo_almacen":"UNF4B","precio":60,"cantidad":2,"genero":"HOMBRE","renovacion":"AMBOS","activo":true}]',true,'{"CAM001":"siempre"}'::jsonb)$q$,'22023','alcance inválido');
select public.admin_importar_prendas('f2000000-0000-4000-8000-000000000001','[{"fila":2,"codigo_prenda":"CAM001","nombre_prenda":"CAMISA MANGA LARGA","codigo_almacen":"UNF4B","precio":60,"cantidad":2,"genero":"HOMBRE","renovacion":"AMBOS","activo":true}]',true,'{"CAM001":"ahora"}'::jsonb);
reset role;
select pg_temp.ok((select precio=60 from public.prendas where codigo_prenda='CAM001') and (select count(*)=5 and bool_and(precio_unitario=55) from public.detalle_requerimiento where prenda_id=current_setting('qa.cam')::uuid and requerimiento_id<>current_setting('qa.r1')::uuid or true),'importar con "Solo desde ahora": la ficha pasa a 60');
select pg_temp.ok((select count(*)=5 and bool_and(precio_unitario=55) from public.detalle_requerimiento where prenda_id=current_setting('qa.cam')::uuid),'...y ninguna línea cambia (las 5 siguen en 55)');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
select set_config('qa.ap',public.admin_importar_prendas('f2000000-0000-4000-8000-000000000001','[{"fila":2,"codigo_prenda":"CAM001","nombre_prenda":"CAMISA MANGA LARGA","codigo_almacen":"UNF4B","precio":70,"cantidad":2,"genero":"HOMBRE","renovacion":"AMBOS","activo":true}]',true,'{"CAM001":"tramite"}'::jsonb)::text,true);
select pg_temp.ok(current_setting('qa.ap')::jsonb->'cambios_ficha'->0->>'alcance'='tramite' and (current_setting('qa.ap')::jsonb->'cambios_ficha'->0->>'lineas')::int=4,'importar con "tramite" informa las 4 líneas actualizadas');
reset role;
select pg_temp.ok((select count(*) filter(where precio_unitario=70)=4 and count(*) filter(where precio_unitario=55)=1 from public.detalle_requerimiento where prenda_id=current_setting('qa.cam')::uuid),'4 líneas en trámite a 70; la Atendida sigue en 55');
select pg_temp.ok((select count(*)>=1 from private.admin_catalog_audit where accion='CAMBIAR_FICHA' and valores_despues->>'origen'='IMPORTAR' and (valores_despues->>'lineas_afectadas')::int=4),'el cambio por importación también queda auditado con sus líneas');

rollback;

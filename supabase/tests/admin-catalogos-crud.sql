-- SOLO base descartable con todas las migraciones. Fixtures revertidos.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;
create function pg_temp.denied(command text) returns void language plpgsql as $$begin begin execute command;exception when others then raise notice 'PASS: denied %',sqlstate;return;end;raise exception 'FAIL: operation accepted';end$$;
insert into auth.users(id,email,raw_user_meta_data) values
 ('18000000-0000-4000-8000-000000000001','crud-admin@example.test','{}'),
 ('18000000-0000-4000-8000-000000000002','crud-coord@example.test','{}');
update public.profiles set role='admin' where id='18000000-0000-4000-8000-000000000001';
insert into public.personal(id,codigo_personal,nombre,dni,cargo) values
 ('28000000-0000-4000-8000-000000000001','CRUD-P0','Agente histórico','12345678','Agente');
insert into public.clientes(id,nombre) values
 ('58000000-0000-4000-8000-000000000001','Cliente histórico'),
 ('58000000-0000-4000-8000-000000000002','Cliente alterno');
insert into public.unidades(id,cliente_id,nombre) values
 ('68000000-0000-4000-8000-000000000001','58000000-0000-4000-8000-000000000001','Unidad histórica');
insert into public.prendas(id,codigo_prenda,nombre_prenda,codigo_almacen,precio,cantidad,cliente,genero) values
 ('38000000-0000-4000-8000-000000000001','CRUD-G0','Prenda histórica','HIST-1',20,2,'Cliente histórico','AMBOS');
insert into public.requerimientos(id,agente_id,usuario_creador_id,cliente_id,unidad_id) values
 ('48000000-0000-4000-8000-000000000001','28000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000002','58000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000001');
insert into public.detalle_requerimiento(id,requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
values('78000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000001','38000000-0000-4000-8000-000000000001',2,20,'HIST-1');

set local role authenticated;
select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000002',true);
select pg_temp.denied($q$select public.admin_guardar_catalogo('clientes',null,'{"nombre":"Denegado"}')$q$);
select pg_temp.denied($q$select public.admin_eliminar_catalogo('unidades','68000000-0000-4000-8000-000000000001')$q$);
select pg_temp.denied($q$select public.admin_actualizar_catalogo_activo('personal','28000000-0000-4000-8000-000000000001',false)$q$);

select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000001',true);
select public.admin_guardar_catalogo('clientes',null,'{"nombre":"  Cliente Nuevo  "}');
select pg_temp.ok(exists(select 1 from public.clientes where nombre='Cliente Nuevo' and activo),'crea cliente aplicando trim');
select pg_temp.denied($q$select public.admin_guardar_catalogo('clientes',null,'{"nombre":"cliente nuevo"}')$q$);
select public.admin_guardar_catalogo('clientes',(select id from public.clientes where nombre='Cliente Nuevo'),'{"nombre":"Cliente Editado"}');
select pg_temp.ok(exists(select 1 from public.clientes where nombre='Cliente Editado'),'edita cliente');
select public.admin_actualizar_catalogo_activo('clientes',(select id from public.clientes where nombre='Cliente Editado'),false);
select public.admin_actualizar_catalogo_activo('clientes',(select id from public.clientes where nombre='Cliente Editado'),true);
select pg_temp.ok((select activo from public.clientes where nombre='Cliente Editado'),'desactiva y reactiva cliente');

select public.admin_guardar_catalogo('unidades',null,jsonb_build_object('cliente_id',(select id::text from public.clientes where nombre='Cliente Editado'),'nombre','Sede Nueva'));
select pg_temp.ok(exists(select 1 from public.unidades where nombre='Sede Nueva'),'crea unidad');
select pg_temp.denied(format($q$select public.admin_guardar_catalogo('unidades',null,'{"cliente_id":"%s","nombre":"sede nueva"}')$q$,(select id from public.clientes where nombre='Cliente Editado')));
select public.admin_guardar_catalogo('unidades',(select id from public.unidades where nombre='Sede Nueva'),jsonb_build_object('cliente_id',(select id::text from public.clientes where nombre='Cliente Editado'),'nombre','Sede Editada'));
select pg_temp.ok(exists(select 1 from public.unidades where nombre='Sede Editada'),'edita unidad');
select public.admin_actualizar_catalogo_activo('unidades',(select id from public.unidades where nombre='Sede Editada'),false);
select public.admin_actualizar_catalogo_activo('unidades',(select id from public.unidades where nombre='Sede Editada'),true);
select public.admin_eliminar_catalogo('unidades',(select id from public.unidades where nombre='Sede Editada'));
select pg_temp.ok(not exists(select 1 from public.unidades where nombre='Sede Editada'),'elimina unidad nunca usada');
select pg_temp.denied($q$select public.admin_eliminar_catalogo('unidades','68000000-0000-4000-8000-000000000001')$q$);
select pg_temp.denied($q$select public.admin_guardar_catalogo('unidades','68000000-0000-4000-8000-000000000001','{"cliente_id":"58000000-0000-4000-8000-000000000002","nombre":"Unidad histórica"}')$q$);
select pg_temp.denied($q$select public.admin_eliminar_catalogo('clientes','58000000-0000-4000-8000-000000000001')$q$);

select public.admin_guardar_catalogo('unidades',null,'{"cliente_id":"58000000-0000-4000-8000-000000000002","nombre":"Unidad histórica"}');
select pg_temp.ok((select count(*)=2 from public.unidades where nombre='Unidad histórica'),'permite mismo nombre de unidad en clientes distintos');
select public.admin_actualizar_catalogo_activo('unidades',(select id from public.unidades where cliente_id='58000000-0000-4000-8000-000000000002' and nombre='Unidad histórica'),false);
select public.admin_actualizar_catalogo_activo('clientes','58000000-0000-4000-8000-000000000002',false);
select pg_temp.denied(format($q$select public.admin_actualizar_catalogo_activo('unidades','%s',true)$q$,
  (select id from public.unidades where cliente_id='58000000-0000-4000-8000-000000000002' and nombre='Unidad histórica')));
select public.admin_actualizar_catalogo_activo('clientes','58000000-0000-4000-8000-000000000002',true);
select public.admin_eliminar_catalogo('unidades',(select id from public.unidades where cliente_id='58000000-0000-4000-8000-000000000002' and nombre='Unidad histórica'));

select public.admin_guardar_catalogo('clientes',null,'{"nombre":"Cliente Temporal"}');
select public.admin_eliminar_catalogo('clientes',(select id from public.clientes where nombre='Cliente Temporal'));
select pg_temp.ok(not exists(select 1 from public.clientes where nombre='Cliente Temporal'),'elimina cliente sin relaciones');
select public.admin_actualizar_catalogo_activo('clientes','58000000-0000-4000-8000-000000000002',false);
select pg_temp.denied($q$select public.admin_guardar_catalogo('unidades',null,'{"cliente_id":"58000000-0000-4000-8000-000000000002","nombre":"No permitida"}')$q$);
select public.admin_actualizar_catalogo_activo('clientes','58000000-0000-4000-8000-000000000002',true);

select public.admin_guardar_catalogo('personal',null,'{"codigo_personal":"CRUD-P1","nombre":"Persona Nueva","dni":"87654321","cargo":"Agente"}');
select public.admin_guardar_catalogo('personal',(select id from public.personal where codigo_personal='CRUD-P1'),'{"codigo_personal":"CRUD-P1","nombre":"Persona Editada","dni":"87654322","cargo":"Supervisor"}');
select public.admin_actualizar_catalogo_activo('personal',(select id from public.personal where codigo_personal='CRUD-P1'),false);
select public.admin_actualizar_catalogo_activo('personal',(select id from public.personal where codigo_personal='CRUD-P1'),true);
select pg_temp.ok(exists(select 1 from public.personal where codigo_personal='CRUD-P1' and nombre='Persona Editada' and activo),'crea edita y cambia estado de personal');

select public.admin_guardar_catalogo('prendas',null,'{"codigo_prenda":"CRUD-G1","nombre_prenda":"Prenda Nueva","codigo_almacen":"ALM-2","precio":35.50,"cantidad":3,"cliente_id":"58000000-0000-4000-8000-000000000001","genero":"HOMBRE"}');
select public.admin_guardar_catalogo('prendas',(select id from public.prendas where codigo_prenda='CRUD-G1'),'{"codigo_prenda":"CRUD-G1","nombre_prenda":"Prenda Editada","codigo_almacen":"ALM-3","precio":40,"cantidad":4,"cliente_id":"58000000-0000-4000-8000-000000000001","genero":"AMBOS"}');
select public.admin_actualizar_catalogo_activo('prendas',(select id from public.prendas where codigo_prenda='CRUD-G1'),false);
select public.admin_actualizar_catalogo_activo('prendas',(select id from public.prendas where codigo_prenda='CRUD-G1'),true);
select pg_temp.ok(exists(select 1 from public.prendas where codigo_prenda='CRUD-G1' and nombre_prenda='Prenda Editada' and activo),'crea edita y cambia estado de prendas');
select public.admin_guardar_catalogo('prendas','38000000-0000-4000-8000-000000000001','{"codigo_prenda":"CRUD-G0","nombre_prenda":"Maestro editado","codigo_almacen":"NUEVO","precio":99,"cantidad":5,"cliente_id":"58000000-0000-4000-8000-000000000001","genero":"AMBOS"}');
select public.admin_guardar_catalogo('clientes','58000000-0000-4000-8000-000000000001','{"nombre":"Cliente histórico editado"}');
reset role;
select pg_temp.ok((select cantidad=2 and precio_unitario=20 and codigo_almacen='HIST-1' from public.detalle_requerimiento where id='78000000-0000-4000-8000-000000000001') and exists(select 1 from public.requerimientos where id='48000000-0000-4000-8000-000000000001'),'edicion de maestro no altera historico');
select pg_temp.ok((select count(*)=2 from public.prendas where codigo_prenda in ('CRUD-G0','CRUD-G1') and cliente='Cliente histórico editado'),'renombrar cliente sincroniza prendas sin cambiar UUID historicos');
select pg_temp.ok((select count(*)>=12 from private.admin_catalog_audit where usuario_id='18000000-0000-4000-8000-000000000001') and exists(select 1 from private.admin_catalog_audit where accion='ELIMINAR'),'auditoria registra admin acciones y valores');
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where oid=any(array['public.personal'::regclass,'public.clientes'::regclass,'public.unidades'::regclass,'public.prendas'::regclass,'public.requerimientos'::regclass,'public.detalle_requerimiento'::regclass])),'RLS permanece habilitada');
rollback;

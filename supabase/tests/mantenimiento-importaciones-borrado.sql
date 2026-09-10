-- SOLO base descartable con todas las migraciones. Fixtures revertidos.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;
create function pg_temp.denied(command text) returns void language plpgsql as $$begin begin execute command;exception when others then raise notice 'PASS: denied %',sqlstate;return;end;raise exception 'FAIL: operation accepted';end$$;
insert into auth.users(id,email,raw_user_meta_data) values
 ('17000000-0000-4000-8000-000000000001','maint-admin@example.test','{}'),
 ('17000000-0000-4000-8000-000000000002','maint-coord@example.test','{}');
update public.profiles set role='admin' where id='17000000-0000-4000-8000-000000000001';
insert into public.personal(id,codigo_personal,nombre,dni,cargo) values
 ('27000000-0000-4000-8000-000000000001','M-P1','Agente prueba','12345678','Agente');
insert into public.clientes(id,nombre) values ('57000000-0000-4000-8000-000000000001','Cliente mantenimiento');
insert into public.unidades(id,cliente_id,nombre) values ('67000000-0000-4000-8000-000000000001','57000000-0000-4000-8000-000000000001','Unidad mantenimiento');
insert into public.prendas(id,codigo_prenda,nombre_prenda,codigo_almacen,precio,cantidad,cliente,genero) values
 ('37000000-0000-4000-8000-000000000001','M-G1','Prenda prueba','ALM-1',20,2,'Cliente mantenimiento','AMBOS');
insert into public.requerimientos(id,agente_id,usuario_creador_id,cliente_id,unidad_id,estado) values
 ('47000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002','57000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000001','Pendiente'),
 ('47000000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002','57000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000001','Observado'),
 ('47000000-0000-4000-8000-000000000003','27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002','57000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000001','Atendido'),
 ('47000000-0000-4000-8000-000000000004','27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002','57000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000001','Pendiente'),
 ('47000000-0000-4000-8000-000000000005','27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002','57000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000001','Pendiente');
insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
select id,'37000000-0000-4000-8000-000000000001',2,20,'HIST' from public.requerimientos where id::text like '47000000-0000-4000-8000-00000000000%';

set local role authenticated;
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000002',true);
select pg_temp.denied($q$select public.admin_eliminar_requerimientos_prueba(array['47000000-0000-4000-8000-000000000001'::uuid])$q$);
select pg_temp.denied($q$select public.admin_actualizar_catalogo_activo('clientes','57000000-0000-4000-8000-000000000001',false)$q$);
select pg_temp.denied($q$delete from public.requerimientos where id='47000000-0000-4000-8000-000000000001'$q$);

select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000001',true);
select pg_temp.ok(public.admin_eliminar_requerimientos_prueba(array['47000000-0000-4000-8000-000000000001'::uuid])=1,'admin elimina uno');
reset role;
select pg_temp.ok(not exists(select 1 from public.requerimientos where id='47000000-0000-4000-8000-000000000001') and not exists(select 1 from public.detalle_requerimiento where requerimiento_id='47000000-0000-4000-8000-000000000001'),'cabecera y detalles eliminados');
select pg_temp.ok((select tgenabled='O' from pg_trigger where tgname='proteger_historial_detalle'),'trigger sigue habilitado');
select pg_temp.denied($q$delete from public.detalle_requerimiento where requerimiento_id='47000000-0000-4000-8000-000000000002'$q$);
set local role authenticated;select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000001',true);
select pg_temp.ok(public.admin_eliminar_requerimientos_prueba(array['47000000-0000-4000-8000-000000000002'::uuid,'47000000-0000-4000-8000-000000000003'::uuid])=2,'admin elimina varios en cualquier estado');
reset role;

create function pg_temp.fail_delete() returns trigger language plpgsql as $$begin if old.id='47000000-0000-4000-8000-000000000005' then raise exception 'fallo simulado';end if;return old;end$$;
create trigger zz_test_fail before delete on public.requerimientos for each row execute function pg_temp.fail_delete();
set local role authenticated;select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000001',true);
select pg_temp.denied($q$select public.admin_eliminar_requerimientos_prueba(array['47000000-0000-4000-8000-000000000004'::uuid,'47000000-0000-4000-8000-000000000005'::uuid])$q$);
reset role;
select pg_temp.ok((select count(*)=2 from public.requerimientos where id=any(array['47000000-0000-4000-8000-000000000004'::uuid,'47000000-0000-4000-8000-000000000005'::uuid])) and (select count(*)=2 from public.detalle_requerimiento where requerimiento_id=any(array['47000000-0000-4000-8000-000000000004'::uuid,'47000000-0000-4000-8000-000000000005'::uuid])),'fallo revierte cabeceras y detalles');
drop trigger zz_test_fail on public.requerimientos;

set local role authenticated;select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000001',true);
select public.admin_actualizar_catalogo_activo('clientes','57000000-0000-4000-8000-000000000001',false);
select public.admin_actualizar_catalogo_activo('unidades','67000000-0000-4000-8000-000000000001',false);
select public.admin_actualizar_catalogo_activo('personal','27000000-0000-4000-8000-000000000001',false);
select public.admin_actualizar_catalogo_activo('prendas','37000000-0000-4000-8000-000000000001',false);
select pg_temp.ok((select not activo from public.clientes where id='57000000-0000-4000-8000-000000000001') and (select not activo from public.unidades where id='67000000-0000-4000-8000-000000000001'),'clientes y unidades usan baja lógica');
select pg_temp.ok((select not activo from public.personal where id='27000000-0000-4000-8000-000000000001') and (select not activo from public.prendas where id='37000000-0000-4000-8000-000000000001'),'personal y prendas usan baja lógica');
select pg_temp.ok((public.admin_importar_catalogo('personal','[{"codigo_personal":"M-P1","nombre":"Actualizado","dni":"87654321","cargo":"Supervisor","activo":true},{"codigo_personal":"M-P2","nombre":"Nuevo","dni":"11112222","cargo":"Agente","activo":true}]')->>'actualizados')::int=1,'importacion actualiza por codigo');
select pg_temp.ok((select count(*)=2 from public.personal where codigo_personal in ('M-P1','M-P2')),'importacion no duplica');
select pg_temp.ok((public.admin_importar_catalogo('prendas','[{"codigo_prenda":"M-G1","nombre_prenda":"Prenda actualizada","codigo_almacen":"A-2","precio":25.50,"cantidad":3,"cliente":"Cliente mantenimiento","genero":"HOMBRE","activo":true},{"codigo_prenda":"M-G2","nombre_prenda":"Prenda nueva","codigo_almacen":"A-3","precio":30,"cantidad":1,"cliente":"Cliente mantenimiento","genero":"AMBOS","activo":true}]')->>'nuevos')::int=1,'importacion prendas inserta y actualiza');
select pg_temp.ok((select count(*)=2 from public.prendas where codigo_prenda in ('M-G1','M-G2')),'importacion prendas no duplica');
select pg_temp.denied($q$select public.admin_importar_catalogo('personal','[{"codigo_personal":"M-X","nombre":"X","dni":"mal","cargo":"X","activo":true}]')$q$);
reset role;
update private.app_config set habilitado=false where clave='allow_test_requirement_deletion';
set local role authenticated;select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000001',true);
select pg_temp.denied($q$select public.admin_eliminar_requerimientos_prueba(array['47000000-0000-4000-8000-000000000004'::uuid])$q$);
reset role;
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where oid=any(array['public.profiles'::regclass,'public.personal'::regclass,'public.clientes'::regclass,'public.unidades'::regclass,'public.prendas'::regclass,'public.requerimientos'::regclass,'public.detalle_requerimiento'::regclass])),'RLS permanece habilitada');
rollback;

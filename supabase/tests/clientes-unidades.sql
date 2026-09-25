-- Ejecutar SOLO en una base de pruebas con todas las migraciones aplicadas.
-- No usar usuarios reales. Todas las inserciones de esta prueba se revierten.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %',label; end if;
  raise notice 'PASS: %',label;
end $$;
create function pg_temp.expect_error(command text, message text) returns void language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute command;
  exception when others then
    if sqlerrm !~ message then raise; end if;
    rejected := true;
  end;
  perform pg_temp.assert_true(rejected,message);
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
('11000000-0000-4000-8000-000000000001','qa-coordinador@example.test','{}'),
('11000000-0000-4000-8000-000000000002','qa-other@example.test','{}'),
('11000000-0000-4000-8000-000000000003','qa-admin@example.test','{}');
-- Toda cuenta nueva recibe 'sin_vincular' por default (ver 202609240008): coordinador/admin ya
-- no se pueden dejar en el default de la columna, hay que asignarlos explícitamente.
update profiles set role='coordinador' where id in ('11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002');
update profiles set role='admin' where id='11000000-0000-4000-8000-000000000003';
insert into personal(id,codigo_personal,nombre,dni,cargo) values
('22000000-0000-4000-8000-000000000001','QA-AGENT','Agente independiente','00112233','AVP');
insert into clientes(id,nombre,activo) values
('55000000-0000-4000-8000-000000000001','QA Cliente A',true),
('55000000-0000-4000-8000-000000000002','QA Cliente B',true),
('55000000-0000-4000-8000-000000000003','QA Inactivo',false);
insert into unidades(id,cliente_id,nombre,activo) values
('66000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','QA Unidad A',true),
('66000000-0000-4000-8000-000000000002','55000000-0000-4000-8000-000000000002','QA Unidad B',true),
('66000000-0000-4000-8000-000000000003','55000000-0000-4000-8000-000000000001','QA Unidad inactiva',false);
insert into prendas(id,codigo_prenda,nombre_prenda,codigo_almacen,precio,cliente,cantidad) values
('33000000-0000-4000-8000-000000000001','QA-A','QA Camisa','QA-ALM',25.75,'QA Cliente A',3),
('33000000-0000-4000-8000-000000000002','QA-B','QA Pantalón','QA-ALM-B',40,'QA Cliente B',2);

set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((select count(*)=2 from clientes where nombre like 'QA%'),'coordinador lee solo catálogos activos no relacionados');
select pg_temp.assert_true((select count(*)=2 from unidades where nombre like 'QA%'),'coordinador no lee unidad inactiva no relacionada');
select pg_temp.assert_true((select cliente is null and unidad is null from personal where codigo_personal='QA-AGENT'),'personal nuevo sin cliente ni unidad');
select pg_temp.expect_error($cmd$insert into clientes(nombre) values ('QA No autorizado')$cmd$,'row-level security');
select pg_temp.expect_error($cmd$insert into unidades(cliente_id,nombre) values ('55000000-0000-4000-8000-000000000001','QA No autorizado')$cmd$,'row-level security');
with changed as (update clientes set nombre='QA No autorizado' where nombre='QA Cliente A' returning id)
select pg_temp.assert_true((select count(*)=0 from changed),'coordinador no modifica clientes');
with changed as (update unidades set nombre='QA No autorizado' where nombre='QA Unidad A' returning id)
select pg_temp.assert_true((select count(*)=0 from changed),'coordinador no modifica unidades');

-- La creación normal acepta solo IDs; valores manuales deben rechazarse.
select crear_requerimiento(
'22000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001',
'[{"prenda_id":"33000000-0000-4000-8000-000000000001"}]');
select pg_temp.expect_error($cmd$select crear_requerimiento('22000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001','[{"prenda_id":"33000000-0000-4000-8000-000000000001","cantidad":999,"precio_unitario":0,"codigo_almacen":"FALSO"}]')$cmd$,'Solo se aceptan identificadores');
select pg_temp.assert_true((select count(*)=1 and bool_and(d.cantidad=3 and d.precio_unitario=25.75 and d.codigo_almacen='QA-ALM')
from detalle_requerimiento d join requerimientos r on r.id=d.requerimiento_id
where r.usuario_creador_id=auth.uid()),'cantidad, precio y código del maestro');
select pg_temp.assert_true((select bool_and(cliente_id='55000000-0000-4000-8000-000000000001' and unidad_id='66000000-0000-4000-8000-000000000001'
and referencia_interna='RENOVACION VERANO' and estado='Pendiente' and fecha is not null) from requerimientos where usuario_creador_id=auth.uid()),'cabecera con destino y valores originales');
select pg_temp.expect_error($cmd$select crear_requerimiento('22000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000002','[{"prenda_id":"33000000-0000-4000-8000-000000000001"}]')$cmd$,'Selecciona una unidad activa del cliente');
select pg_temp.expect_error($cmd$select crear_requerimiento('22000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000003','[{"prenda_id":"33000000-0000-4000-8000-000000000001"}]')$cmd$,'Selecciona una unidad activa del cliente');
select pg_temp.expect_error($cmd$select crear_requerimiento('22000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000003','66000000-0000-4000-8000-000000000001','[]')$cmd$,'Selecciona un cliente activo');
select pg_temp.expect_error($cmd$select crear_requerimiento('22000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001','[{"prenda_id":"33000000-0000-4000-8000-000000000002"}]')$cmd$,'La prenda no corresponde');
select pg_temp.expect_error($cmd$select crear_requerimiento('22000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001','[{"prenda_id":"33000000-0000-4000-8000-000000000001"},{"prenda_id":"33000000-0000-4000-8000-000000000001"}]')$cmd$,'Detalles inválidos o duplicados');
select pg_temp.expect_error($cmd$select crear_requerimiento('22000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001','[{}]')$cmd$,'Solo se aceptan identificadores');
select pg_temp.expect_error($cmd$select crear_requerimiento('22000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001','[]')$cmd$,'Debe incluir prendas');
select pg_temp.expect_error($cmd$select crear_requerimiento('22000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001',null)$cmd$,'Debe incluir prendas');
select pg_temp.expect_error($cmd$select crear_requerimiento('22000000-0000-4000-8000-000000000001','[]')$cmd$,'Actualiza la aplicación');
select pg_temp.expect_error($cmd$insert into requerimientos(agente_id,usuario_creador_id) values('22000000-0000-4000-8000-000000000001',auth.uid())$cmd$,'permission denied');
select pg_temp.assert_true((select count(*)=1 from requerimientos where usuario_creador_id=auth.uid()),'fallos no dejan cabeceras parciales');
select pg_temp.expect_error($cmd$insert into detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
select id,'33000000-0000-4000-8000-000000000002',999,0,'FALSO' from requerimientos where usuario_creador_id=auth.uid()$cmd$,'permission denied|row-level security');

select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((select count(*)=0 from requerimientos),'otro coordinador no lee requerimientos ajenos');
select pg_temp.assert_true((select count(*)=0 from detalle_requerimiento),'otro coordinador no lee detalles ajenos');

select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((select count(*)=3 from clientes where nombre like 'QA%'),'admin lee también clientes inactivos');
insert into clientes(nombre) values('QA Admin');
insert into unidades(cliente_id,nombre) values('55000000-0000-4000-8000-000000000001','QA Admin');
update requerimientos set estado='Atendido' where usuario_creador_id='11000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select estado='Atendido' from requerimientos where usuario_creador_id='11000000-0000-4000-8000-000000000001'),'admin actualiza estado');
select pg_temp.expect_error($cmd$update requerimientos set unidad_id='66000000-0000-4000-8000-000000000002' where usuario_creador_id='11000000-0000-4000-8000-000000000001'$cmd$,'permission denied|Solo se permite cambiar el estado');
update clientes set activo=false where id='55000000-0000-4000-8000-000000000001';
update unidades set activo=false where id='66000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((select count(*)=1 from clientes where id='55000000-0000-4000-8000-000000000001'),'dueño conserva lectura de cliente histórico inactivo');
select pg_temp.assert_true((select count(*)=1 from unidades where id='66000000-0000-4000-8000-000000000001'),'dueño conserva lectura de unidad histórica inactiva');
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((select count(*)=0 from clientes where id='55000000-0000-4000-8000-000000000001'),'otro coordinador no accede al cliente inactivo histórico ajeno');
select pg_temp.assert_true((select count(*)=0 from unidades where id='66000000-0000-4000-8000-000000000001'),'otro coordinador no accede a la unidad inactiva histórica ajena');

reset role;
select pg_temp.expect_error($cmd$update prendas set cantidad=0 where codigo_prenda='QA-A'$cmd$,'prendas_cantidad_positiva');
select pg_temp.expect_error($cmd$update requerimientos set cliente_id='55000000-0000-4000-8000-000000000002' where usuario_creador_id='11000000-0000-4000-8000-000000000001'$cmd$,'Solo se permite cambiar el estado');
select pg_temp.assert_true((select count(*)=7 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('clientes','unidades','personal','prendas','profiles','requerimientos','detalle_requerimiento') and c.relrowsecurity),'RLS sigue activo en las siete tablas');
set local role anon;
select pg_temp.expect_error($cmd$select * from clientes$cmd$,'permission denied');
select pg_temp.expect_error($cmd$select * from unidades$cmd$,'permission denied');
select pg_temp.expect_error($cmd$select crear_requerimiento('22000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001','[]')$cmd$,'permission denied');
reset role;
rollback;

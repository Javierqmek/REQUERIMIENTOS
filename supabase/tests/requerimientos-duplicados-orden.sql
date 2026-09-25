-- SOLO base aislada con todas las migraciones. Todo se revierte.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
insert into auth.users(id,email,raw_user_meta_data) values
 ('19000000-0000-4000-8000-000000000001','dup-owner@example.test','{}'),
 ('19000000-0000-4000-8000-000000000002','dup-admin@example.test','{}');
-- Toda cuenta nueva recibe 'sin_vincular' por default (ver 202609240008): coordinador/admin ya
-- no se pueden dejar en el default de la columna, hay que asignarlos explícitamente.
update public.profiles set role='coordinador' where id='19000000-0000-4000-8000-000000000001';
update public.profiles set role='admin' where id='19000000-0000-4000-8000-000000000002';
insert into public.clientes(id,nombre) values('59000000-0000-4000-8000-000000000001','DUP CLIENTE');
insert into public.unidades(id,cliente_id,nombre) values('69000000-0000-4000-8000-000000000001','59000000-0000-4000-8000-000000000001','DUP UNIDAD');
insert into public.personal(id,codigo_personal,nombre,dni,cargo) values('29000000-0000-4000-8000-000000000001','DUP-P','DUP AGENTE','12345670','AGENTE');
insert into public.prendas(id,codigo_prenda,nombre_prenda,codigo_almacen,precio,cliente,cantidad,activo,genero) values
 ('39000000-0000-4000-8000-000000000001','DUP-A','DUP PRENDA A','A',10,'DUP CLIENTE',2,true,'AMBOS'),
 ('39000000-0000-4000-8000-000000000002','DUP-B','DUP PRENDA B','B',20,'DUP CLIENTE',1,true,'AMBOS');
set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000001',true);
select set_config('qa.first',public.crear_requerimiento('29000000-0000-4000-8000-000000000001','59000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000001','[{"prenda_id":"39000000-0000-4000-8000-000000000001"}]','99000000-0000-4000-8000-000000000001')::text,true);
select pg_temp.ok(public.crear_requerimiento('29000000-0000-4000-8000-000000000001','59000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000001','[{"prenda_id":"39000000-0000-4000-8000-000000000001"}]','99000000-0000-4000-8000-000000000001')=current_setting('qa.first')::uuid,'same request id is idempotent');
select pg_temp.ok((select count(*)=1 from public.requerimientos),'retry creates one header');
select public.crear_requerimiento('29000000-0000-4000-8000-000000000001','59000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000001','[{"prenda_id":"39000000-0000-4000-8000-000000000001"},{"prenda_id":"39000000-0000-4000-8000-000000000002"}]','99000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000002',true);
select pg_temp.ok((public.admin_consultar_requerimientos_v2(p_solo_duplicados=>true)#>>'{total}')::int=2,'detects duplicate pair');
select pg_temp.ok((public.admin_consultar_requerimientos_v2(p_solo_duplicados=>true)#>>'{duplicate_groups}')::int=1,'groups duplicate pair');
select pg_temp.ok((public.admin_consultar_requerimientos_v2(p_solo_duplicados=>true,p_orden=>'prendas',p_direccion=>'asc')#>>'{rows,0,cantidad_prendas}')::int=1,'sorts garments ascending');
select pg_temp.ok((public.admin_consultar_requerimientos_v2(p_solo_duplicados=>true,p_orden=>'prendas',p_direccion=>'desc')#>>'{rows,0,cantidad_prendas}')::int=2,'sorts garments descending');
select pg_temp.ok((public.admin_consultar_requerimientos_v2(p_solo_duplicados=>true)#>>'{rows,0,unidades_totales}') is not null,'returns garments and units separately');
rollback;

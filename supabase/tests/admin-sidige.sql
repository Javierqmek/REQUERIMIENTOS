-- Base de pruebas con todas las migraciones. No ejecutar con datos reales.
\set ON_ERROR_STOP on
begin;
create function pg_temp.check_admin(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
insert into auth.users(id,email,raw_user_meta_data) values
('12000000-0000-4000-8000-000000000001','admin-test@example.test','{}'),
('12000000-0000-4000-8000-000000000002','coordinator-a@example.test','{}'),
('12000000-0000-4000-8000-000000000003','coordinator-b@example.test','{}');
update profiles set role='admin' where id='12000000-0000-4000-8000-000000000001';
insert into clientes(id,nombre) values('52000000-0000-4000-8000-000000000001','ADMIN TEST A'),('52000000-0000-4000-8000-000000000002','ADMIN TEST B');
insert into unidades(id,cliente_id,nombre) values
('62000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','SEDE A'),
('62000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000002','SEDE B');
insert into personal(id,codigo_personal,nombre,dni,cargo) values('22000000-0000-4000-8000-000000000003','ADMIN-TEST','JERY RAMÍREZ','071389725','AGENTE');
insert into prendas(id,codigo_prenda,nombre_prenda,codigo_almacen,precio,cliente,cantidad) values
('32000000-0000-4000-8000-000000000001','000012','CAMISA','ACTUAL',99,'ADMIN TEST A',9),
('32000000-0000-4000-8000-000000000002','000013','PANTALÓN','ACTUAL',99,'ADMIN TEST A',9);
insert into requerimientos(id,agente_id,usuario_creador_id,cliente_id,unidad_id,fecha) values
('42000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','2026-09-02 04:59:59Z'),
('42000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','2026-09-02 05:00:00Z'),
('42000000-0000-4000-8000-000000000003','22000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002','2026-09-03 05:00:00Z');
insert into detalle_requerimiento(id,requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen,created_at) values
('72000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000002',3,20.25,'HISTORICO','2026-09-01 05:00Z'),
('72000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001',2,0,'HISTORICO','2026-09-01 05:00Z');
update requerimientos set estado='Atendido' where id='42000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000001',true);
select pg_temp.check_admin((admin_consultar_requerimientos(p_busqueda=>'ADMIN TEST')->>'total')::int=3,'admin ve todos los coordinadores y estados');
select pg_temp.check_admin((admin_consultar_requerimientos(p_cliente_id=>'52000000-0000-4000-8000-000000000001')->>'total')::int=2,'filtro cliente');
select pg_temp.check_admin((admin_consultar_requerimientos(p_unidad_id=>'62000000-0000-4000-8000-000000000002')->>'total')::int=1,'filtro unidad');
select pg_temp.check_admin((admin_consultar_requerimientos(p_coordinador_id=>'12000000-0000-4000-8000-000000000003')->>'total')::int=2,'filtro coordinador');
select pg_temp.check_admin((admin_consultar_requerimientos(p_cliente_id=>'52000000-0000-4000-8000-000000000001',p_unidad_id=>'62000000-0000-4000-8000-000000000001',p_coordinador_id=>'12000000-0000-4000-8000-000000000002',p_estado=>'Pendiente')->>'total')::int=1,'cuatro filtros combinados');
select pg_temp.check_admin((admin_consultar_requerimientos(p_cliente_id=>'52000000-0000-4000-8000-000000000001',p_unidad_id=>'62000000-0000-4000-8000-000000000002')->>'total')::int=0,'unidad de otro cliente devuelve cero');
select pg_temp.check_admin((admin_consultar_requerimientos(p_busqueda=>'ADMIN TEST',p_desde=>'2026-09-02 05:00Z',p_hasta=>'2026-09-03 05:00Z')->>'total')::int=1,'fecha Peru incluye inicio y excluye siguiente medianoche');
select pg_temp.check_admin((admin_consultar_requerimientos(p_busqueda=>'RAMÍREZ')->>'total')::int=3,'busqueda preserva tildes');
select pg_temp.check_admin((admin_consultar_requerimientos(p_busqueda=>'admin test')->>'total')::int=3,'busqueda sin distinguir mayusculas ASCII incluso en locale C de prueba');
select pg_temp.check_admin(jsonb_array_length(admin_consultar_requerimientos(p_busqueda=>'ADMIN TEST',p_limite=>1,p_offset=>1)->'rows')=1,'pagina de un registro');
select pg_temp.check_admin(admin_consultar_requerimientos(p_busqueda=>'ADMIN TEST',p_limite=>1,p_offset=>1)#>>'{rows,0,id}'='42000000-0000-4000-8000-000000000002','orden de pagina estable');
select pg_temp.check_admin((admin_consultar_requerimientos(p_coordinador_id=>'12000000-0000-4000-8000-000000000002')#>>'{rows,0,cantidad_prendas}')::int=5,'suma cantidades historicas, no cantidad del maestro');
select pg_temp.check_admin(not ((admin_consultar_requerimientos(p_coordinador_id=>'12000000-0000-4000-8000-000000000002')#>'{rows,0}')?'detalle_requerimiento'),'listado no envia detalles');
select pg_temp.check_admin(jsonb_array_length(admin_consultar_requerimientos(p_coordinador_id=>'12000000-0000-4000-8000-000000000002',p_exportar=>true)#>'{rows,0,detalle_requerimiento}')=2,'exportacion incluye cada prenda');
select pg_temp.check_admin(admin_consultar_requerimientos(p_coordinador_id=>'12000000-0000-4000-8000-000000000002',p_exportar=>true)#>>'{rows,0,detalle_requerimiento,0,id}'='72000000-0000-4000-8000-000000000001','detalles ordenados por created_at e id');
select pg_temp.check_admin((admin_consultar_requerimientos(p_coordinador_id=>'12000000-0000-4000-8000-000000000002',p_exportar=>true)#>>'{rows,0,detalle_requerimiento,0,precio_unitario}')::numeric=0,'exportacion conserva precio cero historico');
select pg_temp.check_admin(admin_consultar_requerimientos(p_coordinador_id=>'12000000-0000-4000-8000-000000000002',p_exportar=>true)#>>'{rows,0,detalle_requerimiento,0,codigo_almacen}'='HISTORICO','exportacion conserva codigo almacen historico');
select pg_temp.check_admin(jsonb_array_length(admin_consultar_requerimientos(p_busqueda=>'ADMIN TEST',p_exportar=>true,p_cursor_fecha=>'2026-09-02 05:00Z',p_cursor_id=>'42000000-0000-4000-8000-000000000002')->'rows')=1,'cursor avanza sin repetir');
select pg_temp.check_admin(not exists(select 1 from jsonb_array_elements(admin_opciones_requerimientos()->'coordinadores') p where p->>'id'='12000000-0000-4000-8000-000000000001'),'opciones excluyen usuarios que no crearon requerimientos');
select pg_temp.check_admin(exists(select 1 from jsonb_array_elements(admin_opciones_requerimientos()->'coordinadores') p where p->>'id'='12000000-0000-4000-8000-000000000003'),'opciones incluyen coordinadores con requerimientos');
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000002',true);
do $$ begin
  begin perform admin_consultar_requerimientos(); raise exception 'FAIL: coordinador puede listar'; exception when insufficient_privilege then raise notice 'PASS: coordinador rechazado en RPC listado'; end;
  begin perform admin_consultar_requerimientos(p_exportar=>true); raise exception 'FAIL: coordinador puede exportar'; exception when insufficient_privilege then raise notice 'PASS: coordinador rechazado en RPC exportacion'; end;
  begin perform admin_opciones_requerimientos(); raise exception 'FAIL: coordinador ve opciones'; exception when insufficient_privilege then raise notice 'PASS: coordinador rechazado en opciones'; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform admin_consultar_requerimientos(); raise exception 'FAIL: anon puede listar'; exception when insufficient_privilege then raise notice 'PASS: anon rechazado'; end;
end $$;
reset role;
select pg_temp.check_admin((select bool_and(relrowsecurity) from pg_class where oid in ('clientes'::regclass,'unidades'::regclass,'personal'::regclass,'prendas'::regclass,'requerimientos'::regclass,'detalle_requerimiento'::regclass,'profiles'::regclass)),'RLS intacto');
select pg_temp.check_admin((select bool_and(not prosecdef) from pg_proc where proname in ('admin_consultar_requerimientos','admin_opciones_requerimientos')),'funciones SECURITY INVOKER');
rollback;

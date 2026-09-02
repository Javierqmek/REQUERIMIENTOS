-- SOLO base aislada con las seis migraciones. Todo se revierte al finalizar.
\set ON_ERROR_STOP on
begin;
create function pg_temp.check_edit(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.denied_edit(command text,code text) returns void language plpgsql as $$
begin
  begin execute command; exception when others then
    if sqlstate=code then raise notice 'PASS: rejected %',code; return; end if;
    raise exception 'FAIL expected %, got %: %',code,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: accepted forbidden operation';
end $$;
insert into auth.users(id,email,raw_user_meta_data) values
('13000000-0000-4000-8000-000000000001','edit-owner@example.test','{}'),
('13000000-0000-4000-8000-000000000002','edit-other@example.test','{}'),
('13000000-0000-4000-8000-000000000003','edit-admin@example.test','{}');
update profiles set role='admin' where id='13000000-0000-4000-8000-000000000003';
select pg_temp.check_edit((select role='coordinador' from profiles where id='13000000-0000-4000-8000-000000000001'),'new profile defaults to coordinador');
select pg_temp.check_edit(enum_range(null::user_role)::text='{coordinador,admin}','only two roles');
insert into clientes(id,nombre) values('53000000-0000-4000-8000-000000000001','EDIT A');
insert into unidades(id,cliente_id,nombre) values('63000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','EDIT SEDE');
insert into personal(id,codigo_personal,nombre,dni,cargo) values('23000000-0000-4000-8000-000000000001','EDIT-P','EDIT AGENT','01234567','AGENTE');
insert into prendas(id,codigo_prenda,nombre_prenda,codigo_almacen,precio,cliente,cantidad,activo) values
('33000000-0000-4000-8000-000000000001','EDIT-A','CAMISA','MASTER A',99,'EDIT A',5,true),
('33000000-0000-4000-8000-000000000002','EDIT-B','PANTALON','MASTER B',100,'EDIT A',6,true),
('33000000-0000-4000-8000-000000000003','EDIT-C','GORRA','MASTER C',101,'EDIT A',7,true),
('33000000-0000-4000-8000-000000000004','EDIT-D','OTRO','MASTER D',102,'OTHER CLIENT',1,true),
('33000000-0000-4000-8000-000000000005','EDIT-E','INACTIVA','MASTER E',103,'EDIT A',1,false);
insert into requerimientos(id,agente_id,usuario_creador_id,cliente_id,unidad_id) values
('43000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001');
insert into detalle_requerimiento(id,requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen) values
('73000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001',2,10,'HIST A'),
('73000000-0000-4000-8000-000000000002','43000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000002',3,20,'HIST B');
select set_config('qa.req','43000000-0000-4000-8000-000000000001',true);
create function pg_temp.payload() returns jsonb language sql as $$ select public.obtener_edicion_prendas(current_setting('qa.req')::uuid) $$;
create function pg_temp.keep_lines() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('prenda_id',x->>'prenda_id','detalle_id',x->>'id'))
    from jsonb_array_elements(pg_temp.payload()#>'{requerimiento,detalle_requerimiento}') x
$$;
create function pg_temp.save_lines(lines jsonb) returns jsonb language sql as $$
  select public.editar_prendas_requerimiento(current_setting('qa.req')::uuid,pg_temp.payload()->>'version',lines)
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000002',true);
select pg_temp.check_edit((select count(*)=0 from requerimientos where id=current_setting('qa.req')::uuid),'foreign requirement hidden by RLS');
select pg_temp.denied_edit('select pg_temp.payload()','42501');
select pg_temp.denied_edit($q$select editar_prendas_requerimiento(current_setting('qa.req')::uuid,'x','[]')$q$,'42501');
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
select set_config('qa.old_version',pg_temp.payload()->>'version',true);
with changed as (update requerimientos set estado='Atendido' where id=current_setting('qa.req')::uuid returning *)
select pg_temp.check_edit((select count(*)=0 from changed),'coordinador cannot update estado');
select pg_temp.denied_edit($q$update requerimientos set cliente_id=null where id=current_setting('qa.req')::uuid$q$,'42501');
select pg_temp.denied_edit($q$update detalle_requerimiento set cantidad=99 where requerimiento_id=current_setting('qa.req')::uuid$q$,'42501');
select pg_temp.denied_edit($q$delete from detalle_requerimiento where requerimiento_id=current_setting('qa.req')::uuid$q$,'42501');
select pg_temp.save_lines('[{"prenda_id":"33000000-0000-4000-8000-000000000001","detalle_id":"73000000-0000-4000-8000-000000000001"},{"prenda_id":"33000000-0000-4000-8000-000000000003"}]') is not null;
select pg_temp.check_edit((select count(*)=2 and sum(cantidad)=12 from detalle_requerimiento where requerimiento_id=current_setting('qa.req')::uuid),'owner adds removes replaces; only active lines visible and counted');
select pg_temp.check_edit((select precio_unitario=10 and codigo_almacen='HIST A' and cantidad=5 from detalle_requerimiento where id='73000000-0000-4000-8000-000000000001'),'kept price/code historical, quantity from master');
select pg_temp.check_edit((select precio_unitario=101 and codigo_almacen='MASTER C' and cantidad=7 from detalle_requerimiento where requerimiento_id=current_setting('qa.req')::uuid and prenda_id='33000000-0000-4000-8000-000000000003'),'new line current master');
select pg_temp.check_edit((select count(*)=0 from detalle_requerimiento where not activo),'history invisible to coordinator');
select pg_temp.denied_edit($q$select editar_prendas_requerimiento(current_setting('qa.req')::uuid,current_setting('qa.old_version'),pg_temp.keep_lines())$q$,'40001');
select pg_temp.denied_edit($q$select pg_temp.save_lines('[]')$q$,'22023');
select pg_temp.denied_edit($q$select pg_temp.save_lines('[{"prenda_id":"33000000-0000-4000-8000-000000000001"},{"prenda_id":"33000000-0000-4000-8000-000000000001"}]')$q$,'22023');
select pg_temp.denied_edit($q$select pg_temp.save_lines('[{"prenda_id":"33000000-0000-4000-8000-000000000001","cantidad":999}]')$q$,'22023');
select pg_temp.denied_edit($q$select pg_temp.save_lines('[{"prenda_id":"33000000-0000-4000-8000-000000000001","agente_id":"23000000-0000-4000-8000-000000000001"}]')$q$,'22023');
select pg_temp.denied_edit($q$select pg_temp.save_lines('[{"prenda_id":"33000000-0000-4000-8000-000000000004"}]')$q$,'22023');
select pg_temp.denied_edit($q$select pg_temp.save_lines('[{"prenda_id":"33000000-0000-4000-8000-000000000005"}]')$q$,'22023');
select pg_temp.denied_edit($q$select pg_temp.save_lines('[{"prenda_id":"33000000-0000-4000-8000-000000000002","detalle_id":"73000000-0000-4000-8000-000000000002"}]')$q$,'22023');
select pg_temp.check_edit((select count(*)=2 and sum(cantidad)=12 from detalle_requerimiento where requerimiento_id=current_setting('qa.req')::uuid),'invalid edits leave active set unchanged');
select pg_temp.save_lines(pg_temp.keep_lines() || '[{"prenda_id":"33000000-0000-4000-8000-000000000002"}]') is not null;
select pg_temp.check_edit((select id<>'73000000-0000-4000-8000-000000000002' and precio_unitario=100 and codigo_almacen='MASTER B' and cantidad=6 from detalle_requerimiento where requerimiento_id=current_setting('qa.req')::uuid and prenda_id='33000000-0000-4000-8000-000000000002'),'readding creates fresh line with master values');
-- Remove/readd within the same save is also a new active identity.
select pg_temp.save_lines((select jsonb_agg(x - 'detalle_id') from jsonb_array_elements(pg_temp.keep_lines()) x)) is not null;
select pg_temp.check_edit((select precio_unitario=99 and codigo_almacen='MASTER A' from detalle_requerimiento where requerimiento_id=current_setting('qa.req')::uuid and prenda_id='33000000-0000-4000-8000-000000000001'),'remove/readd same save refreshes snapshots');
select set_config('qa.master_version',pg_temp.payload()->>'version',true);
reset role;
update prendas set precio=120 where id='33000000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.denied_edit($q$select editar_prendas_requerimiento(current_setting('qa.req')::uuid,current_setting('qa.master_version'),pg_temp.keep_lines())$q$,'40001');
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000003',true);
select pg_temp.check_edit((select count(*)=0 from detalle_requerimiento where not activo),'history also excluded from normal admin reads');
select pg_temp.check_edit((admin_consultar_requerimientos(p_cliente_id=>'53000000-0000-4000-8000-000000000001')#>>'{rows,0,cantidad_prendas}')::int=18,'admin totals exclude retired lines');
select pg_temp.check_edit(jsonb_array_length(admin_consultar_requerimientos(p_cliente_id=>'53000000-0000-4000-8000-000000000001',p_exportar=>true)#>'{rows,0,detalle_requerimiento}')=3,'CSV and SIDIGE source only active lines');
select pg_temp.check_edit((select sum((x->>'cantidad')::int * (x->>'precio_unitario')::numeric)=1802 from jsonb_array_elements(admin_consultar_requerimientos(p_cliente_id=>'53000000-0000-4000-8000-000000000001',p_exportar=>true)#>'{rows,0,detalle_requerimiento}') x),'monetary total only active lines');
select pg_temp.save_lines(pg_temp.keep_lines()) is not null;
select pg_temp.denied_edit($q$update requerimientos set fecha=now() where id=current_setting('qa.req')::uuid$q$,'42501');
update requerimientos set estado='Observado' where id=current_setting('qa.req')::uuid;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
select pg_temp.save_lines(pg_temp.keep_lines()) is not null;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000003',true);
update requerimientos set estado='Atendido' where id=current_setting('qa.req')::uuid;
select pg_temp.denied_edit('select pg_temp.save_lines(pg_temp.keep_lines())','55000');
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
select pg_temp.denied_edit('select pg_temp.save_lines(pg_temp.keep_lines())','55000');
reset role;
select pg_temp.check_edit((select count(*)=7 from detalle_requerimiento where requerimiento_id=current_setting('qa.req')::uuid),'all seven original/new lines physically preserved');
select pg_temp.check_edit((select not activo and cantidad=3 and precio_unitario=20 and codigo_almacen='HIST B' and retirado_por='13000000-0000-4000-8000-000000000001' and retirado_at is not null from detalle_requerimiento where id='73000000-0000-4000-8000-000000000002'),'retired snapshots and actor preserved');
select pg_temp.denied_edit($q$update detalle_requerimiento set activo=true where id='73000000-0000-4000-8000-000000000002'$q$,'P0001');
select pg_temp.denied_edit($q$update detalle_requerimiento set precio_unitario=999 where id='73000000-0000-4000-8000-000000000002'$q$,'P0001');
select pg_temp.denied_edit($q$delete from detalle_requerimiento where id='73000000-0000-4000-8000-000000000002'$q$,'P0001');
select pg_temp.check_edit((select bool_and(relrowsecurity) from pg_class where oid in ('profiles'::regclass,'personal'::regclass,'prendas'::regclass,'clientes'::regclass,'unidades'::regclass,'requerimientos'::regclass,'detalle_requerimiento'::regclass)),'all RLS remains enabled');
set local role anon;
select pg_temp.denied_edit($q$select obtener_edicion_prendas('43000000-0000-4000-8000-000000000001')$q$,'42501');
select pg_temp.denied_edit($q$select editar_prendas_requerimiento('43000000-0000-4000-8000-000000000001','x','[]')$q$,'42501');
reset role;
rollback;

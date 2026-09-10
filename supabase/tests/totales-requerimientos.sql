-- SOLO base aislada con todas las migraciones. Fixtures revertidos.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.denied(command text) returns void language plpgsql as $$
begin
  begin execute command; exception when insufficient_privilege then raise notice 'PASS: denied'; return; end;
  raise exception 'FAIL: unauthorized operation accepted';
end $$;
insert into auth.users(id,email,raw_user_meta_data) values
 ('16000000-0000-4000-8000-000000000001','total-owner@example.test','{}'),
 ('16000000-0000-4000-8000-000000000002','total-other@example.test','{}'),
 ('16000000-0000-4000-8000-000000000003','total-admin@example.test','{}');
update public.profiles set role='admin' where id='16000000-0000-4000-8000-000000000003';
insert into public.personal(id,codigo_personal,nombre,dni,cargo) values
 ('26000000-0000-4000-8000-000000000001','TOT-P1','Agente total','12345678','Agente'),
 ('26000000-0000-4000-8000-000000000002','TOT-P2','Otro agente','87654321','Agente');
insert into public.clientes(id,nombre) values ('56000000-0000-4000-8000-000000000001','Cliente total');
insert into public.unidades(id,cliente_id,nombre) values
 ('66000000-0000-4000-8000-000000000001','56000000-0000-4000-8000-000000000001','Unidad total');
insert into public.prendas(id,codigo_prenda,nombre_prenda,codigo_almacen,precio,cantidad,cliente,genero) values
 ('36000000-0000-4000-8000-000000000001','TOT-A','Prenda A','A',999,2,'Cliente total','AMBOS'),
 ('36000000-0000-4000-8000-000000000002','TOT-B','Prenda B','B',999,1,'Cliente total','AMBOS');
insert into public.requerimientos(id,agente_id,usuario_creador_id,cliente_id,unidad_id) values
 ('46000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','56000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001'),
 ('46000000-0000-4000-8000-000000000002','26000000-0000-4000-8000-000000000002','16000000-0000-4000-8000-000000000002','56000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001');
insert into public.detalle_requerimiento(id,requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen,activo,retirado_at,retirado_por) values
 ('76000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000001',2,28,'HIST-A',true,null,null),
 ('76000000-0000-4000-8000-000000000002','46000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000002',1,45,'HIST-B',true,null,null),
 ('76000000-0000-4000-8000-000000000003','46000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000002',5,100,'RETIRADA',false,now(),'16000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000001',true);
select pg_temp.ok(public.total_requerimiento_activo('46000000-0000-4000-8000-000000000001')=101,'usa cantidad y precio historicos activos');
select pg_temp.ok(public.total_requerimiento_activo('46000000-0000-4000-8000-000000000001')<>1998,'no usa precio actual del maestro');
select pg_temp.ok(public.total_requerimiento_activo('46000000-0000-4000-8000-000000000002')=0,'RLS no revela total ajeno');
select pg_temp.ok((public.listar_requerimientos_con_total(100,0)#>>'{0,total_requerimiento}')::numeric=101,'Mis requerimientos incluye total');
select pg_temp.ok(jsonb_array_length(public.listar_requerimientos_con_total(100,0))=1,'coordinador lista solo sus requerimientos');
select pg_temp.denied('select public.admin_consultar_requerimientos()');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000003',true);
select pg_temp.ok((public.admin_consultar_requerimientos(p_coordinador_id=>'16000000-0000-4000-8000-000000000001')#>>'{rows,0,total_requerimiento}')::numeric=101,'Administracion incluye total activo historico');
select pg_temp.ok(jsonb_array_length(public.admin_consultar_requerimientos(p_coordinador_id=>'16000000-0000-4000-8000-000000000001',p_exportar=>true)#>'{rows,0,detalle_requerimiento}')=2,'SIDIGE source excluye retirada');
reset role;
set local role anon;
select pg_temp.denied('select public.listar_requerimientos_con_total(100,0)');
select pg_temp.denied($q$select public.total_requerimiento_activo('46000000-0000-4000-8000-000000000001')$q$);
reset role;
rollback;

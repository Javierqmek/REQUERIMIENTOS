-- Confirma que admin (restringido) ya no puede leer ni modificar Documentos, Vacaciones/
-- Papeletas, Capacitaciones ni agentes, mientras que superadmin sí puede todo -- y que admin
-- conserva exactamente su acceso de siempre en el dominio uniformes (clientes, un catálogo de
-- Mantenimiento). Corre con "set local role authenticated" (nunca superusuario).
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.denied(command text,code text) returns void language plpgsql as $$
begin
  begin execute command; exception when others then
    if sqlstate=code then raise notice 'PASS: rejected %',code; return; end if;
    raise exception 'FAIL expected %, got %: %',code,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: accepted forbidden operation';
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','admin-restringido@example.test','{}'),
 ('b1000000-0000-4000-8000-000000000002','superadmin-total@example.test','{}'),
 ('b1000000-0000-4000-8000-000000000003','capacitador-ss@example.test','{}'),
 ('b1000000-0000-4000-8000-000000000004','coordinador-ss@example.test','{}');
update public.profiles set role='admin' where id='b1000000-0000-4000-8000-000000000001';
update public.profiles set role='superadmin' where id='b1000000-0000-4000-8000-000000000002';
update public.profiles set role='capacitador' where id='b1000000-0000-4000-8000-000000000003';
update public.profiles set role='coordinador' where id='b1000000-0000-4000-8000-000000000004';

-- Fixtures: una capacitación, una papeleta y un documento cualquiera para probar lectura/escritura.
insert into public.clientes(id,nombre,activo) values ('b2000000-0000-4000-8000-000000000001','SS Cliente',true);
insert into public.unidades(id,cliente_id,nombre,activo) values ('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','SS Unidad',true);
insert into public.provincias(id,nombre,activo) values ('b7000000-0000-4000-8000-000000000001','SS Provincia',true);
insert into public.personal(id,codigo_personal,nombre,dni,cargo,cliente,unidad,activo) values
 ('b4000000-0000-4000-8000-000000000001','SS-AG','Agente SS','77000000','Agente','','',true),
 ('b4000000-0000-4000-8000-000000000002','SS-AG2','Reemplazo SS','77000001','Agente','','',true);
insert into public.capacitaciones(id,titulo,capacitador_id,video_youtube_id) values
 ('b5000000-0000-4000-8000-000000000001','Capacitación SS','b1000000-0000-4000-8000-000000000003','dQw4w9WgXcQ');
insert into public.papeletas_vacaciones(id,coordinador_id,colaborador_id,reemplazo_id,colaborador_nombre,colaborador_codigo,cliente_id,unidad_id,provincia_id,
  fisicas_fecha_inicio,fisicas_fecha_fin,archivo_nombre,archivo_path,archivo_sha256,archivo_bytes,request_id) values
 ('b6000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000004','b4000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000002','Colaborador SS','SS-COL',
  'b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',
  '2026-01-01','2026-01-05','papeleta.pdf','x/papeleta.pdf',repeat('a',64),1000,gen_random_uuid());

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);

\echo '--- admin restringido: capacitaciones ---'
select pg_temp.ok((select count(*)=0 from public.capacitaciones),'admin no lee capacitaciones por RLS');
select pg_temp.denied($$select public.reporte_capacitacion('b5000000-0000-4000-8000-000000000001')$$,'42501');
select pg_temp.denied($$select public.admin_asignar_cliente_personal('b4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001')$$,'42501');

\echo '--- admin restringido: agentes (desvincular) ---'
select pg_temp.denied($$select public.desvincular_agente('b4000000-0000-4000-8000-000000000001')$$,'42501');

\echo '--- admin restringido: vacaciones/papeletas ---'
select pg_temp.ok((select count(*)=0 from public.papeletas_vacaciones),'admin no lee papeletas ajenas por RLS');
select pg_temp.denied($$select public.observar_papeleta_vacaciones('b6000000-0000-4000-8000-000000000001','motivo cualquiera')$$,'42501');
select pg_temp.denied($$select private.admin_marcar_papeleta_prueba('b6000000-0000-4000-8000-000000000001',true)$$,'42501');

\echo '--- admin restringido: documentos ---'
select pg_temp.denied($$select public.admin_desactivar_perfil_firma('b1000000-0000-4000-8000-000000000001')$$,'42501');

\echo '--- admin restringido: gestión de usuarios ---'
select pg_temp.denied($$select public.superadmin_listar_usuarios()$$,'42501');
select pg_temp.denied($$select public.superadmin_cambiar_rol('b1000000-0000-4000-8000-000000000001','superadmin')$$,'42501');

\echo '--- admin SIGUE con su acceso de siempre en uniformes (Mantenimiento: clientes) ---'
select pg_temp.ok((select count(*)=1 from public.clientes where nombre='SS Cliente'),'admin sigue leyendo clientes (Mantenimiento, uniformes)');
select pg_temp.ok((select public.is_admin()),'is_admin() sigue siendo true para admin (uniformes intacto)');
select pg_temp.ok((select not public.is_superadmin()),'is_superadmin() es false para admin');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);

\echo '--- superadmin: acceso total ---'
select pg_temp.ok((select public.is_admin() and public.is_superadmin()),'superadmin es is_admin() e is_superadmin() a la vez');
select pg_temp.ok((select count(*)=1 from public.capacitaciones where id='b5000000-0000-4000-8000-000000000001'),'superadmin lee capacitaciones');
select pg_temp.ok((select jsonb_array_length(public.reporte_capacitacion('b5000000-0000-4000-8000-000000000001')) is not null),'superadmin puede pedir el reporte de una capacitación');
select pg_temp.ok((select count(*)=1 from public.papeletas_vacaciones where id='b6000000-0000-4000-8000-000000000001'),'superadmin lee papeletas ajenas');
select pg_temp.ok((select (public.desvincular_agente('b4000000-0000-4000-8000-000000000001')).id is not null),'superadmin puede desvincular un agente');
select pg_temp.ok((select jsonb_array_length(public.superadmin_listar_usuarios())>=4),'superadmin puede listar usuarios');
select pg_temp.ok((select (public.superadmin_cambiar_rol('b1000000-0000-4000-8000-000000000004','gerente')).role='gerente'),'superadmin puede cambiar el rol de otro usuario');
select pg_temp.denied($$select public.superadmin_cambiar_rol('b1000000-0000-4000-8000-000000000002','admin')$$,'22023');
reset role;

\echo '--- capacitador: sin cambios, conserva su acceso actual ---'
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select pg_temp.ok((select count(*)=1 from public.capacitaciones where id='b5000000-0000-4000-8000-000000000001'),'capacitador sigue viendo su propia capacitación');
reset role;

rollback;

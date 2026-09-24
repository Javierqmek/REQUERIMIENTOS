-- Reproduce lo que ve un agente real en /capacitaciones: corre con "set local role authenticated"
-- (nunca como superusuario, que bypasea RLS) y simula su sesión con request.jwt.claim.sub, igual
-- que hace PostgREST con un usuario logueado de verdad. Cubre el caso reportado en producción --
-- un agente sin cliente_actual_id asignado (personal.cliente_actual_id NULL) debe seguir viendo
-- una capacitación PUBLICADA y asignada de forma GLOBAL (cliente_id NULL en
-- capacitacion_asignaciones): la asignación global nunca debe depender del cliente del agente.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('ca000000-0000-4000-8000-000000000001','capacitador-vis@example.test','{}'),
 ('ca000000-0000-4000-8000-000000000002','agente-vis@example.test','{}');
update public.profiles set role='capacitador' where id='ca000000-0000-4000-8000-000000000001';
update public.profiles set role='agente' where id='ca000000-0000-4000-8000-000000000002';

insert into public.personal(id,codigo_personal,nombre,dni,cargo,cliente,unidad,activo,profile_id,cliente_actual_id) values
 ('cb000000-0000-4000-8000-000000000001','VIS-1','Agente Sin Cliente','88888888','Agente','','','t',
   'ca000000-0000-4000-8000-000000000002',null);

insert into public.capacitaciones(id,titulo,capacitador_id,video_path,porcentaje_minimo_visto,nota_minima,estado) values
 ('cc000000-0000-4000-8000-000000000001','Inducción general','ca000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000001/video.mp4',80,1,'PUBLICADA');
insert into public.examen_preguntas(id,capacitacion_id,enunciado) values
 ('cd000000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000001','¿Pregunta?');
insert into public.examen_opciones(pregunta_id,texto,es_correcta,orden) values
 ('cd000000-0000-4000-8000-000000000001','Sí',true,0),
 ('cd000000-0000-4000-8000-000000000001','No',false,1);
-- Asignación GLOBAL: cliente_id NULL -- debe alcanzar a todo agente sin importar su
-- cliente_actual_id (el caso reportado tenía cliente_actual_id NULL y no veía nada).
insert into public.capacitacion_asignaciones(capacitacion_id,cliente_id) values
 ('cc000000-0000-4000-8000-000000000001',null);

set local role authenticated;
select set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000002',true);

select pg_temp.ok(private.capacitacion_asignada_a_mi('cc000000-0000-4000-8000-000000000001'),
  'un agente sin cliente_actual_id igual queda cubierto por una asignación global');

select pg_temp.ok((
    select count(*)=1 from jsonb_array_elements(public.listar_capacitaciones_agente()) x
    where x->>'id'='cc000000-0000-4000-8000-000000000001' and x->>'titulo'='Inducción general'
  ), 'listar_capacitaciones_agente devuelve la capacitación publicada y asignada globalmente');

reset role;
rollback;

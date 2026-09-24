-- Valida el registro de agentes por Google + DNI: vincular_agente_google() usa auth.uid() (nunca
-- un id recibido del cliente) y lee el correo directo de auth.users (nunca uno recibido del
-- cliente), y desvincular_agente() es admin-only y revierte el rol. Corre con "set local role
-- authenticated" (nunca superusuario) para las operaciones que hace la API.
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

select pg_temp.denied($$select public.vincular_agente('00000000-0000-4000-8000-000000000000','1','1')$$,'42883');

insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values
 ('ff000000-0000-4000-8000-000000000001','admin-vinc@example.test','{}','{}'),
 ('ff000000-0000-4000-8000-000000000002','agente-google@example.test','{}','{"provider":"google"}'),
 ('ff000000-0000-4000-8000-000000000003','agente-google-2@example.test','{}','{"provider":"google"}'),
 ('ff000000-0000-4000-8000-000000000004','coordinador-email@example.test','{}','{"provider":"email"}'),
 ('ff000000-0000-4000-8000-000000000005','agente-google-3@example.test','{}','{"provider":"google"}');
update public.profiles set role='admin' where id='ff000000-0000-4000-8000-000000000001';
select pg_temp.ok((select role from public.profiles where id='ff000000-0000-4000-8000-000000000002')='sin_vincular',
  'una cuenta creada por Google OAuth recibe el rol "sin_vincular" (handle_new_user), no coordinador ni agente');
select pg_temp.ok((select role from public.profiles where id='ff000000-0000-4000-8000-000000000004')='coordinador',
  'una cuenta creada por otra vía (Admin API, correo+contraseña) conserva el default de siempre (coordinador), no "sin_vincular"');

insert into public.personal(id,codigo_personal,nombre,dni,cargo,cliente,unidad,activo) values
 ('fe000000-0000-4000-8000-000000000001','VG-1','Agente Google Uno','55555555','Agente','','','t'),
 ('fe000000-0000-4000-8000-000000000002','VG-2','Agente Ya Vinculado','66666666','Agente','','','t');
update public.personal set profile_id='ff000000-0000-4000-8000-000000000003' where id='fe000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub','ff000000-0000-4000-8000-000000000002',true);

select pg_temp.denied($$select public.vincular_agente_google('66666666')$$,'P0002');
select pg_temp.denied($$select public.vincular_agente_google('00000000')$$,'P0002');

select pg_temp.ok((select (public.vincular_agente_google('55555555')).profile_id='ff000000-0000-4000-8000-000000000002'),
  'vincular_agente_google vincula con el DNI correcto usando auth.uid(), sin recibir ningún id del cliente');
select pg_temp.ok((select role from public.profiles where id='ff000000-0000-4000-8000-000000000002')='agente',
  'el rol pasa a agente tras vincular');
select pg_temp.ok((select email from public.personal where id='fe000000-0000-4000-8000-000000000001')='agente-google@example.test',
  'personal.email se completa con el correo real de auth.users, nunca uno recibido del cliente');

select pg_temp.denied($$select public.vincular_agente_google('55555555')$$,'P0002');

reset role;

-- Otro agente NO puede desvincular ni vincularse al mismo DNI que ya está tomado.
set local role authenticated;
select set_config('request.jwt.claim.sub','ff000000-0000-4000-8000-000000000003',true);
select pg_temp.denied($$select public.vincular_agente_google('55555555')$$,'P0002');
select pg_temp.denied($$select public.desvincular_agente('fe000000-0000-4000-8000-000000000001')$$,'42501');
reset role;

-- Solo admin desvincula.
set local role authenticated;
select set_config('request.jwt.claim.sub','ff000000-0000-4000-8000-000000000001',true);
select pg_temp.ok((select (public.desvincular_agente('fe000000-0000-4000-8000-000000000001')).profile_id is null),
  'admin puede desvincular: personal.profile_id queda en null');
select pg_temp.ok((select role from public.profiles where id='ff000000-0000-4000-8000-000000000002')='sin_vincular',
  'al desvincular, el rol del perfil vuelve a sin_vincular (pierde el acceso de agente)');
reset role;

-- Tras desvincular, el mismo DNI vuelve a estar disponible para vincularse -- con una cuenta de
-- Google distinta (ff...003 ya está tomada por otro DNI, personal.profile_id es único).
set local role authenticated;
select set_config('request.jwt.claim.sub','ff000000-0000-4000-8000-000000000005',true);
select pg_temp.ok((select (public.vincular_agente_google('55555555')).profile_id='ff000000-0000-4000-8000-000000000005'),
  'un DNI desvinculado se puede volver a vincular, incluso a otra cuenta de Google');
reset role;

rollback;

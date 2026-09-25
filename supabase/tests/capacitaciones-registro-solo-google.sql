-- Valida que, con el registro público por correo+contraseña habilitado (el interruptor global
-- que también hace falta para que funcione "Continuar con Google"), una cuenta creada por esa vía
-- quede completamente sin privilegios: handle_new_user() ya no distingue por proveedor, TODA
-- cuenta nueva recibe "sin_vincular" (ver 202609240008_registro_sin_vincular_universal.sql).
-- Corre con "set local role authenticated" (nunca superusuario) simulando exactamente la sesión
-- real de esa cuenta.
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

-- Simula exactamente lo que crearía un POST público a /auth/v1/signup con correo+contraseña
-- (provider "email"), sin pasar por Google ni por el flujo de vinculación.
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values
 ('a1000000-0000-4000-8000-000000000001','autoregistrado@example.test','{}','{"provider":"email"}');
select pg_temp.ok((select role from public.profiles where id='a1000000-0000-4000-8000-000000000001')='sin_vincular',
  'un alta público por correo+contraseña recibe "sin_vincular", igual que Google, nunca coordinador');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);

select pg_temp.ok(not public.is_admin(), 'sin_vincular no es admin');
select pg_temp.ok(not private.es_agente(), 'sin_vincular no es agente (bloquea lib/capacitaciones/auth.ts: whitelist admin/agente/capacitador)');
select pg_temp.ok(not private.es_capacitador(), 'sin_vincular no es capacitador');
select pg_temp.ok((select count(*)=0 from public.capacitaciones),
  'sin_vincular no ve ninguna fila de capacitaciones por RLS, ni siquiera publicadas y asignadas globalmente');
select pg_temp.denied($$select public.listar_capacitaciones_agente()$$,'42501');
select pg_temp.denied($$select public.iniciar_examen(gen_random_uuid())$$,'42501');

reset role;

rollback;

-- Reproduce el flujo de autoregistro de agentes (app/api/capacitaciones/registro/route.ts)
-- ejecutando con el rol service_role REAL vía "set local role" -- nunca como el superusuario que
-- usan las demás pruebas de este directorio. Existe específicamente porque la validación anterior
-- (siempre como superusuario, que bypasea cualquier GRANT) nunca pudo detectar que a service_role
-- le faltaban SELECT/INSERT/UPDATE/DELETE sobre public.personal en producción -- un fallo real que
-- rompió el registro con "permission denied for table personal" hasta
-- 202609240003_restaurar_grants_service_role.sql.
--
-- El servidor de Postgres del entorno de prueba debe crear service_role CON el atributo BYPASSRLS
-- (igual que el service_role real de Supabase, ver comentario en el fixture auth/roles local),
-- porque sin BYPASSRLS un hueco de GRANT como este se manifestaría como negación de RLS y no como
-- el "permission denied for table" real que se vio en producción.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;

insert into public.personal(id,codigo_personal,nombre,dni,cargo,cliente,unidad,activo) values
 ('c9000000-0000-4000-8000-000000000001','SR-1','Agente Prueba Grants','19999999','Agente','Cliente Demo','Unidad Demo',true);

select pg_temp.ok(has_table_privilege('service_role','public.personal','SELECT,INSERT,UPDATE,DELETE'),
  'service_role tiene SELECT/INSERT/UPDATE/DELETE directos sobre public.personal');
select pg_temp.ok(not has_table_privilege('anon','public.personal','INSERT,UPDATE,DELETE'),
  'anon no recibió ningún permiso nuevo sobre personal (RLS sigue siendo su único acceso)');

-- El pre-chequeo de la ruta (admin.from("personal").select(...)) es una consulta DIRECTA de tabla
-- con el cliente service_role, NO pasa por ninguna función SECURITY DEFINER -- a diferencia de
-- las RPC, sí depende por completo de que service_role tenga sus propios GRANT de tabla.
set local role service_role;
select pg_temp.ok((select count(*)=1 from public.personal
    where dni='19999999' and codigo_personal='SR-1' and activo=true),
  'service_role puede hacer el SELECT directo sobre personal que hace la ruta de registro');

select pg_temp.ok(public.registrar_intento_registro('test-grants-ip') is not null,
  'service_role puede invocar public.registrar_intento_registro (RPC en "public", no en "private")');
reset role;

insert into auth.users(id,email,raw_user_meta_data) values
 ('c9000000-0000-4000-8000-000000000002','agente-grants@example.test','{}');

set local role service_role;
select pg_temp.ok((select (public.vincular_agente(
    'c9000000-0000-4000-8000-000000000002','19999999','SR-1')).profile_id
  = 'c9000000-0000-4000-8000-000000000002'),
  'service_role puede invocar public.vincular_agente y el agente queda vinculado');
reset role;

select pg_temp.ok((select role='agente' from public.profiles
    where id='c9000000-0000-4000-8000-000000000002'),
  'vincular_agente asignó el rol agente al perfil recién creado');

rollback;

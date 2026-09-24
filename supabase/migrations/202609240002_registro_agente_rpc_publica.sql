-- Corrige el autoregistro de agentes en producción: PostgREST solo expone RPC para funciones
-- del esquema "public" (el esquema "private" nunca se expone vía API, se valida solo internamente
-- desde SQL/psql -- por eso el bug no apareció en la validación local contra Postgres directo,
-- que no pasa por PostgREST). registrar_intento_registro y vincular_agente se crearon en
-- 202609240001_capacitaciones.sql dentro de "private", así que admin.rpc(...) desde
-- app/api/capacitaciones/registro/route.ts fallaba siempre con "Could not find the function
-- public.<nombre> in the schema cache" -- devuelto como error 400 genérico, sin registrar nada
-- en los logs (el código no llamaba console.error, corregido también en el mismo cambio).
-- Se recrean IDÉNTICAS en "public" con el mismo candado de siempre: revoke total + grant SOLO a
-- service_role, así que solo el servidor (Admin API, nunca el navegador) puede invocarlas -- estar
-- en "public" no las abre a nadie más, solo las hace visibles para PostgREST.
begin;

drop function if exists private.registrar_intento_registro(text);
drop function if exists private.vincular_agente(uuid,text,text);

create function public.registrar_intento_registro(p_clave text) returns integer
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_count integer;
begin
  delete from private.registro_agente_intentos where intentado_at < now() - interval '1 hour';
  insert into private.registro_agente_intentos(clave) values (p_clave);
  select count(*) into v_count from private.registro_agente_intentos where clave=p_clave and intentado_at > now() - interval '1 hour';
  return v_count;
end $$;
revoke all on function public.registrar_intento_registro(text) from public,anon,authenticated;
grant execute on function public.registrar_intento_registro(text) to service_role;

-- Vincula personal ↔ profile tras crear el usuario en Auth (API, service role). Re-valida todo
-- por si hubo una carrera entre la primera verificación y este paso.
create function public.vincular_agente(p_user_id uuid, p_dni text, p_codigo_personal text)
returns public.personal language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_personal public.personal;
begin
  select * into v_personal from public.personal
    where dni=btrim(p_dni) and codigo_personal=btrim(p_codigo_personal) and activo and profile_id is null
    for update;
  if not found then raise exception 'No se encontró un colaborador activo con ese DNI y código, o ya tiene una cuenta' using errcode='P0002'; end if;
  update public.profiles set role='agente', nombre=v_personal.nombre where id=p_user_id;
  update public.personal set profile_id=p_user_id where id=v_personal.id returning * into v_personal;
  return v_personal;
end $$;
revoke all on function public.vincular_agente(uuid,text,text) from public,anon,authenticated;
grant execute on function public.vincular_agente(uuid,text,text) to service_role;

notify pgrst,'reload schema';
commit;

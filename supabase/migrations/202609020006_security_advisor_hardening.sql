-- Propuesta local: aplicar DESPUÉS de 202609020005, primero en staging.
-- No mueve pg_trgm, no cambia datos, firmas de RPC ni políticas RLS.
-- Dashboard > Data API > Exposed schemas: NO incluir private.
begin;

do $preflight$
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid='public.is_admin()'::regprocedure
      and p.prosecdef
      and p.proconfig @> array['search_path=pg_catalog, public, pg_temp']
      and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
  ) or pg_catalog.has_schema_privilege('authenticated','public','CREATE') then
    raise exception 'Aplicar y verificar primero 202609020005_seguridad_produccion.sql';
  end if;
  if 'private'=any(pg_catalog.string_to_array(
    pg_catalog.regexp_replace(coalesce(pg_catalog.current_setting('pgrst.db_schemas',true),''),'\s','','g'),',')) then
    raise exception 'private no debe estar expuesto en Data API';
  end if;
  -- No apropiarse de un schema ajeno ni modificar sus permisos existentes.
  if exists(select 1 from pg_catalog.pg_namespace where nspname='private') then
    if (select nspowner<>current_user::regrole from pg_catalog.pg_namespace where nspname='private')
      or pg_catalog.has_schema_privilege('anon','private','USAGE,CREATE')
      or pg_catalog.has_schema_privilege('authenticated','private','CREATE') then
      raise exception 'Schema private preexistente: revisar owner/ACL antes de aplicar';
    end if;
    if not pg_catalog.has_schema_privilege('authenticated','private','USAGE') and (
      exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='private')
      or exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='private')
    ) then
      raise exception 'Revisar objetos de private antes de ampliar USAGE a authenticated';
    end if;
  end if;
end $preflight$;

create schema if not exists private;
-- Normalizar también posibles grants de schemas heredados de default privileges.
-- El preflight ya rechaza un schema existente con esos permisos inseguros.
revoke all on schema private from public,anon;
revoke create on schema private from authenticated;
-- USAGE no expone el schema a PostgREST ni concede acceso a tablas.
-- Es necesario para evaluar la función desde las políticas RLS.
grant usage on schema private to authenticated;

-- CREATE sin OR REPLACE aborta ante una función homónima preexistente.
create function private.is_admin()
returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles where id=auth.uid() and role='admin'
  );
$$;
revoke all on function private.is_admin() from public,anon,authenticated;
grant execute on function private.is_admin() to authenticated;

-- Conserva OID, firma y dependencias de public.is_admin(): las 17 políticas
-- y las RPC administrativas siguen resolviendo la misma función pública.
-- Solo el pequeño helper privado eleva privilegios y evita recursión en profiles.
create or replace function public.is_admin()
returns boolean language sql stable security invoker
set search_path=pg_catalog,pg_temp as $$
  select private.is_admin();
$$;
revoke all on function public.is_admin() from public,anon,authenticated;
grant execute on function public.is_admin() to authenticated;

comment on function private.is_admin() is
  'Helper RLS: rol del auth.uid() actual, sin parámetros. Mantener private fuera de Data API.';
comment on function public.is_admin() is
  'Fachada INVOKER compatible con políticas y RPC existentes; delega en private.is_admin().';
notify pgrst,'reload schema';
commit;

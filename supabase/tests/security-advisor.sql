-- SOLO base aislada con las ocho migraciones. Fixtures con ROLLBACK.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.denied(command text) returns void language plpgsql as $$
begin
  begin execute command; exception when insufficient_privilege then raise notice 'PASS: denied'; return; end;
  raise exception 'FAIL: unauthorized operation accepted';
end $$;

select pg_temp.ok((select not prosecdef from pg_proc where oid='public.is_admin()'::regprocedure),'public compatibility wrapper is INVOKER');
select pg_temp.ok((select prosecdef and proconfig @> array['search_path=pg_catalog, pg_temp']
  from pg_proc where oid='private.is_admin()'::regprocedure),'private helper DEFINER has safe path');
select pg_temp.ok(not has_schema_privilege('anon','private','USAGE') and
  not has_schema_privilege('authenticated','private','CREATE'),'private schema is not writable or usable by anon');
select pg_temp.ok(has_schema_privilege('authenticated','private','USAGE'),'authenticated has only required schema usage');
select pg_temp.ok(not has_function_privilege('anon','private.is_admin()','EXECUTE') and
  not has_function_privilege('anon','public.is_admin()','EXECUTE'),'anon cannot execute either helper');
select pg_temp.ok(not exists (
  select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where p.oid in ('public.is_admin()'::regprocedure,'private.is_admin()'::regprocedure)
    and a.grantee=0 and a.privilege_type='EXECUTE'
),'no PUBLIC execute grant');
-- Equivalent relevant scope of Advisor 0029 with public as the only exposed schema.
select pg_temp.ok((select array_agg(p.proname::text order by p.proname)=array[
  'crear_requerimiento','editar_prendas_requerimiento','obtener_edicion_prendas']
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE')),
  'only three intentional DEFINER RPC warnings remain in public');
select pg_temp.ok((select n.nspname='public' from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  where e.extname='pg_trgm'),'pg_trgm deliberately not relocated');
select pg_temp.ok((select count(*)=3 and bool_and(i.indisvalid) from pg_index i join pg_class c on c.oid=i.indexrelid
  where c.relname in ('personal_nombre_trgm_idx','personal_dni_trgm_idx','personal_codigo_trgm_idx')),'three trigram indexes remain valid');

insert into auth.users(id,email,raw_user_meta_data) values
 ('15000000-0000-4000-8000-000000000001','advisor-owner@example.test','{"role":"admin"}'),
 ('15000000-0000-4000-8000-000000000002','advisor-admin@example.test','{}');
update public.profiles set role='admin' where id='15000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.ok(not public.is_admin() and not private.is_admin(),'no uid means false, not elevated access');
select set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000099',true);
select pg_temp.ok(not public.is_admin(),'uid without profile means false');
select set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','admin',true);
create temporary table profiles(id uuid,role text);
insert into pg_temp.profiles values(auth.uid(),'admin');
set local search_path=pg_temp,public;
select pg_temp.ok(not public.is_admin() and not private.is_admin(),'metadata, role claim and temporary shadow cannot promote coordinator');
select pg_temp.ok((select count(*)=1 from public.profiles where id in (
 '15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000002')),'profile RLS still filters coordinator without recursion');
select pg_temp.denied('select public.admin_opciones_requerimientos()');
select pg_temp.denied('select public.admin_consultar_requerimientos(p_exportar=>true)');
select pg_temp.denied('alter function private.is_admin() security invoker');
select set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000002',true);
select pg_temp.ok(public.is_admin() and private.is_admin(),'admin role still recognized');
select pg_temp.ok((select count(*)=2 from public.profiles where id in (
 '15000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000002')),'admin profile RLS still works');
set local search_path=public;
select pg_temp.ok(public.admin_opciones_requerimientos() is not null,'admin options RPC compatibility');
select pg_temp.ok(public.admin_consultar_requerimientos(p_exportar=>true) is not null,'admin export query RPC compatibility');
select pg_temp.ok((select count(*)>=0 from public.buscar_personal('Agente',20)),'buscar_personal still resolves public.similarity');
reset role;
set local role anon;
select pg_temp.denied('select public.is_admin()');
select pg_temp.denied('select private.is_admin()');
reset role;
rollback;

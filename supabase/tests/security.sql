-- SOLO base aislada, siete migraciones. Ningún cambio persiste.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.denied(command text) returns void language plpgsql as $$
begin
  begin execute command; exception when insufficient_privilege then raise notice 'PASS: denied'; return; end;
  raise exception 'FAIL: unauthorized operation accepted';
end $$;
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where oid=any(array[
 'public.profiles'::regclass,'public.personal'::regclass,'public.clientes'::regclass,'public.unidades'::regclass,
 'public.prendas'::regclass,'public.requerimientos'::regclass,'public.detalle_requerimiento'::regclass])),'RLS in all seven tables');
do $$ declare t text; begin
 foreach t in array array['profiles','personal','clientes','unidades','prendas','requerimientos','detalle_requerimiento'] loop
   perform pg_temp.ok(not has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'anon no privileges '||t);
   perform pg_temp.ok(not has_table_privilege('authenticated','public.'||t,'DELETE,TRUNCATE'),'authenticated cannot delete/truncate '||t);
 end loop;
end $$;
select pg_temp.ok(not has_table_privilege('authenticated','requerimientos','INSERT'),'cannot bypass creation RPC');
select pg_temp.ok(not has_table_privilege('authenticated','profiles','UPDATE'),'cannot promote profile');
select pg_temp.ok(not has_schema_privilege('authenticated','public','CREATE'),'cannot shadow public functions');
select pg_temp.ok((select bool_and(not has_function_privilege('anon',p.oid,'EXECUTE') and
 array_to_string(p.proconfig,',') like '%search_path=pg_catalog, public, pg_temp%')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef),'all DEFINER functions hardened');
select pg_temp.ok(not has_function_privilege('authenticated','handle_new_user()','EXECUTE'),'trigger not exposed as RPC');
insert into auth.users(id,email,raw_user_meta_data) values
 ('14000000-0000-4000-8000-000000000001','security-test@example.test','{"role":"admin","nombre":"Attacker"}');
select pg_temp.ok((select role='coordinador' from profiles where id='14000000-0000-4000-8000-000000000001'),'client metadata cannot choose admin');
set local role authenticated;
select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','admin',true);
select pg_temp.ok(not is_admin(),'untrusted role claim does not override database profile');
select pg_temp.denied($q$update profiles set role='admin' where id=auth.uid()$q$);
select pg_temp.denied($q$insert into requerimientos(agente_id,usuario_creador_id,fecha)
 values('00000000-0000-4000-8000-000000000001',auth.uid(),'2000-01-01')$q$);
select pg_temp.denied('select admin_consultar_requerimientos(p_exportar=>true)');
select pg_temp.denied('select admin_opciones_requerimientos()');
-- Public precede pg_temp: una tabla temporal no puede engañar SECURITY DEFINER.
create temporary table profiles(id uuid,role text);
insert into pg_temp.profiles values(auth.uid(),'admin');
select pg_temp.ok(not public.is_admin(),'temporary shadow table cannot promote role');
do $$ begin
 begin perform buscar_personal(repeat('x',121)); raise exception 'FAIL: huge search'; exception when invalid_parameter_value then raise notice 'PASS: search bound'; end;
end $$;
select pg_temp.ok((select count(*)=0 from buscar_personal($q$'; drop table profiles; --$q$)),'search injection is text');
reset role;
set local role anon;
do $$ declare t text; begin
 foreach t in array array['profiles','personal','clientes','unidades','prendas','requerimientos','detalle_requerimiento'] loop
   perform pg_temp.denied(format('select * from public.%I limit 1',t));
 end loop;
end $$;
select pg_temp.denied('select is_admin()');
select pg_temp.denied('select buscar_personal(''Agente'')');
reset role;
rollback;

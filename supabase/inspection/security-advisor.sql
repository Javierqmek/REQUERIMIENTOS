-- SOLO LECTURA: ejecutar antes y después en Supabase SQL Editor.
-- No incluye tokens, datos personales, DDL ni DML.
select p.oid::regprocedure as signature,n.nspname as schema,
  pg_catalog.pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,p.proacl,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  pg_catalog.pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.prokind='f' and p.proname in (
  'is_admin','crear_requerimiento','editar_prendas_requerimiento','obtener_edicion_prendas',
  'buscar_personal','admin_opciones_requerimientos','admin_consultar_requerimientos')
order by n.nspname,p.proname,p.oid;

select n.nspname,pg_catalog.pg_get_userbyid(n.nspowner) as owner,n.nspacl,
  pg_catalog.has_schema_privilege('anon',n.oid,'CREATE') as anon_create,
  pg_catalog.has_schema_privilege('authenticated',n.oid,'CREATE') as authenticated_create
from pg_catalog.pg_namespace n where n.nspname in ('public','private','extensions');
-- NULL no demuestra qué schemas expone PostgREST: verificar también Dashboard.
select pg_catalog.current_setting('pgrst.db_schemas',true) as exposed_schemas_if_available;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_catalog.pg_policies where schemaname='public' order by tablename,policyname;
select c.relname,c.relrowsecurity from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p');

select e.extname,e.extversion,e.extrelocatable,n.nspname as extension_schema
from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace
where e.extname='pg_trgm';
select i.indexrelid::regclass as index_name,i.indisvalid,
  pg_catalog.pg_get_indexdef(i.indexrelid) as definition,
  op.oid as opclass_oid,ns.nspname as opclass_schema,op.opcname
from pg_catalog.pg_index i cross join lateral unnest(i.indclass) as cls(opclass_oid)
join pg_catalog.pg_opclass op on op.oid=cls.opclass_oid
join pg_catalog.pg_namespace ns on ns.oid=op.opcnamespace
where op.opcname in ('gin_trgm_ops','gist_trgm_ops');
-- Búsqueda textual auxiliar; no descubre SQL externo/dinámico ni todos los
-- operadores de extensiones. NO es autorización automática para SET SCHEMA.
select p.oid::regprocedure as signature,p.prosrc
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname not in ('pg_catalog','information_schema') and p.prokind='f'
  and (p.prosrc ilike '%similarity%' or p.prosrc ilike '%trgm%');

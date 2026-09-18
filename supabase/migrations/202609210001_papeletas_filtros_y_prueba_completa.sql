-- Mejora puntual del módulo de Vacaciones: listados filtrados con paginación en servidor (mismo
-- patrón que 202609160002_requerimientos_filtros.sql) y borrado de prueba extendido a FIRMADO y
-- CONFORME (histórico) cuando es_prueba=true. 202609170001..202609200001 YA ESTÁN APLICADAS: no
-- se modifican ni se repiten. Ejecutar después de 202609200001_papeletas_firma.sql.
begin;

-- Opciones para poblar los filtros sin cargar toda la tabla: coordinador ve solo lo que aparece
-- en SUS papeletas (mismo criterio que opciones_requerimientos_propios); admin/gerente ven todo
-- el catálogo activo, más la lista de coordinadores con papeletas registradas.
create function public.opciones_papeletas_vacaciones()
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb; v_revisor boolean;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  v_revisor := public.is_admin() or private.es_gerente();
  select jsonb_build_object(
    'clientes', case when v_revisor then
        coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from (select id,nombre from public.clientes where activo) x),'[]'::jsonb)
      else
        coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from (
          select distinct c.id,c.nombre from public.papeletas_vacaciones p join public.clientes c on c.id=p.cliente_id
          where p.coordinador_id=auth.uid()) x),'[]'::jsonb)
      end,
    'unidades', case when v_revisor then
        coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from (select id,cliente_id,nombre from public.unidades where activo) x),'[]'::jsonb)
      else
        coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from (
          select distinct u.id,u.cliente_id,u.nombre from public.papeletas_vacaciones p join public.unidades u on u.id=p.unidad_id
          where p.coordinador_id=auth.uid()) x),'[]'::jsonb)
      end,
    'provincias', coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from (select id,nombre from public.provincias where activo) x),'[]'::jsonb),
    'coordinadores', case when v_revisor then
        coalesce((select jsonb_agg(to_jsonb(x) order by x.nombre) from (
          select distinct pr.id,pr.nombre from public.papeletas_vacaciones p join public.profiles pr on pr.id=p.coordinador_id) x),'[]'::jsonb)
      else '[]'::jsonb end
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.opciones_papeletas_vacaciones() from public,anon,authenticated;
grant execute on function public.opciones_papeletas_vacaciones() to authenticated;

-- Listado filtrado y paginado en servidor, UNA sola función reutilizada por coordinador (queda
-- acotado a sus propias papeletas, reforzando la RLS ya vigente) y por admin/gerente (ven todas,
-- con filtro adicional opcional por coordinador). Evita duplicar dos implementaciones del mismo
-- motor de consulta. No trae de más: solo las columnas que usa la tarjeta compacta + los ids para
-- resolver los filtros ya aplicados (no hace falta traer físicas/venta/reemplazo aquí).
create function public.listar_papeletas_vacaciones_filtradas(
  p_busqueda text default null, p_cliente_id uuid default null, p_unidad_id uuid default null,
  p_provincia_id uuid default null, p_estado public.papeleta_estado default null,
  p_coordinador_id uuid default null, p_desde date default null, p_hasta date default null,
  p_limite integer default 20, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  if length(coalesce(p_busqueda,''))>120 or p_limite is null or p_limite<1 or p_limite>100
    or p_offset is null or p_offset<0 or p_offset>500000 then
    raise exception 'Paginación inválida' using errcode='22023'; end if;
  if p_desde is not null and p_hasta is not null and p_desde>p_hasta then
    raise exception 'El rango de fechas de registro es inválido' using errcode='22023'; end if;
  with base as materialized (
    select p.id,p.created_at,p.colaborador_nombre,p.colaborador_codigo,p.estado,p.version_actual,
      p.motivo_observacion,p.archivo_nombre,p.es_prueba,p.coordinador_id,p.cliente_id,p.unidad_id,p.provincia_id,
      jsonb_build_object('nombre',c.nombre) clientes,jsonb_build_object('nombre',u.nombre) unidades,
      jsonb_build_object('nombre',prov.nombre) provincias,jsonb_build_object('nombre',pr.nombre) profiles
    from public.papeletas_vacaciones p
    left join public.clientes c on c.id=p.cliente_id
    left join public.unidades u on u.id=p.unidad_id
    left join public.provincias prov on prov.id=p.provincia_id
    left join public.profiles pr on pr.id=p.coordinador_id
    -- Mismo criterio que la política papeletas_vacaciones_lectura: propio dueño, admin o gerente.
    -- Un coordinador nunca puede ver papeletas ajenas, sin importar qué filtros mande.
    where p.coordinador_id=auth.uid() or public.is_admin() or private.es_gerente()
  ), filtered as (
    select * from base b where
      (p_cliente_id is null or b.cliente_id=p_cliente_id)
      and (p_unidad_id is null or b.unidad_id=p_unidad_id)
      and (p_provincia_id is null or b.provincia_id=p_provincia_id)
      and (p_estado is null or b.estado=p_estado)
      and (p_coordinador_id is null or b.coordinador_id=p_coordinador_id)
      and (p_desde is null or b.created_at>=p_desde)
      and (p_hasta is null or b.created_at<(p_hasta+1))
      and (nullif(trim(p_busqueda),'') is null
        or position(lower(trim(p_busqueda)) in lower(concat_ws(' ',b.colaborador_nombre,b.colaborador_codigo)))>0)
  )
  select jsonb_build_object('total',(select count(*) from filtered),
    'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc)
      from (select * from filtered order by created_at desc,id desc limit p_limite offset p_offset) x),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.listar_papeletas_vacaciones_filtradas(text,uuid,uuid,uuid,public.papeleta_estado,uuid,date,date,integer,integer) from public,anon,authenticated;
grant execute on function public.listar_papeletas_vacaciones_filtradas(text,uuid,uuid,uuid,public.papeleta_estado,uuid,date,date,integer,integer) to authenticated;

-- Auditoría de eliminación de pruebas: sobrevive a la papeleta que borra. Se escribe DENTRO de la
-- misma transacción que hace el borrado (ver private.admin_eliminar_papeletas_prueba), así que si
-- la transacción no confirma, tampoco queda registro de auditoría de algo que no se llegó a borrar.
-- Nadie puede editarla ni borrarla desde la app: solo INSERT desde la función security definer, y
-- SELECT para admin.
create table public.papeletas_vacaciones_eliminaciones_auditoria (
  id bigint generated always as identity primary key,
  papeleta_id uuid not null,
  colaborador_nombre text not null,
  colaborador_codigo text not null,
  coordinador_id uuid,
  estado_al_eliminar public.papeleta_estado not null,
  version_actual integer not null,
  cantidad_versiones integer not null,
  eliminado_por uuid not null references public.profiles(id),
  motivo text not null default 'ELIMINACION_PRUEBA',
  created_at timestamptz not null default now()
);
alter table public.papeletas_vacaciones_eliminaciones_auditoria enable row level security;
alter table public.papeletas_vacaciones_eliminaciones_auditoria force row level security;
create policy papeletas_vacaciones_eliminaciones_auditoria_lectura on public.papeletas_vacaciones_eliminaciones_auditoria
  for select to authenticated using (public.is_admin());
revoke all on public.papeletas_vacaciones_eliminaciones_auditoria from public,anon,authenticated;
grant select on public.papeletas_vacaciones_eliminaciones_auditoria to authenticated;
revoke all on sequence public.papeletas_vacaciones_eliminaciones_auditoria_id_seq from public,anon,authenticated;

-- admin_marcar_papeleta_prueba: se retira el bloqueo de FIRMADO/CONFORME. Regla nueva explícita:
-- lo único que protege a una papeleta de poder marcarse (y luego eliminarse) como prueba es que
-- es_prueba ya sea true por marcado EXPLÍCITO -- nunca se infiere por estado, nombre ni fecha. El
-- caso de uso real: durante pruebas, una papeleta de prueba puede llegar a FIRMADO o incluso ser
-- una CONFORME histórica de prueba, y debe poder limpiarse igual que cualquier otra de prueba.
create or replace function private.admin_marcar_papeleta_prueba(p_papeleta_id uuid,p_es_prueba boolean)
returns public.papeletas_vacaciones language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.papeletas_vacaciones;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  select * into v_doc from public.papeletas_vacaciones where id=p_papeleta_id for update;
  if not found then raise exception 'Papeleta no encontrada' using errcode='P0002'; end if;
  update public.papeletas_vacaciones set es_prueba=coalesce(p_es_prueba,false) where id=p_papeleta_id returning * into v_doc;
  return v_doc;
end $$;
revoke all on function private.admin_marcar_papeleta_prueba(uuid,boolean) from public,anon,authenticated;
grant execute on function private.admin_marcar_papeleta_prueba(uuid,boolean) to authenticated;

-- admin_eliminar_papeletas_prueba: se retira el bloqueo de FIRMADO/CONFORME (ya NO existe ningún
-- estado que impida borrar una papeleta marcada es_prueba=true). La única protección real sigue
-- siendo es_prueba=true, el flag de private.app_config y el flag de entorno de la capa app. Antes
-- de borrar cualquier fila, se registra la auditoría (sobrevive al borrado) y se deja la cola de
-- limpieza de Storage pendiente, exactamente igual que antes.
create or replace function private.admin_eliminar_papeletas_prueba(p_ids uuid[])
returns text[] language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_count integer; v_unique integer; v_paths text[];
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores' using errcode='42501'; end if;
  if not coalesce((select habilitado from private.app_config where clave='allow_test_papeleta_deletion'),false) then
    raise exception 'La eliminación de papeletas de prueba está deshabilitada' using errcode='55000'; end if;
  if p_ids is null or cardinality(p_ids)<1 or cardinality(p_ids)>100 or array_position(p_ids,null) is not null then
    raise exception 'Selecciona entre 1 y 100 papeletas' using errcode='22023'; end if;
  select count(distinct id) into v_unique from unnest(p_ids) id;
  if v_unique<>cardinality(p_ids) then raise exception 'No repitas papeletas' using errcode='22023'; end if;
  perform p.id from public.papeletas_vacaciones p where p.id=any(p_ids) order by p.id for update;
  get diagnostics v_count=row_count;
  if v_count<>v_unique then raise exception 'Una o más papeletas no existen' using errcode='P0002'; end if;
  if exists(select 1 from public.papeletas_vacaciones p where p.id=any(p_ids) and not p.es_prueba) then
    raise exception 'Solo se pueden eliminar papeletas marcadas como prueba' using errcode='55000'; end if;

  select coalesce(array_agg(v.archivo_path),'{}') into v_paths
    from public.papeletas_vacaciones_versiones v where v.papeleta_id=any(p_ids);

  insert into public.papeletas_vacaciones_eliminaciones_auditoria(
    papeleta_id,colaborador_nombre,colaborador_codigo,coordinador_id,estado_al_eliminar,
    version_actual,cantidad_versiones,eliminado_por,motivo
  )
  select p.id,p.colaborador_nombre,p.colaborador_codigo,p.coordinador_id,p.estado,
    p.version_actual,(select count(*) from public.papeletas_vacaciones_versiones v where v.papeleta_id=p.id),
    auth.uid(),'ELIMINACION_PRUEBA'
  from public.papeletas_vacaciones p where p.id=any(p_ids);

  insert into private.papeleta_storage_borrado_pendiente(archivo_path,papeleta_id,creado_por)
  select v.archivo_path,v.papeleta_id,auth.uid()
  from public.papeletas_vacaciones_versiones v where v.papeleta_id=any(p_ids)
  on conflict (archivo_path) do nothing;

  perform pg_catalog.set_config('app.test_papeleta_deletion','on',true);
  delete from public.papeletas_vacaciones_eventos where papeleta_id=any(p_ids);
  delete from public.papeletas_vacaciones_versiones where papeleta_id=any(p_ids);
  delete from public.papeletas_vacaciones where id=any(p_ids);
  perform pg_catalog.set_config('app.test_papeleta_deletion','off',true);
  return v_paths;
end $$;
revoke all on function private.admin_eliminar_papeletas_prueba(uuid[]) from public,anon,authenticated;
grant execute on function private.admin_eliminar_papeletas_prueba(uuid[]) to authenticated;

notify pgrst,'reload schema';
commit;

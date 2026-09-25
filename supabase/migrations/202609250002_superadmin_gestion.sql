-- Separa los roles de administración: admin queda restringido a Requerimientos + Administración
-- (Mantenimiento de catálogos: Clientes/Unidades/Personal/Prendas/Provincias + Importaciones).
-- superadmin tiene acceso total: todo lo de admin, más Documentos (incluidas Vacaciones y
-- Papeletas) y Capacitaciones (Gestión y Agentes), y la gestión de usuarios y roles.
-- Requiere 202609250001_rol_superadmin.sql ya aplicada (con commit) antes que esta.
begin;

-- ============================================================================
-- private.is_admin() ahora también es verdadero para superadmin: así, TODO lo que ya dependía de
-- is_admin() para el dominio "uniformes" (Requerimientos, Mantenimiento de catálogos --
-- clientes/unidades/personal/prendas/provincias --, Importaciones; ver
-- 202608170001_initial_schema.sql, 202609020001, 202609020002, 202609100002,
-- 202609100003, 202609130001, 202609160001, 202609160002, 202609180001_admin_catalogo_provincias)
-- sigue funcionando exactamente igual para admin Y ahora también para superadmin, SIN tocar
-- ninguna de esas migraciones ya aplicadas.
create or replace function private.is_admin()
returns boolean language sql stable security definer
set search_path=pg_catalog,pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles where id=auth.uid() and role in ('admin','superadmin')
  );
$$;

-- Nuevo: verdadero SOLO para superadmin (nunca para admin). Se usa para todo lo que admin YA NO
-- debe poder hacer: Documentos, Vacaciones/Papeletas, Capacitaciones, y gestión de usuarios/roles.
create function private.is_superadmin() returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles where id=auth.uid() and role='superadmin'
  );
$$;
revoke all on function private.is_superadmin() from public,anon,authenticated;
grant execute on function private.is_superadmin() to authenticated;

create function public.is_superadmin() returns boolean
language sql stable security invoker set search_path=pg_catalog,pg_temp as $$
  select private.is_superadmin();
$$;
revoke all on function public.is_superadmin() from public,anon,authenticated;
grant execute on function public.is_superadmin() to authenticated;

-- ============================================================================
-- Documentos: is_admin() -> is_superadmin(). admin pierde acceso; el resto de la lógica
-- (usuario_creador_id/firmante_id/coordinador) queda exactamente igual.
-- ============================================================================
drop policy perfiles_firma_lectura on public.perfiles_firma;
create policy perfiles_firma_lectura on public.perfiles_firma for select to authenticated
using(usuario_id=auth.uid() or public.is_superadmin());

drop policy documentos_lectura on public.documentos;
create policy documentos_lectura on public.documentos for select to authenticated
using(usuario_creador_id=auth.uid() or firmante_id=auth.uid() or public.is_superadmin());

do $$ begin if to_regclass('storage.objects') is not null then
  execute 'drop policy if exists documentos_firma_select on storage.objects';
  execute $p$create policy documentos_firma_select on storage.objects for select to authenticated using(bucket_id='documentos-firma' and (
    (((storage.foldername(name))[1] in ('firmas','sellos')) and ((storage.foldername(name))[2]=auth.uid()::text or public.is_superadmin()))
    or exists(select 1 from public.documentos d where (d.archivo_original_path=name or d.archivo_coordinador_path=name or d.archivo_firmado_path=name) and (d.usuario_creador_id=auth.uid() or d.firmante_id=auth.uid() or public.is_superadmin()))
    or exists(select 1 from public.documento_firmas f join public.documentos d on d.id=f.documento_id where f.asset_path=name and (d.usuario_creador_id=auth.uid() or d.firmante_id=auth.uid() or public.is_superadmin()))))$p$;
end if; end $$;

create or replace function public.registrar_descarga_documento(p_documento_id uuid,p_tipo text)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.documentos;
begin
 select * into v_doc from public.documentos where id=p_documento_id;
 if not found or not(v_doc.usuario_creador_id=auth.uid() or v_doc.firmante_id=auth.uid() or public.is_superadmin())
  then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_tipo not in ('original','coordinador','firmado')
  then raise exception 'Tipo inválido' using errcode='22023'; end if;
 if p_tipo='coordinador' and v_doc.archivo_coordinador_path is null
  then raise exception 'Versión no disponible' using errcode='P0002'; end if;
 perform private.registrar_evento_documento(
  p_documento_id,'DESCARGADO',v_doc.estado,v_doc.estado,null,
  jsonb_build_object('tipo',p_tipo,'usuario_id',auth.uid(),'fecha_servidor',clock_timestamp())
 );
end $$;
revoke all on function public.registrar_descarga_documento(uuid,text) from public,anon,authenticated;
grant execute on function public.registrar_descarga_documento(uuid,text) to authenticated;

create or replace function public.admin_desactivar_perfil_firma(p_usuario_id uuid) returns void
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if auth.uid() is null or not public.is_superadmin() then raise exception 'Solo superadmin' using errcode='42501'; end if;
 update public.perfiles_firma set activo=false where usuario_id=p_usuario_id and activo;
end $$;

-- ============================================================================
-- Papeletas / Vacaciones: is_admin() -> is_superadmin(). Provincias NO se toca aquí: aunque vive
-- en estos mismos archivos históricos, es un catálogo de Mantenimiento (uniformes) según el
-- alcance pedido para admin, así que sigue con is_admin() (ya cubre admin y superadmin).
-- ============================================================================
drop policy papeletas_vacaciones_lectura on public.papeletas_vacaciones;
create policy papeletas_vacaciones_lectura on public.papeletas_vacaciones for select to authenticated
using (coordinador_id = auth.uid() or public.is_superadmin() or private.es_gerente());

drop policy papeletas_vacaciones_versiones_lectura on public.papeletas_vacaciones_versiones;
create policy papeletas_vacaciones_versiones_lectura on public.papeletas_vacaciones_versiones for select to authenticated
using (exists(select 1 from public.papeletas_vacaciones p where p.id=papeleta_id
  and (p.coordinador_id=auth.uid() or public.is_superadmin() or private.es_gerente())));

drop policy papeletas_vacaciones_eventos_lectura on public.papeletas_vacaciones_eventos;
create policy papeletas_vacaciones_eventos_lectura on public.papeletas_vacaciones_eventos for select to authenticated
using (exists(select 1 from public.papeletas_vacaciones p where p.id=papeleta_id
  and (p.coordinador_id=auth.uid() or public.is_superadmin() or private.es_gerente())));

drop policy papeletas_vacaciones_eliminaciones_auditoria_lectura on public.papeletas_vacaciones_eliminaciones_auditoria;
create policy papeletas_vacaciones_eliminaciones_auditoria_lectura on public.papeletas_vacaciones_eliminaciones_auditoria
  for select to authenticated using (public.is_superadmin());

do $$ begin if to_regclass('storage.objects') is not null then
  execute 'drop policy if exists papeletas_storage_select on storage.objects';
  execute $p$create policy papeletas_storage_select on storage.objects for select to authenticated
    using(bucket_id='papeletas-vacaciones' and exists(
     select 1 from public.papeletas_vacaciones p where p.archivo_path=name
      and (p.coordinador_id=auth.uid() or public.is_superadmin() or private.es_gerente())
    ))$p$;

  execute 'drop policy if exists papeletas_storage_select_version on storage.objects';
  execute $p$create policy papeletas_storage_select_version on storage.objects for select to authenticated
    using(bucket_id='papeletas-vacaciones' and exists(
     select 1 from public.papeletas_vacaciones_versiones v join public.papeletas_vacaciones p on p.id=v.papeleta_id
     where v.archivo_path=name and (p.coordinador_id=auth.uid() or public.is_superadmin() or private.es_gerente())
    ))$p$;

  execute 'drop policy if exists papeletas_storage_delete_admin_huerfanos on storage.objects';
  execute $p$create policy papeletas_storage_delete_admin_huerfanos on storage.objects for delete to authenticated
    using(bucket_id='papeletas-vacaciones' and public.is_superadmin()
     and not exists(select 1 from public.papeletas_vacaciones p where p.archivo_path=name)
     and not exists(select 1 from public.papeletas_vacaciones_versiones v where v.archivo_path=name))$p$;
end if; end $$;

create or replace function private.admin_marcar_papeleta_prueba(p_papeleta_id uuid,p_es_prueba boolean)
returns public.papeletas_vacaciones language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.papeletas_vacaciones;
begin
  if auth.uid() is null or not public.is_superadmin() then raise exception 'Solo superadmin' using errcode='42501'; end if;
  select * into v_doc from public.papeletas_vacaciones where id=p_papeleta_id for update;
  if not found then raise exception 'Papeleta no encontrada' using errcode='P0002'; end if;
  update public.papeletas_vacaciones set es_prueba=coalesce(p_es_prueba,false) where id=p_papeleta_id returning * into v_doc;
  return v_doc;
end $$;

create or replace function private.admin_eliminar_papeletas_prueba(p_ids uuid[])
returns text[] language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_count integer; v_unique integer; v_paths text[];
begin
  if auth.uid() is null or not public.is_superadmin() then
    raise exception 'Solo superadmin' using errcode='42501'; end if;
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

create or replace function private.admin_confirmar_borrado_storage(p_paths text[])
returns integer language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_count integer;
begin
  if auth.uid() is null or not public.is_superadmin() then raise exception 'Solo superadmin' using errcode='42501'; end if;
  if p_paths is null or cardinality(p_paths)<1 then return 0; end if;
  delete from private.papeleta_storage_borrado_pendiente where archivo_path=any(p_paths);
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create or replace function private.admin_registrar_intento_borrado_storage(p_paths text[],p_error text)
returns void language plpgsql volatile security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_superadmin() then raise exception 'Solo superadmin' using errcode='42501'; end if;
  if p_paths is null or cardinality(p_paths)<1 then return; end if;
  update private.papeleta_storage_borrado_pendiente
    set intentos=intentos+1,ultimo_intento_at=now(),ultimo_error=left(coalesce(p_error,''),500)
  where archivo_path=any(p_paths);
end $$;

create or replace function private.admin_listar_borrados_pendientes()
returns setof private.papeleta_storage_borrado_pendiente language plpgsql stable security definer
set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.uid() is null or not public.is_superadmin() then raise exception 'Solo superadmin' using errcode='42501'; end if;
  return query select * from private.papeleta_storage_borrado_pendiente order by created_at;
end $$;

create or replace function public.observar_papeleta_vacaciones(p_papeleta_id uuid,p_motivo text)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_doc public.papeletas_vacaciones; v_motivo text;
begin
  if auth.uid() is null or not (public.is_superadmin() or private.es_gerente()) then
    raise exception 'Solo superadmin o gerentes pueden observar' using errcode='42501'; end if;
  v_motivo:=nullif(btrim(p_motivo),'');
  if v_motivo is null or char_length(v_motivo)>1000 then
    raise exception 'El motivo de observación es obligatorio' using errcode='22023'; end if;
  select * into v_doc from public.papeletas_vacaciones where id=p_papeleta_id for update;
  if not found then raise exception 'Papeleta no encontrada' using errcode='P0002'; end if;
  if v_doc.coordinador_id=auth.uid() then raise exception 'No puedes observar tu propia papeleta' using errcode='42501'; end if;
  if v_doc.estado<>'REGISTRADO' then raise exception 'Solo puede observarse una papeleta registrada' using errcode='55000'; end if;
  update public.papeletas_vacaciones set estado='OBSERVADO',motivo_observacion=v_motivo,
    observado_por=auth.uid(),observado_at=now(),updated_at=now() where id=p_papeleta_id;
  insert into public.papeletas_vacaciones_eventos(papeleta_id,usuario_id,accion,estado_anterior,estado_nuevo,version,motivo)
  values (p_papeleta_id,auth.uid(),'OBSERVADO','REGISTRADO','OBSERVADO',v_doc.version_actual,v_motivo);
end $$;

create or replace function public.opciones_papeletas_vacaciones()
returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb; v_revisor boolean;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  v_revisor := public.is_superadmin() or private.es_gerente();
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

create or replace function public.listar_papeletas_vacaciones_filtradas(
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
    where p.coordinador_id=auth.uid() or public.is_superadmin() or private.es_gerente()
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

-- ============================================================================
-- Capacitaciones: is_admin() -> is_superadmin() en todas las políticas y funciones. capacitador/
-- agente conservan exactamente su acceso actual.
-- ============================================================================
drop policy capacitaciones_lectura on public.capacitaciones;
create policy capacitaciones_lectura on public.capacitaciones for select to authenticated
using (public.is_superadmin() or private.es_capacitador() or (estado='PUBLICADA' and private.capacitacion_asignada_a_mi(id)));

drop policy capacitaciones_insert on public.capacitaciones;
create policy capacitaciones_insert on public.capacitaciones for insert to authenticated
with check (capacitador_id=auth.uid() and (private.es_capacitador() or public.is_superadmin()));

drop policy capacitaciones_update on public.capacitaciones;
create policy capacitaciones_update on public.capacitaciones for update to authenticated
using (capacitador_id=auth.uid() or public.is_superadmin()) with check (capacitador_id=auth.uid() or public.is_superadmin());

drop policy capacitacion_asignaciones_rw on public.capacitacion_asignaciones;
create policy capacitacion_asignaciones_rw on public.capacitacion_asignaciones for all to authenticated
using (public.is_superadmin() or exists(select 1 from public.capacitaciones c where c.id=capacitacion_id and c.capacitador_id=auth.uid()))
with check (public.is_superadmin() or exists(select 1 from public.capacitaciones c where c.id=capacitacion_id and c.capacitador_id=auth.uid()));

drop policy examen_preguntas_rw on public.examen_preguntas;
create policy examen_preguntas_rw on public.examen_preguntas for all to authenticated
using (public.is_superadmin() or exists(select 1 from public.capacitaciones c where c.id=capacitacion_id and c.capacitador_id=auth.uid()))
with check (public.is_superadmin() or exists(select 1 from public.capacitaciones c where c.id=capacitacion_id and c.capacitador_id=auth.uid()));

drop policy examen_opciones_rw on public.examen_opciones;
create policy examen_opciones_rw on public.examen_opciones for all to authenticated
using (public.is_superadmin() or exists(select 1 from public.examen_preguntas q join public.capacitaciones c on c.id=q.capacitacion_id where q.id=pregunta_id and c.capacitador_id=auth.uid()))
with check (public.is_superadmin() or exists(select 1 from public.examen_preguntas q join public.capacitaciones c on c.id=q.capacitacion_id where q.id=pregunta_id and c.capacitador_id=auth.uid()));

drop policy capacitacion_progreso_lectura on public.capacitacion_progreso;
create policy capacitacion_progreso_lectura on public.capacitacion_progreso for select to authenticated
using (agente_id=auth.uid() or public.is_superadmin() or private.es_capacitador());

drop policy examen_intentos_lectura on public.examen_intentos;
create policy examen_intentos_lectura on public.examen_intentos for select to authenticated
using (agente_id=auth.uid() or public.is_superadmin() or private.es_capacitador());

drop policy examen_intento_respuestas_lectura on public.examen_intento_respuestas;
create policy examen_intento_respuestas_lectura on public.examen_intento_respuestas for select to authenticated
using (public.is_superadmin() or private.es_capacitador() or exists(select 1 from public.examen_intentos i where i.id=intento_id and i.agente_id=auth.uid()));

do $$ begin if to_regclass('storage.objects') is not null then
  execute 'drop policy if exists capacitaciones_storage_insert on storage.objects';
  execute $p$create policy capacitaciones_storage_insert on storage.objects for insert to authenticated
   with check(bucket_id='capacitaciones' and (public.is_superadmin() or private.es_capacitador())
    and exists(select 1 from public.capacitaciones c where c.id::text=(storage.foldername(name))[1] and c.capacitador_id=auth.uid()))$p$;

  execute 'drop policy if exists capacitaciones_storage_update on storage.objects';
  execute $p$create policy capacitaciones_storage_update on storage.objects for update to authenticated
   using(bucket_id='capacitaciones' and (public.is_superadmin() or private.es_capacitador())
    and exists(select 1 from public.capacitaciones c where c.id::text=(storage.foldername(name))[1] and c.capacitador_id=auth.uid()))$p$;

  execute 'drop policy if exists capacitaciones_storage_select on storage.objects';
  execute $p$create policy capacitaciones_storage_select on storage.objects for select to authenticated
   using(bucket_id='capacitaciones' and exists(
    select 1 from public.capacitaciones c where c.id::text=(storage.foldername(name))[1]
     and (c.capacitador_id=auth.uid() or public.is_superadmin() or private.es_capacitador()
       or (c.estado='PUBLICADA' and private.capacitacion_asignada_a_mi(c.id)))
   ))$p$;
end if; end $$;

create or replace function public.reporte_capacitacion(p_capacitacion_id uuid) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not (public.is_superadmin() or private.es_capacitador()) then raise exception 'No autorizado' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.nombre),'[]'::jsonb) into v_result from (
    select per.id agente_personal_id, per.nombre, per.codigo_personal,
      coalesce(pr.porcentaje_visto,0) porcentaje_visto, coalesce(pr.video_completo,false) video_completo,
      (select count(*) from public.examen_intentos i where i.capacitacion_id=p_capacitacion_id and i.agente_id=per.profile_id) intentos,
      (select max(i.nota) from public.examen_intentos i where i.capacitacion_id=p_capacitacion_id and i.agente_id=per.profile_id) mejor_nota,
      (select bool_or(i.aprobado) from public.examen_intentos i where i.capacitacion_id=p_capacitacion_id and i.agente_id=per.profile_id) aprobado
    from public.personal per
    left join lateral (select * from public.capacitacion_progreso pr where pr.capacitacion_id=p_capacitacion_id and pr.agente_id=per.profile_id) pr on true
    where per.profile_id is not null and per.activo and private.capacitacion_asignada_a_personal(p_capacitacion_id,per.id)
  ) x;
  return v_result;
end $$;

create or replace function public.admin_asignar_cliente_personal(p_personal_id uuid, p_cliente_id uuid) returns public.personal
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_row public.personal;
begin
  if auth.uid() is null or not (public.is_superadmin() or private.es_capacitador()) then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_cliente_id is not null and not exists(select 1 from public.clientes where id=p_cliente_id) then
    raise exception 'Cliente inválido' using errcode='22023'; end if;
  update public.personal set cliente_actual_id=p_cliente_id where id=p_personal_id returning * into v_row;
  if not found then raise exception 'Colaborador no encontrado' using errcode='P0002'; end if;
  return v_row;
end $$;

create or replace function public.actualizar_nota_minima(p_capacitacion_id uuid, p_nota_minima integer) returns public.capacitaciones
language plpgsql volatile security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_cap public.capacitaciones;
begin
  if p_nota_minima is null or p_nota_minima<0 or p_nota_minima>20 then
    raise exception 'La nota mínima debe estar entre 0 y 20' using errcode='22023'; end if;
  update public.capacitaciones set nota_minima=p_nota_minima, updated_at=now()
    where id=p_capacitacion_id and estado='BORRADOR' and (capacitador_id=auth.uid() or public.is_superadmin())
    returning * into v_cap;
  if not found then raise exception 'No se pudo actualizar (no encontrada, no autorizado, o ya no está en borrador)' using errcode='P0002'; end if;
  return v_cap;
end $$;

create or replace function public.desvincular_agente(p_personal_id uuid) returns public.personal
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_row public.personal; v_profile_id uuid;
begin
  if auth.uid() is null or not public.is_superadmin() then raise exception 'No autorizado' using errcode='42501'; end if;
  select profile_id into v_profile_id from public.personal where id=p_personal_id for update;
  if not found then raise exception 'Colaborador no encontrado' using errcode='P0002'; end if;
  update public.personal set profile_id=null where id=p_personal_id returning * into v_row;
  if v_profile_id is not null then
    update public.profiles set role='sin_vincular' where id=v_profile_id and role='agente';
  end if;
  return v_row;
end $$;

-- ============================================================================
-- Gestión de usuarios y roles -- solo superadmin.
-- ============================================================================
create function public.superadmin_listar_usuarios() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_superadmin() then raise exception 'No autorizado' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.email),'[]'::jsonb) into v_result from public.profiles p;
  return v_result;
end $$;
revoke all on function public.superadmin_listar_usuarios() from public,anon,authenticated;
grant execute on function public.superadmin_listar_usuarios() to authenticated;

-- No permite que un superadmin se quite su propio rol de superadmin (evita quedarse sin acceso
-- por accidente); cualquier otro cambio, sobre cualquier usuario, queda permitido.
create function public.superadmin_cambiar_rol(p_user_id uuid, p_role public.user_role) returns public.profiles
language plpgsql volatile security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_row public.profiles;
begin
  if auth.uid() is null or not public.is_superadmin() then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_user_id=auth.uid() and p_role<>'superadmin' then
    raise exception 'No puedes quitarte tu propio rol de superadmin' using errcode='22023'; end if;
  update public.profiles set role=p_role where id=p_user_id returning * into v_row;
  if not found then raise exception 'Usuario no encontrado' using errcode='P0002'; end if;
  return v_row;
end $$;
revoke all on function public.superadmin_cambiar_rol(uuid,public.user_role) from public,anon,authenticated;
grant execute on function public.superadmin_cambiar_rol(uuid,public.user_role) to authenticated;

-- ============================================================================
-- Promueve la cuenta indicada a superadmin. Si tenías otras cuentas con rol admin, se quedan
-- como admin (restringido) -- revísalas tú mismo antes de aplicar esto en producción con:
--   select id, email, nombre from public.profiles where role = 'admin';
-- ============================================================================
do $$ begin
  if not exists(select 1 from public.profiles where email='javierqm189@gmail.com') then
    raise warning 'No se encontró ningún perfil con ese correo; revisa manualmente.';
  end if;
end $$;
update public.profiles set role='superadmin' where email='javierqm189@gmail.com';

notify pgrst,'reload schema';
commit;

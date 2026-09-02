-- Seguridad preproducción. Ejecutar después de 202609020004. Sin borrar datos.
begin;
-- Reafirmar RLS aun si el entorno tuvo una configuración manual diferente.
alter table public.profiles enable row level security;
alter table public.personal enable row level security;
alter table public.clientes enable row level security;
alter table public.unidades enable row level security;
alter table public.prendas enable row level security;
alter table public.requerimientos enable row level security;
alter table public.detalle_requerimiento enable row level security;
-- No depender de privilegios por defecto de instalaciones Supabase.
revoke create on schema public from public,anon,authenticated;
revoke all on public.profiles,public.personal,public.clientes,public.unidades,
  public.prendas,public.requerimientos,public.detalle_requerimiento from public,anon,authenticated;
-- REVOKE a nivel tabla no elimina concesiones previas por columna.
do $columns$
declare t text; cols text;
begin
  foreach t in array array['profiles','personal','clientes','unidades','prendas','requerimientos','detalle_requerimiento'] loop
    select string_agg(quote_ident(attname),',') into cols from pg_attribute
      where attrelid=format('public.%I',t)::regclass and attnum>0 and not attisdropped;
    execute format('revoke all (%s) on public.%I from public,anon,authenticated',cols,t);
  end loop;
end $columns$;
grant select on public.profiles,public.personal,public.clientes,public.unidades,
  public.prendas,public.requerimientos,public.detalle_requerimiento to authenticated;
grant insert,update on public.clientes,public.unidades to authenticated;
grant update(estado) on public.requerimientos to authenticated;
-- La creación funcional ya utiliza exclusivamente la RPC atómica.
-- RLS y todas las políticas se conservan.
create or replace function public.crear_requerimiento(
  p_agente_id uuid,p_cliente_id uuid,p_unidad_id uuid,p_detalles jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  v_id uuid;
  v_cliente text;
  v_prendas uuid[];
  v_count integer;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','coordinador')) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  perform id from public.personal where id=p_agente_id and activo for share;
  if not found then raise exception 'Agente inválido o inactivo'; end if;
  select nombre into v_cliente from public.clientes
    where id=p_cliente_id and activo for share;
  if not found then raise exception 'Selecciona un cliente activo'; end if;
  perform id from public.unidades where id=p_unidad_id
    and cliente_id=p_cliente_id and activo for share;
  if not found then raise exception 'Selecciona una unidad activa del cliente'; end if;
  if p_detalles is null or jsonb_typeof(p_detalles)<>'array' then
    raise exception 'Debe incluir prendas';
  end if;
  if jsonb_array_length(p_detalles)=0 then raise exception 'Debe incluir prendas'; end if;
  if jsonb_array_length(p_detalles)>500 or octet_length(p_detalles::text)>131072 then
    raise exception 'Demasiadas prendas' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_detalles) x
    where jsonb_typeof(x)<>'object' or not (x ? 'prenda_id') or (x - 'prenda_id')<>'{}'::jsonb) then
    raise exception 'Solo se aceptan identificadores de prendas' using errcode='22023';
  end if;
  select array_agg(x.prenda_id),count(distinct x.prenda_id)
    into v_prendas,v_count from jsonb_to_recordset(p_detalles) as x(prenda_id uuid);
  if v_count<>jsonb_array_length(p_detalles) then
    raise exception 'Detalles inválidos o duplicados';
  end if;
  -- Mantener estable el maestro mientras se copian cantidad/precio/código.
  perform id from public.prendas where id=any(v_prendas)
    and activo and cliente=v_cliente order by id for share;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(v_prendas) then
    raise exception 'La prenda no corresponde al cliente seleccionado o está inactiva';
  end if;
  insert into public.requerimientos(agente_id,usuario_creador_id,cliente_id,unidad_id)
    values(p_agente_id,auth.uid(),p_cliente_id,p_unidad_id) returning id into v_id;
  insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
    select v_id,p.id,p.cantidad,p.precio,p.codigo_almacen from public.prendas p
    where p.id=any(v_prendas);
  return v_id;
end;
$$;

create or replace function public.buscar_personal(p_busqueda text,p_limite integer default 20)
returns setof public.personal language plpgsql stable security invoker
set search_path=pg_catalog,public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_busqueda is null or length(btrim(p_busqueda))<2 then return; end if;
  if length(p_busqueda)>120 or p_limite is null or p_limite<1 or p_limite>50 then
    raise exception 'Búsqueda inválida' using errcode='22023';
  end if;
  return query select p.* from public.personal p where p.activo and (
    p.nombre ilike '%' || btrim(p_busqueda) || '%'
    or p.dni ilike '%' || btrim(p_busqueda) || '%'
    or p.codigo_personal ilike '%' || btrim(p_busqueda) || '%')
  order by case when p.codigo_personal=btrim(p_busqueda) or p.dni=btrim(p_busqueda) then 0 else 1 end,
    public.similarity(p.nombre,btrim(p_busqueda)) desc,p.nombre limit p_limite;
end $$;
-- Endurecer solo funciones de la aplicación; no tocar extensiones.
create or replace function public.admin_consultar_requerimientos(
  p_cliente_id uuid default null,
  p_unidad_id uuid default null,
  p_coordinador_id uuid default null,
  p_estado public.estado_requerimiento default null,
  p_desde timestamptz default null,
  p_hasta timestamptz default null,
  p_busqueda text default null,
  p_limite integer default 50,
  p_offset integer default 0,
  p_exportar boolean default false,
  p_cursor_fecha timestamptz default null,
  p_cursor_id uuid default null,
  p_creado_hasta timestamptz default null
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Solo administradores' using errcode='42501';
  end if;
  if length(p_busqueda)>120 or p_offset>49999950 then
    raise exception 'Filtros demasiado grandes' using errcode='22023';
  end if;
  if p_limite is null or p_limite<1 or p_limite>250 or p_offset is null or p_offset<0 then
    raise exception 'Paginación inválida' using errcode='22023';
  end if;
  if (p_cursor_fecha is null)<>(p_cursor_id is null) then
    raise exception 'Cursor incompleto' using errcode='22023';
  end if;
  if p_desde is not null and p_hasta is not null and p_desde>=p_hasta then
    raise exception 'Rango de fechas inválido' using errcode='22023';
  end if;
  with filtered as not materialized (
    select r.id,r.fecha,r.referencia_interna,r.estado,r.cliente_id,r.unidad_id,r.usuario_creador_id,
      jsonb_build_object('nombre',p.nombre,'dni',p.dni,'cargo',p.cargo) as personal,
      case when c.id is not null then jsonb_build_object('nombre',c.nombre) end as clientes,
      case when u.id is not null then jsonb_build_object('nombre',u.nombre) end as unidades,
      jsonb_build_object('nombre',pr.nombre,'email',pr.email) as profiles
    from requerimientos r
    left join personal p on p.id=r.agente_id
    left join clientes c on c.id=r.cliente_id
    left join unidades u on u.id=r.unidad_id
    left join profiles pr on pr.id=r.usuario_creador_id
    where (p_cliente_id is null or r.cliente_id=p_cliente_id)
      and (p_unidad_id is null or r.unidad_id=p_unidad_id)
      and (p_coordinador_id is null or r.usuario_creador_id=p_coordinador_id)
      and (p_estado is null or r.estado=p_estado)
      and (p_desde is null or r.fecha>=p_desde)
      and (p_hasta is null or r.fecha<p_hasta)
      and (p_creado_hasta is null or r.created_at<=p_creado_hasta)
      and (nullif(trim(p_busqueda),'') is null or
        position(lower(trim(p_busqueda)) in lower(concat_ws(' ',p.nombre,p.dni,c.nombre,u.nombre,pr.nombre,pr.email)))>0)
  ), page as (
    select * from filtered
    where p_cursor_fecha is null or (fecha,id)<(p_cursor_fecha,p_cursor_id)
    order by fecha desc,id desc limit p_limite offset p_offset
  )
  select jsonb_build_object(
    'total',case when p_exportar then null else (select count(*) from filtered) end,
    'rows',coalesce((select jsonb_agg(
      to_jsonb(r) || jsonb_build_object('cantidad_prendas',coalesce(d.cantidad,0)) ||
      case when p_exportar then jsonb_build_object('detalle_requerimiento',coalesce(d.detalles,'[]')) else '{}'::jsonb end
      order by r.fecha desc,r.id desc)
      from page r left join lateral (
        select sum(dr.cantidad) as cantidad,
          case when p_exportar then jsonb_agg(jsonb_build_object(
            'id',dr.id,'created_at',dr.created_at,'cantidad',dr.cantidad,
            'precio_unitario',dr.precio_unitario,'codigo_almacen',dr.codigo_almacen,
            'prendas',jsonb_build_object('codigo_prenda',g.codigo_prenda,
              'nombre_prenda',g.nombre_prenda,'codigo_almacen',g.codigo_almacen)
          ) order by dr.created_at,dr.id) end as detalles
        from detalle_requerimiento dr left join prendas g on g.id=dr.prenda_id
        where dr.requerimiento_id=r.id
      ) d on true),'[]')
  ) into v_result;
  return v_result;
end $$;

create or replace function public.editar_prendas_requerimiento(p_id uuid,p_version text,p_detalles jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_row public.requerimientos; v_payload jsonb; v_cliente text; v_count integer; v_ids uuid[];
begin
  -- Bloqueo de cabecera serializa edición con cualquier cambio de estado.
  select r.* into v_row from public.requerimientos r
    join public.profiles p on p.id=auth.uid()
    where r.id=p_id and (p.role='admin' or (p.role='coordinador' and r.usuario_creador_id=p.id))
    for update of r;
  if not found then raise exception 'No autorizado' using errcode='42501'; end if;
  if v_row.estado='Atendido' then
    raise exception 'Este requerimiento ya fue atendido y no puede modificarse.' using errcode='55000';
  end if;
  if p_detalles is null or jsonb_typeof(p_detalles)<>'array' then
    raise exception 'Incluye al menos una prenda' using errcode='22023';
  end if;
  if octet_length(p_detalles::text)>131072 then
    raise exception 'Solicitud demasiado grande' using errcode='22023';
  end if;
  if jsonb_array_length(p_detalles)<1 or jsonb_array_length(p_detalles)>500 then
    raise exception 'Incluye entre 1 y 500 prendas' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_detalles) x
    where jsonb_typeof(x)<>'object' or not (x ? 'prenda_id')
      or (x - 'prenda_id' - 'detalle_id')<>'{}'::jsonb) then
    raise exception 'Solo se aceptan identificadores de prendas y líneas' using errcode='22023';
  end if;
  select array_agg(x.prenda_id),count(distinct x.prenda_id) into v_ids,v_count
    from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid);
  if v_count<>jsonb_array_length(p_detalles) then
    raise exception 'Prendas inválidas o duplicadas' using errcode='22023';
  end if;
  -- Fija el maestro antes de calcular la versión; detecta cambios desde la carga.
  perform g.id from public.prendas g where g.id=any(v_ids) or exists(
    select 1 from public.detalle_requerimiento d where d.requerimiento_id=p_id and d.activo and d.prenda_id=g.id)
    order by g.id for share;
  v_payload:=public.obtener_edicion_prendas(p_id);
  if p_version is distinct from (v_payload->>'version') then
    raise exception 'El requerimiento o el maestro cambió. Recarga la página antes de guardar.' using errcode='40001';
  end if;
  select nombre into v_cliente from public.clientes where id=v_row.cliente_id for share;
  if exists(select 1 from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid)
    where x.detalle_id is not null and not exists(
      select 1 from public.detalle_requerimiento d where d.id=x.detalle_id
        and d.requerimiento_id=p_id and d.prenda_id=x.prenda_id and d.activo)) then
    raise exception 'La línea no está activa o no pertenece al requerimiento' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid)
    where x.detalle_id is null and not exists(select 1 from public.prendas g
      where g.id=x.prenda_id and g.activo and g.cliente=v_cliente)) then
    raise exception 'La prenda no corresponde al cliente o está inactiva' using errcode='22023';
  end if;
  -- Retirar primero permite sustituir una línea por otra de la misma prenda.
  update public.detalle_requerimiento d
    set activo=false,retirado_at=clock_timestamp(),retirado_por=auth.uid()
    where d.requerimiento_id=p_id and d.activo and not exists(
      select 1 from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid) where x.detalle_id=d.id);
  -- Solo cantidad proviene del maestro; precio/código de líneas conservadas no cambian.
  update public.detalle_requerimiento d set cantidad=g.cantidad from public.prendas g
    where d.requerimiento_id=p_id and d.activo and g.id=d.prenda_id;
  insert into public.detalle_requerimiento(requerimiento_id,prenda_id,cantidad,precio_unitario,codigo_almacen)
    select p_id,g.id,g.cantidad,g.precio,g.codigo_almacen
    from jsonb_to_recordset(p_detalles) as x(prenda_id uuid,detalle_id uuid)
    join public.prendas g on g.id=x.prenda_id where x.detalle_id is null;
  return public.obtener_edicion_prendas(p_id);
end $$;
do $hardening$
declare f record;
begin
  for f in select p.oid::regprocedure as signature,p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'handle_new_user','is_admin','crear_requerimiento','buscar_personal',
      'proteger_requerimiento_actualizado','validar_destino_requerimiento','proteger_historial_detalle',
      'obtener_edicion_prendas','editar_prendas_requerimiento',
      'admin_opciones_requerimientos','admin_consultar_requerimientos'])
  loop
    execute format('alter function %s set search_path=pg_catalog,public,pg_temp', f.signature);
    execute format('revoke all on function %s from public,anon,authenticated', f.signature);
    if f.proname=any(array['is_admin','crear_requerimiento','buscar_personal',
      'obtener_edicion_prendas','editar_prendas_requerimiento',
      'admin_opciones_requerimientos','admin_consultar_requerimientos']) then
      execute format('grant execute on function %s to authenticated', f.signature);
    end if;
  end loop;
end $hardening$;
-- Aplica a objetos futuros creados por el rol que ejecuta esta migración.
alter default privileges in schema public revoke all on tables from anon,authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
